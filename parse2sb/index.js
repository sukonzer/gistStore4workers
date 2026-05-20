import { fetchGist, fetchTemplate } from '../fetchResource.js';
import { parseUrlToNode } from './parseUrl2Node.js';
import { mergeTemplate } from './mergeTemplate.js';

export const parse2sb = async ({ GIST_TOKEN, GIST_ID, GIT_TEMPLATE_URL }, type) => {
    const [rawNodes, template] = await Promise.all([
        fetchGist(GIST_TOKEN, GIST_ID, type),
        fetchTemplate(GIT_TEMPLATE_URL),
    ]);

    if (!template || !Array.isArray(template.outbounds)) {
        throw new Error('Invalid template: missing outbounds array');
    }

    const nodes = rawNodes
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map(parseUrlToNode)
        .filter(Boolean);

    if (nodes.length === 0) {
        throw new Error('No valid nodes parsed from gist');
    }

    return mergeTemplate(template, nodes);
};
