// ============================================================
// 远程节点订阅 URI 拉取与解码
// ============================================================
const UA = 'CF-Worker-Subscription';

const stripCommentLines = (text) =>
    text
        .split('\n')
        .filter((line) => {
            const t = line.trim();
            return t && !t.startsWith('#');
        })
        .join('\n');

const looksLikeNodeLinks = (text) =>
    /^(vmess|vless|trojan|ss|ssr|hysteria|hysteria2|tuic|hy2|anytls):\/\//m.test(text.trim());

const tryBase64Decode = (text) => {
    const trimmed = text.trim();
    if (looksLikeNodeLinks(trimmed)) return trimmed;

    try {
        const norm = trimmed.replace(/-/g, '+').replace(/_/g, '/');
        const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
        const decoded = atob(norm + pad);
        if (looksLikeNodeLinks(decoded) || decoded.includes('://')) {
            return decoded;
        }
    } catch {
        // fall through
    }
    return trimmed;
};

export const assertHttpUrl = (url) => {
    if (!url || typeof url !== 'string') throw new Error('URL is required');
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error('Invalid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only http/https URLs are allowed');
    }
    return parsed.href;
};

export const fetchRemoteNodes = async (url) => {
    const safeUrl = assertHttpUrl(url);
    const resp = await fetch(safeUrl, {
        headers: { 'User-Agent': UA },
    });
    if (!resp.ok) {
        throw new Error(`Nodes fetch failed: ${resp.status} ${resp.statusText}`);
    }
    const raw = (await resp.text()).trim();
    if (!raw) throw new Error('Remote nodes subscription is empty');
    return stripCommentLines(tryBase64Decode(raw));
};
