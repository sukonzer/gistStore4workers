import YAML from 'yaml';
import { fetchGist, fetchTemplate } from '../fetchResource.js';
import { parseUrlToMihomo } from './parseUrl2Mihomo.js';
import { mergeMihomoTemplate } from './mergeTemplate.js';
import { yamlStringify } from './yamlStringify.js';

// 解析 + 合并模板 + 输出 YAML 字符串
// 模板格式：YAML（标准 mihomo / Clash.Meta 配置）
export const parse2mihomo = async ({ GIST_TOKEN, GIST_ID, GIT_MIHOMO_RAW }, type) => {
    if (!GIT_MIHOMO_RAW) {
        throw new Error('GIT_MIHOMO_RAW not configured');
    }

    const [rawNodes, rawTemplate] = await Promise.all([
        fetchGist(GIST_TOKEN, GIST_ID, type),
        fetchTemplate(GIT_MIHOMO_RAW),
    ]);

    let template;
    try {
        template = YAML.parse(rawTemplate);
    } catch (e) {
        throw new Error(`mihomo template parse failed (expected YAML): ${e.message}`);
    }

    if (!template || typeof template !== 'object' || Array.isArray(template)) {
        throw new Error('Invalid mihomo template: expected YAML mapping at root');
    }

    const proxies = rawNodes
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map(parseUrlToMihomo)
        .filter(Boolean);

    if (proxies.length === 0) {
        throw new Error('No valid nodes parsed from gist');
    }

    const config = mergeMihomoTemplate(template, proxies);
    return yamlStringify(config);
};
