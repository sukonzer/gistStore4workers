// ============================================================
// URL / 编码 公共工具
// sing-box 与 mihomo 解析器共用
// ============================================================

// 端口归一化：非法 / 缺失返回 undefined，由上层决定是否丢弃
export const toPort = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 && n < 65536 ? n : undefined;
};

// 兼容 url-safe base64（vmess 二维码、ECHConfigList 常见）
export const b64decode = (s) => {
    const norm = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
    return atob(norm + pad);
};

// 校验是否疑似合法 base64（用于 ECH config 校验）
export const isLikelyBase64 = (s) => typeof s === 'string' && /^[A-Za-z0-9+/_-]+=*$/.test(s);

// 安全 decodeURIComponent，失败原样返回
export const safeDecode = (s) => {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
};

// 解析 split-by-comma 列表，去空白与空串
export const splitCsv = (s) =>
    typeof s === 'string'
        ? s.split(',').map((x) => x.trim()).filter(Boolean)
        : [];

// URL.hostname 对 IPv6 字面量会带方括号（如 [2001:db8::1]），
// sing-box / mihomo 的 server 字段需要裸地址（2001:db8::1）
export const normalizeServerHost = (host) => {
    if (host === undefined || host === null) return host;
    const t = String(host).trim();
    if (t.length >= 2 && t.startsWith('[') && t.endsWith(']')) {
        return t.slice(1, -1);
    }
    return t;
};

const looksLikeUrl = (s) => typeof s === 'string' && /:\/\//.test(s);

const ECH_TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const ECH_FALSY = new Set(['0', 'false', 'no', 'off']);

// ------------------------------------------------------------
// ECH (Encrypted Client Hello)
// ------------------------------------------------------------
// 订阅 URL 约定（query / vmess JSON 通用）：
//   ech=1 / true                    启用 ECH（DNS 自动发现，用 SNI 查 HTTPS RR）
//   ech-config=<base64>             固定 ECHConfigList（别名 echConfig / ech_config）
//   ech=<base64>                    同上（较长 base64 时）
//   ech=cloudflare-ech.com+https://223.5.5.5/dns-query
//                                   Xray 风格：域名 + DoH，域名 → query-server-name
//                                   DoH 地址由内核全局 DNS 处理，无法写入单节点 outbound
//   ech=https://223.5.5.5/dns-query  仅 DoH（启用 ECH，query 域名用 SNI）
//   query-server-name=xxx           单独指定 ECH HTTPS RR 查询域名（mihomo / sing-box ≥1.13）
//   ech-pq=1                        后量子签名（仅 sing-box）
//
// 返回 { enabled, config, queryServerName?, pq }；未启用返回 null。
export const parseEchParams = (params) => {
    if (!params || typeof params !== 'object') return null;

    const rawCfg = params['ech-config'] ?? params.echConfig ?? params.ech_config;
    let config = rawCfg ? safeDecode(String(rawCfg)).trim() : '';

    let queryServerName = safeDecode(
        String(params['query-server-name'] ?? params.queryServerName ?? params.query_server_name ?? ''),
    ).trim();

    const pqFlag = params['ech-pq'] ?? params.echPq ?? params.ech_pq;
    const pq = pqFlag === 1 || pqFlag === true || pqFlag === '1' || pqFlag === 'true';

    let enabled = !!(config && isLikelyBase64(config));

    const flag = params.ech ?? params.ECH;
    if (flag !== undefined && flag !== null && String(flag).trim() !== '') {
        const s = safeDecode(String(flag)).trim();
        const lower = s.toLowerCase();
        if (ECH_TRUTHY.has(lower)) {
            enabled = true;
        } else if (ECH_FALSY.has(lower)) {
            if (!config) enabled = false;
        } else if (isLikelyBase64(s) && s.length >= 32) {
            enabled = true;
            config = s;
        } else {
            enabled = true;
            const parts = s.split('+').map((p) => p.trim()).filter(Boolean);
            if (parts.length >= 2) {
                const [first, second] = parts;
                const firstUrl = looksLikeUrl(first);
                const secondUrl = looksLikeUrl(second);
                if (!firstUrl && secondUrl && !queryServerName) {
                    queryServerName = first;
                } else if (firstUrl && !secondUrl && !queryServerName) {
                    queryServerName = second;
                } else if (!firstUrl && !secondUrl && !queryServerName) {
                    queryServerName = first;
                }
            } else if (parts.length === 1) {
                const p = parts[0];
                if (!looksLikeUrl(p) && !queryServerName) {
                    queryServerName = p;
                }
            }
        }
    }

    if (!enabled) return null;

    return {
        enabled: true,
        config: config && isLikelyBase64(config) ? config : '',
        queryServerName: queryServerName || undefined,
        pq,
    };
};

// ECH base64 配置 → sing-box `tls.ech.config` 期待的 PEM 行数组
export const echBase64ToPemLines = (b64) => {
    if (!b64) return undefined;
    const compact = b64.replace(/\s+/g, '');
    const lines = ['-----BEGIN ECH CONFIGS-----'];
    for (let i = 0; i < compact.length; i += 64) {
        lines.push(compact.slice(i, i + 64));
    }
    lines.push('-----END ECH CONFIGS-----');
    return lines;
};

export const applyEchToSingboxTls = (tls, ech) => {
    if (!ech) return;
    tls.ech = { enabled: true };
    if (ech.queryServerName) tls.ech.query_server_name = ech.queryServerName;
    if (ech.pq) tls.ech.pq_signature_schemes_enabled = true;
    const pem = echBase64ToPemLines(ech.config);
    if (pem) tls.ech.config = pem;
};

export const applyEchToMihomo = (out, ech) => {
    if (!ech) return;
    const echOpts = { enable: true };
    if (ech.config) echOpts.config = ech.config;
    if (ech.queryServerName) echOpts['query-server-name'] = ech.queryServerName;
    out['ech-opts'] = echOpts;
};
