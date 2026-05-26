// ============================================================
// 极简 YAML 序列化（JS object/array/标量 → YAML 字符串）
// ============================================================
// 设计目标：足以输出 mihomo (Clash.Meta) 订阅配置，不追求覆盖整个 YAML 规范。
//
// 取舍：
//   - 字符串默认 plain；遇到不安全字符或可能被误解为其它标量时降级为双引号字符串
//   - 双引号字符串按 YAML double-quoted 规则转义 `\\` / `"` / 控制字符
//   - 数字 / 布尔 / null 直接按其规范字面量输出
//   - 数组 / 对象采用 block style；空数组输出为 `[]`，空对象输出为 `{}`
//   - 不输出 anchor / alias / 多文档分隔

// YAML 1.2 中会被解析为非字符串的字面量；裸输出时必须加引号
const YAML_RESERVED_LITERALS = new Set([
    '', 'null', 'Null', 'NULL', '~',
    'true', 'True', 'TRUE',
    'false', 'False', 'FALSE',
    'yes', 'Yes', 'YES',
    'no', 'No', 'NO',
    'on', 'On', 'ON',
    'off', 'Off', 'OFF',
]);

// 看上去像数字 / 时间戳的字符串，裸输出会被解析成非字符串
const looksLikeNumber = (s) =>
    /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s) ||
    /^[+-]?0x[0-9a-fA-F]+$/.test(s) ||
    /^[+-]?0o[0-7]+$/.test(s);

// 字符串是否可以裸输出为 plain scalar
const isPlainSafe = (s) => {
    if (s.length === 0) return false;
    if (YAML_RESERVED_LITERALS.has(s)) return false;
    if (looksLikeNumber(s)) return false;
    // 起始字符限制
    if (/^[\s\-?:,\[\]{}#&*!|>'"%@`]/.test(s)) return false;
    // 整体不可包含的子串与字符
    if (/[\x00-\x1f\x7f]/.test(s)) return false;
    if (/:(?:\s|$)/.test(s)) return false;
    if (/\s#/.test(s)) return false;
    if (/[\[\]{},&*!|>'"`]/.test(s)) return false;
    if (/[\s]$/.test(s)) return false;
    return true;
};

const escapeDouble = (s) =>
    s.replace(/[\\"\x00-\x1f\x7f]/g, (ch) => {
        switch (ch) {
            case '\\': return '\\\\';
            case '"': return '\\"';
            case '\n': return '\\n';
            case '\r': return '\\r';
            case '\t': return '\\t';
            case '\b': return '\\b';
            case '\f': return '\\f';
            default:
                return '\\x' + ch.charCodeAt(0).toString(16).padStart(2, '0');
        }
    });

const scalar = (v) => {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) return v > 0 ? '.inf' : v < 0 ? '-.inf' : '.nan';
        return String(v);
    }
    if (typeof v === 'bigint') return v.toString();
    const s = String(v);
    if (isPlainSafe(s)) return s;
    return `"${escapeDouble(s)}"`;
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// 在 mapping value 里输出一个嵌套 array / object（或标量），
// 维持 child 比 key 至少多缩进一级（2 chars）。
const dumpValue = (v, indent, keyLine, lines) => {
    if (Array.isArray(v)) {
        if (v.length === 0) {
            lines.push(`${keyLine} []`);
        } else {
            lines.push(keyLine);
            dumpArray(v, indent + 1, lines);
        }
        return;
    }
    if (isObject(v)) {
        const subKeys = Object.keys(v).filter((kk) => v[kk] !== undefined);
        if (subKeys.length === 0) {
            lines.push(`${keyLine} {}`);
        } else {
            lines.push(keyLine);
            dumpObject(v, indent + 1, lines);
        }
        return;
    }
    lines.push(`${keyLine} ${scalar(v)}`);
};

const dumpObject = (obj, indent, lines) => {
    const pad = '  '.repeat(indent);
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
    if (keys.length === 0) {
        lines.push(`${pad}{}`);
        return;
    }
    for (const k of keys) {
        dumpValue(obj[k], indent, `${pad}${scalar(k)}:`, lines);
    }
};

const dumpArray = (arr, indent, lines) => {
    const pad = '  '.repeat(indent);
    if (arr.length === 0) {
        lines.push(`${pad}[]`);
        return;
    }
    for (const item of arr) {
        if (Array.isArray(item)) {
            if (item.length === 0) {
                lines.push(`${pad}- []`);
            } else {
                lines.push(`${pad}-`);
                dumpArray(item, indent + 1, lines);
            }
            continue;
        }
        if (isObject(item)) {
            const keys = Object.keys(item).filter((k) => item[k] !== undefined);
            if (keys.length === 0) {
                lines.push(`${pad}- {}`);
                continue;
            }
            // sequence item 内嵌 mapping：第一行用 `- key: ...`，余下 key 对齐到 `- ` 后
            const [first, ...rest] = keys;
            const innerPad = pad + '  ';
            const firstVal = item[first];
            dumpValue(firstVal, indent + 1, `${pad}- ${scalar(first)}:`, lines);
            for (const k of rest) {
                dumpValue(item[k], indent + 1, `${innerPad}${scalar(k)}:`, lines);
            }
            continue;
        }
        lines.push(`${pad}- ${scalar(item)}`);
    }
};

const dump = (value, indent, lines) => {
    if (Array.isArray(value)) return dumpArray(value, indent, lines);
    if (isObject(value)) return dumpObject(value, indent, lines);
    const pad = '  '.repeat(indent);
    lines.push(`${pad}${scalar(value)}`);
};

export const yamlStringify = (value) => {
    const lines = [];
    dump(value, 0, lines);
    return lines.join('\n') + '\n';
};
