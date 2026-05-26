import { fetchGist, fetchTemplate } from '../fetchResource.js';
import { parseUrlToSingbox } from './parseUrl2Singbox.js';
import { mergeTemplate } from './mergeTemplate.js';

export const parse2singbox = async ({ GIST_TOKEN, GIST_ID, GIT_SINGBOX_RAW }, type) => {
    const [rawNodes, rawTemplate] = await Promise.all([
        fetchGist(GIST_TOKEN, GIST_ID, type),
        fetchTemplate(GIT_SINGBOX_RAW),
    ]);

    let template;
    try {
        template = JSON.parse(rawTemplate);
    } catch (e) {
        throw new Error(`sing-box template parse failed (expected JSON): ${e.message}`);
    }

    if (!template || !Array.isArray(template.outbounds)) {
        throw new Error('Invalid template: missing outbounds array');
    }

    const nodes = rawNodes
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map(parseUrlToSingbox)
        .filter(Boolean);

    if (nodes.length === 0) {
        throw new Error('No valid nodes parsed from gist');
    }

    return mergeTemplate(template, nodes);
};
