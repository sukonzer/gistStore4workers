// ============================================================
// 节点 + 模板 → sing-box / mihomo 配置（通用构建层）
// ============================================================
import YAML from 'yaml';
import { fetchTemplate } from '../fetchResource.js';
import { fetchRemoteNodes, assertHttpUrl } from './fetchNodes.js';
import { parseUrlToSingbox } from '../parse2singbox/parseUrl2Singbox.js';
import { mergeTemplate } from '../parse2singbox/mergeTemplate.js';
import { parseUrlToMihomo } from '../parse2mihomo/parseUrl2Mihomo.js';
import { mergeMihomoTemplate } from '../parse2mihomo/mergeTemplate.js';
import { yamlStringify } from '../parse2mihomo/yamlStringify.js';

const parseNodeLines = (rawNodes, parser) =>
    rawNodes
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map(parser)
        .filter(Boolean);

export const resolveNodes = async ({ source, local, remote }) => {
    if (source === 'local') {
        if (!local || !local.trim()) throw new Error('Local nodes content is required');
        return local.trim();
    }
    if (source === 'remote') {
        return fetchRemoteNodes(remote);
    }
    throw new Error('Invalid nodesSource');
};

export const resolveTemplate = async ({ source, local, remote }) => {
    if (source === 'local') {
        if (!local || !local.trim()) throw new Error('Local template content is required');
        return local.trim();
    }
    if (source === 'remote') {
        assertHttpUrl(remote);
        return fetchTemplate(remote);
    }
    throw new Error('Invalid templateSource');
};

export const buildSingboxConfig = (rawNodes, rawTemplate) => {
    let template;
    try {
        template = JSON.parse(rawTemplate);
    } catch (e) {
        throw new Error(`sing-box template parse failed (expected JSON): ${e.message}`);
    }
    if (!template || !Array.isArray(template.outbounds)) {
        throw new Error('Invalid template: missing outbounds array');
    }

    const nodes = parseNodeLines(rawNodes, parseUrlToSingbox);
    if (nodes.length === 0) throw new Error('No valid nodes parsed');

    return mergeTemplate(template, nodes);
};

export const buildMihomoConfig = (rawNodes, rawTemplate) => {
    let template;
    try {
        template = YAML.parse(rawTemplate);
    } catch (e) {
        throw new Error(`mihomo template parse failed (expected YAML): ${e.message}`);
    }
    if (!template || typeof template !== 'object' || Array.isArray(template)) {
        throw new Error('Invalid mihomo template: expected YAML mapping at root');
    }

    const proxies = parseNodeLines(rawNodes, parseUrlToMihomo);
    if (proxies.length === 0) throw new Error('No valid nodes parsed');

    return yamlStringify(mergeMihomoTemplate(template, proxies));
};

export const buildFromForm = async (form) => {
    const platform = form.platform;
    if (platform !== 'singbox' && platform !== 'mihomo') {
        throw new Error('Invalid platform');
    }

    const rawNodes = await resolveNodes({
        source: form.nodesSource,
        local: form.nodesLocal,
        remote: form.nodesRemote,
    });
    const rawTemplate = await resolveTemplate({
        source: form.templateSource,
        local: form.templateLocal,
        remote: form.templateRemote,
    });

    if (platform === 'singbox') {
        const config = buildSingboxConfig(rawNodes, rawTemplate);
        return {
            content: JSON.stringify(config, null, 2),
            contentType: 'application/json',
            raw: config,
        };
    }

    const yaml = buildMihomoConfig(rawNodes, rawTemplate);
    return {
        content: yaml,
        contentType: 'text/yaml',
        raw: yaml,
    };
};
