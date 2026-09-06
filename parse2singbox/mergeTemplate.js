// ============================================================
// 模板合并
// ============================================================

// 过滤代理：先 include（任意命中保留；无 include 规则则全部进入），再 exclude（命中即剔除）。
// 普通字符串作为不区分大小写的正则源码；/模式/flags 形式可指定 flags。
function filterProxies(proxies, include, exclude) {
    const compileRules = (rules) =>
        (Array.isArray(rules) ? rules : [])
            .filter((rule) => typeof rule === 'string' || rule instanceof RegExp)
            .map((rule) => {
                if (rule instanceof RegExp) {
                    return new RegExp(rule.source, rule.flags.replace(/[gy]/g, ''));
                }

                const regexLiteral = /^\/(.*)\/([a-z]*)$/.exec(rule);
                if (regexLiteral) {
                    try {
                        return new RegExp(regexLiteral[1], regexLiteral[2].replace(/[gy]/g, ''));
                    } catch {
                        // 非法正则退化为字面量匹配，避免一条规则导致整个订阅生成失败。
                    }
                }

                try {
                    return new RegExp(rule, 'i');
                } catch {
                    return new RegExp(rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                }
            });

    const includeRes = compileRules(include);
    const excludeRes = compileRules(exclude);

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

export const mergeTemplate = (template, nodes) => {
    const config = deepClone(template);
    const fallback = { tag: 'COMPATIBLE', type: 'direct' };
    let hasFallback = false;
    const globalInclude = config.include;
    const globalExclude = config.exclude;

    delete config.include;
    delete config.exclude;

    // 1) 注入全部节点
    config.outbounds.push(...nodes);

    // 2) {all} 占位替换
    config.outbounds.forEach((obd) => {
        if (Array.isArray(obd.outbounds) && obd.outbounds.includes('{all}')) {
            obd.outbounds = filterProxies(
                nodes,
                obd.include ?? globalInclude,
                obd.exclude ?? globalExclude,
            );
            delete obd.include;
            delete obd.exclude;
            delete obd.filter;
        }
    });

    // 3) 空 outbounds 容错
    config.outbounds.forEach((obd) => {
        if (Array.isArray(obd.outbounds) && obd.outbounds.length === 0) {
            if (!hasFallback) {
                config.outbounds.push(fallback);
                hasFallback = true;
            }
            obd.outbounds.push(fallback.tag);
        }
    });

    return config;
};
