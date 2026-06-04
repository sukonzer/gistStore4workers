// ============================================================
// 无状态订阅 URL 编解码（仅全远程模式生成 URL）
// ============================================================
import { assertHttpUrl } from './fetchNodes.js';

export const expandSnapshot = (snap) => ({
    nodesSource: snap.ns,
    nodesLocal: snap.ns === 'local' ? snap.nl : undefined,
    nodesRemote: snap.ns === 'remote' ? snap.nr : undefined,
    templateSource: snap.ts,
    templateLocal: snap.ts === 'local' ? snap.tl : undefined,
    templateRemote: snap.ts === 'remote' ? snap.tr : undefined,
    platform: snap.platform,
});

const validateRemoteSnapshot = (snap) => {
    if (snap.ns !== 'remote' || snap.ts !== 'remote') {
        throw new Error('Subscription URL requires remote nodes and template');
    }
    assertHttpUrl(snap.nr);
    assertHttpUrl(snap.tr);
};

/** 节点与模板均为远程 URI 时才生成订阅 URL；含本地内容则返回 null */
export const encodeSubscriptionUrl = (baseUrl, platform, form) => {
    if (form.nodesSource !== 'remote' || form.templateSource !== 'remote') {
        return { url: null, mode: 'local' };
    }

    const origin = new URL(baseUrl).origin;
    const path = `/sub/${platform}`;
    const qs = new URLSearchParams({
        ns: 'remote',
        nr: form.nodesRemote,
        ts: 'remote',
        tr: form.templateRemote,
    });

    return {
        url: `${origin}${path}?${qs.toString()}`,
        mode: 'query',
    };
};

export const decodeSubscriptionParams = (url, platform) => {
    const params = url.searchParams;
    const snap = {
        ns: params.get('ns'),
        nr: params.get('nr') ?? undefined,
        ts: params.get('ts'),
        tr: params.get('tr') ?? undefined,
        platform,
    };

    validateRemoteSnapshot(snap);
    return expandSnapshot(snap);
};
