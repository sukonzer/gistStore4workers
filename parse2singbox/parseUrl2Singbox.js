// ============================================================
// URL 转 sing-box 节点
// ============================================================
import {
    toPort,
    b64decode,
    safeDecode,
    splitCsv,
    normalizeServerHost,
    parseEchParams,
    applyEchToSingboxTls,
} from '../lib/urlHelpers.js';

// ---- helpers ---------------------------------------------------------------

// 从 search params 组装 TLS 配置（vless / trojan 通用），含 ECH 支持
const buildTlsFromParams = (params, defaultSni) => {
    const tls = {
        enabled: true,
        insecure: params.allowInsecure === '1' || params.insecure === '1',
    };
    const sni = params.sni || params.peer || defaultSni;
    if (sni) tls.server_name = sni;
    if (params.alpn) tls.alpn = splitCsv(params.alpn);
    if (params.fp) tls.utls = { enabled: true, fingerprint: params.fp };

    applyEchToSingboxTls(tls, parseEchParams(params));
    return tls;
};

// 构造 ws / grpc / http 传输配置
const buildTransport = (type, opts) => {
    if (type === 'ws') {
        const t = { type: 'ws' };
        if (opts.path) t.path = opts.path;
        if (opts.host) t.headers = { Host: opts.host };
        return t;
    }
    if (type === 'grpc') {
        const t = { type: 'grpc' };
        const serviceName = opts.serviceName || opts.path;
        if (serviceName) t.service_name = serviceName;
        return t;
    }
    if (type === 'h2' || type === 'http') {
        const t = { type: 'http' };
        if (opts.path) t.path = opts.path;
        if (opts.host) t.host = splitCsv(opts.host);
        return t;
    }
    return undefined;
};

// ---- parsers ---------------------------------------------------------------

const parseVmess = (url, tag) => {
    const jsonStr = b64decode(url.pathname.replace(/^\/+/, '') || url.host);
    const c = JSON.parse(jsonStr);

    const port = toPort(c.port);
    if (!port) return null;

    const node = {
        type: 'vmess',
        tag,
        server: normalizeServerHost(c.add || c.address),
        server_port: port,
        uuid: c.id,
        alter_id: Number.isFinite(parseInt(c.aid, 10)) ? parseInt(c.aid, 10) : 0,
        security: c.scy || 'auto', // 加密算法（不是传输类型）
    };

    const transport = buildTransport(c.net, { path: c.path, host: c.host, serviceName: c.path });
    if (transport) node.transport = transport;

    if (c.tls === '1' || c.tls === 'tls') {
        node.tls = {
            enabled: true,
            insecure: false,
        };
        const sni = c.sni || c.host;
        if (sni) node.tls.server_name = sni;
        if (c.alpn) node.tls.alpn = splitCsv(String(c.alpn));
        if (c.fp) node.tls.utls = { enabled: true, fingerprint: c.fp };

        // ECH（vmess JSON 字段 ech / ech-config 或别名）
        applyEchToSingboxTls(node.tls, parseEchParams(c));
    }
    return node;
};

const parseVless = (url, tag) => {
    const port = toPort(url.port);
    if (!port) return null;

    const params = Object.fromEntries(url.searchParams);
    const node = {
        type: 'vless',
        tag,
        server: normalizeServerHost(url.hostname),
        server_port: port,
        uuid: safeDecode(url.username),
    };
    if (params.flow) node.flow = params.flow;

    const transport = buildTransport(params.type, {
        path: params.path && safeDecode(params.path),
        host: params.host,
        serviceName: params.serviceName,
    });
    if (transport) node.transport = transport;

    if (params.security === 'tls') {
        node.tls = buildTlsFromParams(params, normalizeServerHost(url.hostname));
    } else if (params.security === 'reality') {
        node.tls = {
            ...buildTlsFromParams(params, normalizeServerHost(url.hostname)),
            reality: {
                enabled: true,
                public_key: params.pbk || params.publicKey || '',
                short_id: params.sid || '',
            },
        };
    }
    return node;
};

const parseTrojan = (url, tag) => {
    const port = toPort(url.port);
    if (!port) return null;

    const params = Object.fromEntries(url.searchParams);
    const node = {
        type: 'trojan',
        tag,
        server: normalizeServerHost(url.hostname),
        server_port: port,
        password: safeDecode(url.username),
    };

    const transport = buildTransport(params.type, {
        path: params.path && safeDecode(params.path),
        host: params.host,
        serviceName: params.serviceName,
    });
    if (transport) node.transport = transport;

    // trojan 默认就是 TLS；仅当显式 security=none 才禁用
    if (params.security !== 'none') {
        node.tls = buildTlsFromParams(params, normalizeServerHost(url.hostname));
    }
    return node;
};

// ss://method:password@host:port#tag
// ss://base64(method:password)@host:port#tag
// ss://base64(method:password@host:port)#tag (legacy)
const parseShadowsocks = (url, tag, raw) => {
    let method, password, host, port;

    if (normalizeServerHost(url.hostname)) {
        // 现代格式：userinfo 部分可能是 base64 编码的 method:password
        host = normalizeServerHost(url.hostname);
        port = toPort(url.port);
        const userinfo = safeDecode(url.username);
        if (userinfo.includes(':')) {
            [method, password] = userinfo.split(':');
        } else {
            // base64
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
        // 旧格式：ss://base64(method:password@host:port)#tag
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
        type: 'shadowsocks',
        tag,
        server: normalizeServerHost(host),
        server_port: port,
        method,
        password,
    };
};

const parseSocks5 = (url, tag) => {
    const port = toPort(url.port);
    if (!port) return null;
    const node = {
        type: 'socks',
        tag,
        server: normalizeServerHost(url.hostname),
        server_port: port,
    };
    if (url.username) {
        node.username = safeDecode(url.username);
        node.password = safeDecode(url.password || '');
    }
    return node;
};

const parseTuic = (url, tag) => {
    const port = toPort(url.port);
    if (!port) return null;
    const params = Object.fromEntries(url.searchParams);
    return {
        type: 'tuic',
        tag,
        server: normalizeServerHost(url.hostname),
        server_port: port,
        uuid: safeDecode(url.username),
        password: safeDecode(url.password || ''),
        congestion_control: params.congestion_control || 'bbr',
        udp_relay_mode: params.udp_relay_mode || 'native',
        tls: buildTlsFromParams(params, normalizeServerHost(url.hostname)),
    };
};

const parseHysteria2 = (url, tag) => {
    const port = toPort(url.port);
    if (!port) return null;
    const params = Object.fromEntries(url.searchParams);
    const node = {
        type: 'hysteria2',
        tag,
        server: normalizeServerHost(url.hostname),
        server_port: port,
        password: safeDecode(url.username),
    };
    if (params.up) {
        const up = parseInt(params.up, 10);
        if (Number.isFinite(up)) node.up_mbps = up;
    }
    if (params.down) {
        const down = parseInt(params.down, 10);
        if (Number.isFinite(down)) node.down_mbps = down;
    }
    if (params.obfs) {
        node.obfs = { type: params.obfs };
        if (params['obfs-password']) node.obfs.password = params['obfs-password'];
    }
    node.tls = buildTlsFromParams(params, normalizeServerHost(url.hostname));
    return node;
};

const parseAnytls = (url, tag) => {
    const port = toPort(url.port);
    if (!port) return null;
    const params = Object.fromEntries(url.searchParams);
    return {
        type: 'anytls',
        tag,
        server: normalizeServerHost(url.hostname),
        server_port: port,
        password: safeDecode(url.username),
        tls: buildTlsFromParams(params, normalizeServerHost(url.hostname)),
    };
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

export const parseUrlToSingbox = (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return null;

    try {
        const url = new URL(trimmed);
        const protocol = url.protocol.replace(':', '');
        const tag = safeDecode(url.hash.slice(1)) || `${protocol}@${url.host}`;

        const parser = PARSERS[protocol];
        if (!parser) {
            console.warn(`Unknown protocol: ${protocol}, skipping`);
            return null;
        }
        return parser(url, tag, trimmed);
    } catch (e) {
        console.warn(`Parse failed for: ${trimmed.slice(0, 60)}... Error: ${e.message}`);
        return null;
    }
};
