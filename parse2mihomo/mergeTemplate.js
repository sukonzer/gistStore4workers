// ============================================================
// mihomo (Clash.Meta) 模板合并
// ============================================================
// Worker 只做一件事：把从 URI 解析出的节点追加到模板的 proxies 列表。
// proxy-groups 的筛选交给 mihomo 内核（filter / exclude-filter + include-all-proxies 等）。

const deepClone = (obj) =>
    typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));

export const mergeMihomoTemplate = (template, proxies) => {
    const config = deepClone(template);
    if (!Array.isArray(config.proxies)) config.proxies = [];
    config.proxies.push(...proxies);
    return config;
};
