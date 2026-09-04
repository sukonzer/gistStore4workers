// ============================================================
// 模板合并
// ============================================================

// 过滤代理：先 include（任意命中保留；无 include 规则则全部进入），再 exclude（命中即剔除）
function filterProxies(proxies, filter) {
    if (!Array.isArray(filter) || filter.length === 0) {
        return proxies.map((p) => p.tag);
    }

    const includes = filter.filter((f) => f.action === 'include' && Array.isArray(f.keywords));
    const excludes = filter.filter((f) => f.action === 'exclude' && Array.isArray(f.keywords));

    const compileKeywords = (rules) =>
        rules
            .flatMap((r) => r.keywords)
            .filter(Boolean)
            .map((kw) => {
                try {
                    return new RegExp(kw, 'i');
                } catch {
                    // 关键词若为非法正则，则退化为字面量匹配
                    return new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                }
            });

    const includeRes = compileKeywords(includes);
    const excludeRes = compileKeywords(excludes);

    return proxies
        .filter((p) => {
            const tag = p.tag || '';
            const okInclude = includeRes.length === 0 || includeRes.some((re) => re.test(tag));
            const okExclude = excludeRes.every((re) => !re.test(tag));
            return okInclude && okExclude;
        })
        .map((p) => p.tag);
}

// 优先使用 structuredClone，老环境兜底 JSON 深拷贝
const deepClone = (obj) =>
    typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));

const DIRECT_OUTBOUND = { tag: 'DIRECT', type: 'direct' };

export const mergeTemplate = (template, nodes) => {
    const config = deepClone(template);

    // 1) 注入全部节点
    config.outbounds.push(...nodes);

    // 2) {all} 占位替换
    config.outbounds.forEach((obd) => {
        if (Array.isArray(obd.outbounds) && obd.outbounds.includes('{all}')) {
            obd.outbounds = filterProxies(nodes, obd.filter);
            delete obd.filter;
        }
    });

    // 3) 配置里没有 direct 出站时才补全，并修正空 outbounds 引用
    if (!config.outbounds.some((obd) => obd.type === 'direct')) {
        config.outbounds.push(DIRECT_OUTBOUND);

        config.outbounds.forEach((obd) => {
            if (Array.isArray(obd.outbounds) && obd.outbounds.length === 0) {
                obd.outbounds.push(DIRECT_OUTBOUND);
            }
        });
    }

    return config;
};
