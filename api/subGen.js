// ============================================================
// /sub POST + /sub/{platform} GET 处理器
// ============================================================
import { buildFromForm } from '../lib/buildConfig.js';
import { encodeSubscriptionUrl, decodeSubscriptionParams } from '../lib/subUrlCodec.js';

const SUBSCRIPTION_HEADERS = {
    'Profile-Update-Interval': '6',
    'Subscription-Userinfo': 'upload=0; download=0; total=107374182400000; expire=9999999999',
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

const validateForm = (body) => {
    if (!body || typeof body !== 'object') throw new Error('Invalid request body');

    const { nodesSource, platform, templateSource } = body;
    if (nodesSource !== 'local' && nodesSource !== 'remote') {
        throw new Error('nodesSource must be "local" or "remote"');
    }
    if (platform !== 'singbox' && platform !== 'mihomo') {
        throw new Error('platform must be "singbox" or "mihomo"');
    }
    if (templateSource !== 'local' && templateSource !== 'remote') {
        throw new Error('templateSource must be "local" or "remote"');
    }
    if (nodesSource === 'local' && !body.nodesLocal?.trim()) {
        throw new Error('nodesLocal is required');
    }
    if (nodesSource === 'remote' && !body.nodesRemote?.trim()) {
        throw new Error('nodesRemote is required');
    }
    if (templateSource === 'local' && !body.templateLocal?.trim()) {
        throw new Error('templateLocal is required');
    }
    if (templateSource === 'remote' && !body.templateRemote?.trim()) {
        throw new Error('templateRemote is required');
    }

    return {
        nodesSource,
        nodesLocal: body.nodesLocal,
        nodesRemote: body.nodesRemote,
        platform,
        templateSource,
        templateLocal: body.templateLocal,
        templateRemote: body.templateRemote,
    };
};

export const handleSubGenPost = async (request) => {
    let body;
    try {
        body = await request.json();
    } catch {
        return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    let form;
    try {
        form = validateForm(body);
    } catch (err) {
        return json({ success: false, error: err.message }, { status: 400 });
    }

    try {
        const { content, contentType } = await buildFromForm(form);
        const { url, mode } = encodeSubscriptionUrl(request.url, form.platform, form);

        const result = {
            success: true,
            subscriptionUrl: url,
            subscriptionUrlMode: mode,
            content,
            contentType,
        };

        if (mode === 'local') {
            result.hint = '本地配置请复制下方预览到客户端；订阅 URL 仅在节点与模板均为远程 URI 时生成';
        }

        return json(result);
    } catch (err) {
        console.error('[sub POST]', err?.stack ?? err);
        return json(
            { success: false, error: err.message || 'Generation failed' },
            { status: 500 },
        );
    }
};

export const handleSubGenGet = async (request, platform) => {
    let form;
    try {
        form = decodeSubscriptionParams(new URL(request.url), platform);
    } catch (err) {
        return new Response(err.message || 'Bad Request', { status: 400 });
    }

    try {
        const { content, contentType } = await buildFromForm(form);

        if (request.method === 'HEAD') {
            return new Response(null, {
                headers: {
                    'Content-Type': `${contentType}; charset=utf-8`,
                    'Cache-Control': 'no-store',
                    ...SUBSCRIPTION_HEADERS,
                },
            });
        }

        return new Response(content, {
            headers: {
                'Content-Type': `${contentType}; charset=utf-8`,
                'Cache-Control': 'no-store',
                ...SUBSCRIPTION_HEADERS,
            },
        });
    } catch (err) {
        console.error(`[sub/${platform} GET]`, err?.stack ?? err);
        return new Response('Internal Server Error', { status: 500 });
    }
};
