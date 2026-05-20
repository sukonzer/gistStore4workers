// ============================================================
// 远程资源拉取
// ============================================================
const UA = 'CF-Worker-Subscription';

// ------------------------------------------------------------
// Gist 获取
// ------------------------------------------------------------
// GitHub Gist API 在文件 >1MB 时会把 content 截断，并标记 truncated=true，
// 同时提供 raw_url。这里做兜底，避免静默丢数据。
export const fetchGist = async (GIST_TOKEN, GIST_ID, type) => {
    if (!GIST_TOKEN || !GIST_ID) throw new Error('GIST_TOKEN / GIST_ID not configured');
    if (!type) throw new Error('gist file type is required');

    const apiUrl = `https://api.github.com/gists/${encodeURIComponent(GIST_ID)}`;
    const resp = await fetch(apiUrl, {
        headers: {
            Authorization: `Bearer ${GIST_TOKEN}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': UA,
        },
    });
    if (!resp.ok) {
        throw new Error(`Gist fetch failed: ${resp.status} ${resp.statusText}`);
    }

    const gist = await resp.json();
    const file = gist?.files?.[type];
    if (!file) throw new Error(`File "${type}" not found in gist`);

    let content = file.content ?? '';
    if (file.truncated && file.raw_url) {
        const rawResp = await fetch(file.raw_url, {
            headers: {
                Authorization: `Bearer ${GIST_TOKEN}`,
                'User-Agent': UA,
            },
        });
        if (!rawResp.ok) {
            throw new Error(`Gist raw fetch failed: ${rawResp.status} ${rawResp.statusText}`);
        }
        content = await rawResp.text();
    }

    return content.trim();
};

// ------------------------------------------------------------
// 远程模板获取（带 Cache API 缓存）
// ------------------------------------------------------------
// 模板基本静态，用 caches.default 做 5 分钟短缓存，跨 dev / prod 一致工作。
// 不用 `cf: { cacheTtl, cacheEverything }` 是因为该字段在 wrangler dev 下
// 偶发 internal error，且行为不直观。
const TEMPLATE_CACHE_TTL = 300;

export const fetchTemplate = async (GIT_TEMPLATE_URL) => {
    if (!GIT_TEMPLATE_URL) throw new Error('GIT_TEMPLATE_URL not configured');

    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const cacheKey = new Request(GIT_TEMPLATE_URL, { method: 'GET' });

    let resp = cache ? await cache.match(cacheKey) : undefined;
    if (!resp) {
        resp = await fetch(GIT_TEMPLATE_URL, {
            headers: { 'User-Agent': UA },
        });
        if (!resp.ok) {
            throw new Error(`Template fetch failed: ${resp.status} ${resp.statusText} (${GIT_TEMPLATE_URL})`);
        }
        if (cache) {
            const cacheable = new Response(resp.clone().body, resp);
            cacheable.headers.set('Cache-Control', `public, max-age=${TEMPLATE_CACHE_TTL}`);
            await cache.put(cacheKey, cacheable);
        }
    }
    return resp.json();
};
