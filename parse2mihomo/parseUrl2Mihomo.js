// ============================================================
// URL 转 mihomo (Clash.Meta) 代理节点
// ============================================================
// mihomo 字段参考：https://wiki.metacubex.one/config/proxies/
import {
    toPort,
    b64decode,
    safeDecode,
    splitCsv,
    normalizeServerHost,
    parseEchParams,
    applyEchToMihomo,
} from '../lib/urlHelpers.js';

// ---- helpers ---------------------------------------------------------------

// 把通用 TLS 相关参数（sni / alpn / fp / insecure）注入到 mihomo proxy 对象
// mihomo 不同协议字段名略有差异：
//   vless / vmess：servername
//   trojan / hysteria2 / tuic / anytls：sni
// 这里通过 sniField 区分；其它字段保持一致。
const applyTlsFields = (out, params, defaultSni, sniField = 'servername') => {
    const sni = params.sni || params.peer || defaultSni;
    if (sni) out[sniField] = sni;

    if (params.allowInsecure === '1' || params.insecure === '1') {
        out['skip-cert-verify'] = true;
    }
    if (params.alpn) out.alpn = splitCsv(params.alpn);
    if (params.fp) out['client-fingerprint'] = params.fp;

    applyEchToMihomo(out, parseEchParams(params));
};

// 构造 mihomo 的 network/*-opts；mihomo 用 `network` 字段表示传输层类型
const applyTransport = (out, type, opts) => {
    if (!type || type === 'tcp' || type === 'raw') return;

    if (type === 'ws') {
        out.network = 'ws';
        const wsOpts = {};
        if (opts.path) wsOpts.path = opts.path;
        if (opts.host) wsOpts.headers = { Host: opts.host };
        if (Object.keys(wsOpts).length > 0) out['ws-opts'] = wsOpts;
        return;
    }
    if (type === 'grpc') {
        out.network = 'grpc';
        const grpcOpts = {};
        const serviceName = opts.serviceName || opts.path;
        if (serviceName) grpcOpts['grpc-service-name'] = serviceName;
        if (Object.keys(grpcOpts).length > 0) out['grpc-opts'] = grpcOpts;
        return;
    }
    if (type === 'h2' || type === 'http') {
        out.network = type === 'h2' ? 'h2' : 'http';
        const h2Opts = {};
        if (opts.path) h2Opts.path = [opts.path];
        if (opts.host) h2Opts.host = splitCsv(opts.host);
        if (Object.keys(h2Opts).length > 0) out[type === 'h2' ? 'h2-opts' : 'http-opts'] = h2Opts;
    }
};

// ---- parsers ---------------------------------------------------------------

const parseVmess = (url, name) => {
    const jsonStr = b64decode(url.pathname.replace(/^\/+/, '') || url.host);
    const c = JSON.parse(jsonStr);

    const port = toPort(c.port);
    if (!port) return null;

    const node = {
        name,
        type: 'vmess',
        server: normalizeServerHost(c.add || c.address),
        port,
        uuid: c.id,
        alterId: Number.isFinite(parseInt(c.aid, 10)) ? parseInt(c.aid, 10) : 0,
        cipher: c.scy || 'auto',
        udp: true,
    };

    applyTransport(node, c.net, { path: c.path, host: c.host, serviceName: c.path });

    if (c.tls === '1' || c.tls === 'tls') {
        node.tls = true;
        const sni = c.sni || c.host;
        if (sni) node.servername = sni;
        if (c.alpn) node.alpn = splitCsv(String(c.alpn));
        if (c.fp) node['client-fingerprint'] = c.fp;

        applyEchToMihomo(node, parseEchParams(c));
    }
    return node;
};

const parseVless = (url, name) => {
    const port = toPort(url.port);
    if (!port) return null;
    const params = Object.fromEntries(url.searchParams);

    const node = {
        name,
        type: 'vless',
        server: normalizeServerHost(url.hostname),
        port,
        uuid: safeDecode(url.username),
        udp: true,
    };
    if (params.flow) node.flow = params.flow;

    applyTransport(node, params.type, {
        path: params.path && safeDecode(params.path),
        host: params.host,
        serviceName: params.serviceName,
    });

    if (params.security === 'tls') {
        node.tls = true;
        applyTlsFields(node, params, normalizeServerHost(url.hostname), 'servername');
    } else if (params.security === 'reality') {
        node.tls = true;
        applyTlsFields(node, params, normalizeServerHost(url.hostname), 'servername');
        node['reality-opts'] = {
            'public-key': params.pbk || params.publicKey || '',
            'short-id': params.sid || '',
        };
    }
    return node;
};

const parseTrojan = (url, name) => {
    const port = toPort(url.port);
    if (!port) return null;
    const params = Object.fromEntries(url.searchParams);

    const node = {
        name,
        type: 'trojan',
        server: normalizeServerHost(url.hostname),
        port,
        password: safeDecode(url.username),
        udp: true,
    };

    applyTransport(node, params.type, {
        path: params.path && safeDecode(params.path),
        host: params.host,
        serviceName: params.serviceName,
    });

    if (params.security !== 'none') {
        applyTlsFields(node, params, normalizeServerHost(url.hostname), 'sni');
    }
    return node;
};

const parseShadowsocks = (url, name, raw) => {
    let method, password, host, port;

    if (normalizeServerHost(url.hostname)) {
        host = normalizeServerHost(url.hostname);
        port = toPort(url.port);
        const userinfo = safeDecode(url.username);
        if (userinfo.includes(':')) {
            [method, password] = userinfo.split(':');
        } else {
            try {
                const decoded = b64decode(userinfo);
                const idx = decoded.indexOf(':');
                if (idx > 0) {
                    method = decoded.slice(0, idx);
                    password = decoded.slice(idx + 1);
                }
            } catch {
                /* ignore */
            }
        }
    } else {
        const payload = raw.slice('ss://'.length).split('#')[0];
        const decoded = b64decode(payload);
        const at = decoded.lastIndexOf('@');
        if (at < 0) return null;
        const mp = decoded.slice(0, at);
        const hp = decoded.slice(at + 1);
        const mpIdx = mp.indexOf(':');
        if (mpIdx < 0) return null;
        method = mp.slice(0, mpIdx);
        password = mp.slice(mpIdx + 1);
        const hpIdx = hp.lastIndexOf(':');
        host = hp.slice(0, hpIdx);
        port = toPort(hp.slice(hpIdx + 1));
    }

    if (!method || !password || !host || !port) return null;
    return {
        name,
        type: 'ss',
        server: normalizeServerHost(host),
        port,
        cipher: method,
        password,
        udp: true,
    };
};

const parseSocks5 = (url, name) => {
    const port = toPort(url.port);
    if (!port) return null;
    const node = {
        name,
        type: 'socks5',
        server: normalizeServerHost(url.hostname),
        port,
        udp: true,
    };
    if (url.username) {
        node.username = safeDecode(url.username);
        node.password = safeDecode(url.password || '');
    }
    return node;
};

const parseTuic = (url, name) => {
    const port = toPort(url.port);
    if (!port) return null;
    const params = Object.fromEntries(url.searchParams);
    const node = {
        name,
        type: 'tuic',
        server: normalizeServerHost(url.hostname),
        port,
        uuid: safeDecode(url.username),
        password: safeDecode(url.password || ''),
        'congestion-controller': params.congestion_control || 'bbr',
        'udp-relay-mode': params.udp_relay_mode || 'native',
    };
    applyTlsFields(node, params, normalizeServerHost(url.hostname), 'sni');
    if (!node.alpn) node.alpn = ['h3'];
    return node;
};

const parseHysteria2 = (url, name) => {
    const port = toPort(url.port);
    if (!port) return null;
    const params = Object.fromEntries(url.searchParams);
    const node = {
        name,
        type: 'hysteria2',
        server: normalizeServerHost(url.hostname),
        port,
        password: safeDecode(url.username),
    };
    if (params.up) {
        const up = parseInt(params.up, 10);
        if (Number.isFinite(up)) node.up = up;
    }
    if (params.down) {
        const down = parseInt(params.down, 10);
        if (Number.isFinite(down)) node.down = down;
    }
    if (params.obfs) {
        node.obfs = params.obfs;
        if (params['obfs-password']) node['obfs-password'] = params['obfs-password'];
    }
    applyTlsFields(node, params, normalizeServerHost(url.hostname), 'sni');
    return node;
};

const parseAnytls = (url, name) => {
    const port = toPort(url.port);
    if (!port) return null;
    const params = Object.fromEntries(url.searchParams);
    const node = {
        name,
        type: 'anytls',
        server: normalizeServerHost(url.hostname),
        port,
        password: safeDecode(url.username),
        udp: true,
    };
    applyTlsFields(node, params, normalizeServerHost(url.hostname), 'sni');
    return node;
};

const PARSERS = {
    vmess: parseVmess,
    vless: parseVless,
    trojan: parseTrojan,
    ss: parseShadowsocks,
    socks5: parseSocks5,
    tuic: parseTuic,
    hysteria2: parseHysteria2,
    anytls: parseAnytls,
};

// ---- entry -----------------------------------------------------------------

export const parseUrlToMihomo = (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return null;

    try {
        const url = new URL(trimmed);
        const protocol = url.protocol.replace(':', '');
        const name = safeDecode(url.hash.slice(1)) || `${protocol}@${url.host}`;

        const parser = PARSERS[protocol];
        if (!parser) {
            console.warn(`[mihomo] Unknown protocol: ${protocol}, skipping`);
            return null;
        }
        return parser(url, name, trimmed);
    } catch (e) {
        console.warn(`[mihomo] Parse failed for: ${trimmed.slice(0, 60)}... Error: ${e.message}`);
        return null;
    }
};
