import BLOG_HTML from './index.html';
import TOOLS_HTML from './tools.html';
import SUB_HTML from './sub.html';
import { fetchGist } from './fetchResource.js';
import { parse2singbox } from './parse2singbox/index.js';
import { parse2mihomo } from './parse2mihomo/index.js';
import { handleSubGenPost, handleSubGenGet } from './api/subGen.js';

// ============================================================
// 常量
// ============================================================
const MIN_TOKEN_LEN = 13;
const ROUTE_RE = new RegExp(`^/([a-zA-Z0-9@_-]{${MIN_TOKEN_LEN},})/([a-zA-Z0-9._-]+)$`);

const SUBSCRIPTION_HEADERS = {
    'Profile-Update-Interval': '6',
    'Subscription-Userinfo': 'upload=0; download=0; total=107374182400000; expire=9999999999',
};

// ============================================================
// 工具函数
// ============================================================

// 字节级 base64 编码（UTF-8 -> base64），比 String.fromCharCode + apply 更稳
const toBase64 = (text) => {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
};

// 去掉以 # 开头的注释行与空行
const stripCommentLines = (text) =>
    text
        .split('\n')
        .filter((line) => {
            const t = line.trim();
            return t && !t.startsWith('#');
        })
        .join('\n');

// 常数时间字符串比较，规避 token 比较的 timing attack
const timingSafeEqual = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
};

const json = (data, init = {}) =>
    new Response(JSON.stringify(data), {
        ...init,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            ...(init.headers || {}),
        },
    });

const text = (body, init = {}) =>
    new Response(body, {
        ...init,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
            ...(init.headers || {}),
        },
    });

const yaml = (body, init = {}) =>
    new Response(body, {
        ...init,
        headers: {
            'Content-Type': 'text/yaml; charset=utf-8',
            'Cache-Control': 'no-store',
            ...(init.headers || {}),
        },
    });

const methodNotAllowed = (allow) =>
    new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: allow.join(', ') },
    });

/** 方法不在 allow 列表时返回 405，否则返回 null */
const requireMethods = (method, allow) => {
    if (allow.includes(method)) return null;
    return methodNotAllowed(allow);
};

const htmlResponse = (body, cache = 'public, max-age=3600') =>
    new Response(body, {
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': cache,
        },
    });

// ============================================================
// Worker 入口
// ============================================================
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const pathname = url.pathname;
        const method = request.method;

        const READ_METHODS = ['GET', 'HEAD'];

        // 首页：伪装博客
        if (pathname === '/') {
            const denied = requireMethods(method, READ_METHODS);
            if (denied) return denied;
            return htmlResponse(BLOG_HTML);
        }

        // 工具页：无需鉴权
        if (pathname === '/tools' || pathname === '/tools/') {
            const denied = requireMethods(method, READ_METHODS);
            if (denied) return denied;
            return htmlResponse(TOOLS_HTML);
        }

        // /sub UI 与订阅生成（无需 AUTH_TOKEN）
        if (pathname === '/sub' || pathname === '/sub/') {
            if (method === 'POST') {
                return handleSubGenPost(request);
            }
            const denied = requireMethods(method, READ_METHODS);
            if (denied) return denied;
            return htmlResponse(SUB_HTML);
        }

        if (pathname === '/sub/singbox' && (method === 'GET' || method === 'HEAD')) {
            return handleSubGenGet(request, 'singbox');
        }

        if (pathname === '/sub/mihomo' && (method === 'GET' || method === 'HEAD')) {
            return handleSubGenGet(request, 'mihomo');
        }

        // 其余路由仅允许 GET / HEAD
        const denied = requireMethods(method, READ_METHODS);
        if (denied) return denied;

        // 必要的服务端配置校验（避免 AUTH_TOKEN 未设置时的隐式行为）
        if (!env.AUTH_TOKEN || env.AUTH_TOKEN.length < MIN_TOKEN_LEN) {
            console.error('AUTH_TOKEN missing or too short');
            return new Response('Service misconfigured', { status: 500 });
        }

        // 路由：/<token>/<action>
        const match = pathname.match(ROUTE_RE);
        if (!match || !timingSafeEqual(match[1], env.AUTH_TOKEN)) {
            return new Response('Unauthorized', { status: 403 });
        }

        const action = match[2];

        try {
            // 保留动作：singbox → 拉 nodes + 模板，合并出 sing-box JSON
            if (action === 'singbox') {
                const config = await parse2singbox(
                    {
                        GIST_TOKEN: env.GIST_TOKEN,
                        GIST_ID: env.GIST_ID,
                        GIT_SINGBOX_RAW: env.GIT_SINGBOX_RAW,
                    },
                    'nodes',
                );
                return json(config, {
                    headers: SUBSCRIPTION_HEADERS,
                });
            }

            // 保留动作：mihomo → 拉 nodes + mihomo 模板，合并出 mihomo (Clash.Meta) YAML
            if (action === 'mihomo' || action === 'clash') {
                const body = await parse2mihomo(
                    {
                        GIST_TOKEN: env.GIST_TOKEN,
                        GIST_ID: env.GIST_ID,
                        GIT_MIHOMO_RAW: env.GIT_MIHOMO_RAW,
                    },
                    'nodes',
                );
                return yaml(body, {
                    headers: SUBSCRIPTION_HEADERS,
                });
            }

            // 其它 action 视为 gist 文件名
            const content = await fetchGist(env.GIST_TOKEN, env.GIST_ID, action);

            // nodes：订阅链接，需要去 # 注释并 base64
            if (action === 'nodes') {
                const body = toBase64(stripCommentLines(content));
                return text(body, { headers: SUBSCRIPTION_HEADERS });
            }

            // 其它文件：原样返回
            return text(content);
        } catch (err) {
            console.error(`[${action}] handler failed:`, err && err.stack ? err.stack : err);
            return new Response('Internal Server Error', { status: 500 });
        }
    },
};
