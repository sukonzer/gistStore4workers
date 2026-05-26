# gistStore4workers

> 用 GitHub Gist + Cloudflare Workers 托管订阅，顺带做轻量 sing-box / mihomo 订阅转换。

把节点链接一行一行存到一个私有 Gist 里，Worker 提供三个出口：

- 标准的 base64 订阅
- 合并模板后的 sing-box JSON 配置
- 合并模板后的 mihomo (Clash.Meta) YAML 配置，支持 **ECH**（Encrypted Client Hello）

首页返回一个伪装博客页面。

---

## 路由

| 路径 | 方法 | 说明 |
|---|---|---|
| `/` | GET/HEAD | 伪装博客首页 |
| `/<AUTH_TOKEN>/singbox` | GET/HEAD | 拉 `nodes` + 远程 sing-box 模板，合并为 sing-box JSON 配置 |
| `/<AUTH_TOKEN>/mihomo` | GET/HEAD | 拉 `nodes` + 远程 mihomo 模板，合并为 mihomo (Clash.Meta) YAML 配置 |
| `/<AUTH_TOKEN>/clash` | GET/HEAD | `mihomo` 的别名 |
| `/<AUTH_TOKEN>/nodes` | GET/HEAD | 读取 Gist 中名为 `nodes` 的文件，剥去 `#` 注释行后做 base64 编码返回（订阅协议要求） |
| `/<AUTH_TOKEN>/<其它文件名>` | GET/HEAD | 读取 Gist 中同名文件，原样以 `text/plain` 返回 |
| 其它 | * | 403 / 405 |

`AUTH_TOKEN` 必须 ≥ 13 位，路由中通过常数时间比较，规避 timing attack。文件名经路由正则 `[A-Za-z0-9._-]+` 限定。

---

## 环境变量 / Secrets

| 变量 | 必填 | 说明 |
|---|---|---|
| `AUTH_TOKEN` | ✅ | 访问路由所需 token，长度 ≥ 13 |
| `GIST_TOKEN` | ✅ | GitHub Personal Access Token，需要 `gist` 权限 |
| `GIST_ID` | ✅ | 目标 Gist 的 ID（Gist URL 末尾那一串） |
| `GIT_SINGBOX_RAW` | 用 `/singbox` 时必填 | sing-box 模板 JSON 的远程地址，**必须是 raw 链接**，例如：<br/>`https://raw.githubusercontent.com/<user>/<repo>/main/template.json`<br/>或 jsDelivr：`https://cdn.jsdelivr.net/gh/<user>/<repo>@main/template.json` |
| `GIT_MIHOMO_RAW` | 用 `/mihomo` 时必填 | mihomo (Clash.Meta) 模板的远程地址，**YAML 格式**，同样必须是 raw 链接 |

> 千万别用 `https://github.com/<user>/<repo>/blob/...`，那是网页地址，返回的是 HTML 不是模板原文。

---

## 部署到 Cloudflare（推荐方式：Dashboard + GitHub）

不需要装 wrangler、不需要 CLI，全程在浏览器里点点点。每次 `git push` 自动构建上线。

### 1. 把代码fork到自己的 GitHub 仓库
### 2. 注册 / 登录 Cloudflare
### 3. 在 Dashboard 创建并连接仓库
1. 进 Dashboard → 左侧 **Workers & Pages** → **Create** → **Workers** → **Connect to Git**
2. 授权 GitHub，选你刚刚推上去的那个仓库
3. 框架预设选 **None**；构建命令、输出目录都留空（Cloudflare 会自动读取仓库根的 `wrangler.toml`）
4. 点 **Save and Deploy**，等几十秒构建完成

完成后你会得到一个 `https://<worker-name>.<你的账户>.workers.dev` 的网址。

### 4. 在 Dashboard 上配置 Secrets

部署完后，进入你刚才创建的 Worker → **Settings** → **Variables and Secrets** → **Add variable**，逐个添加：

| Name | Type | Value |
|---|---|---|
| `AUTH_TOKEN` | **Secret** | 你自己生成的随机串（≥13 位） |
| `GIST_TOKEN` | **Secret** | GitHub Gist Token |
| `GIST_ID` | **Secret** | Gist ID |
| `GIT_SINGBOX_RAW` | **Secret** | sing-box 模板 raw 链接（启用 `/singbox` 时必需） |
| `GIT_MIHOMO_RAW` | **Secret** | mihomo 模板 raw 链接（启用 `/mihomo` 时必需） |

> Type 一定选 **Secret**（加密、不可回显）而不是 Plaintext。

保存后 Cloudflare 会自动重新部署，无需手动操作。

### 5. 验证

浏览器打开：

- `https://<worker-name>.<账户>.workers.dev/` → 伪装博客
- `https://<worker-name>.<账户>.workers.dev/<AUTH_TOKEN>/singbox` → sing-box 配置 JSON
- `https://<worker-name>.<账户>.workers.dev/<AUTH_TOKEN>/mihomo` → mihomo / Clash.Meta YAML
- `https://<worker-name>.<账户>.workers.dev/<AUTH_TOKEN>/nodes` → base64 订阅

> 💡 **建议绑定自定义域名**：`*.workers.dev` 子域名在部分网络环境下访问不稳定（被污染或限流），强烈建议在 Worker → **Settings → Domains & Routes → Add → Custom domain** 绑一个自己的域名（前提是该域名已托管在 Cloudflare）。绑定后即可用 `https://<你的域名>/<AUTH_TOKEN>/singbox` 访问，更稳更隐蔽。

### 6. 以后怎么更新

直接 `git push`，Cloudflare 自动重新构建部署，几十秒生效。改 secret 在 Dashboard 上改即可。

---

## 本地调试（可选）

只在本机预览/改代码时用，不部署线上。

### 1. 安装依赖

```bash
npm install
```

会安装 `wrangler`（dev 依赖，约 30 MB）和 `yaml`（运行时依赖，约 1 MB，用于解析 mihomo 模板）。

### 2. 准备本地 secrets

```bash
# Windows PowerShell
copy .dev.vars.example .dev.vars
# macOS / Linux
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars` 填入真实值。`wrangler dev` 会自动把它们注入到 `env.XXX`，行为与线上 secret 完全一致。`.dev.vars` 已加入 `.gitignore`，不会被提交。

> 本地 secret 和线上 secret 是**两套独立的**，互不影响。本地用 `.dev.vars`，线上用 Cloudflare Dashboard。

### 3. 启动 dev server

```bash
npm run dev
```

默认监听 `http://127.0.0.1:8787`。终端快捷键：

- `b` 在浏览器中打开
- `d` 打开 Chrome DevTools，可下断点调试 worker JS
- `l` 切换本地/远程模式
- `x` 退出

代码改动会自动热更新。

### 4. 发请求验证

```bash

# base64 订阅
curl http://127.0.0.1:8787/<AUTH_TOKEN>/nodes

# sing-box JSON
curl http://127.0.0.1:8787/<AUTH_TOKEN>/singbox

# mihomo YAML
curl http://127.0.0.1:8787/<AUTH_TOKEN>/mihomo
```
---

## Gist 内容格式

在你的 Gist 中创建一个名为 `nodes` 的文件，每行一个通用节点 URL，`#` 开头的行视为注释自动忽略：

```
# 香港节点
vless://xxxx
# 日本节点
ss://xxxx
```

支持的协议见 `parse2singbox/parseUrl2Singbox.js`。文件超过 1 MB 时会自动通过 `raw_url` 兜底拉全。

---

## sing-box 模板

模板是一份标准的 sing-box JSON 配置，`outbounds` 中可以用 `"{all}"` 作为占位符，Worker 会把它替换成解析后的节点 tag 列表，并支持基于关键字的过滤：

```json
{
  "outbounds": [
    {
      "type": "selector",
      "tag": "PROXY",
      "outbounds": ["{all}"]
    },
    {
      "type": "urltest",
      "tag": "AUTO-HK",
      "outbounds": ["{all}"],
      "filter": [
        { "action": "include", "keywords": ["HK", "香港"] },
        { "action": "exclude", "keywords": ["试用|trial"] }
      ]
    }
  ]
}
```

过滤语义：先 include（任一命中保留；无 include 规则则全部进入），再 exclude（任一命中剔除）。非法正则会自动退化为字面量匹配。当一个 outbounds 数组最终为空时，会自动注入一个 `COMPATIBLE` direct 出口兜底，避免 sing-box 启动失败。

---

## mihomo (Clash.Meta) 模板

模板就是一份标准的 mihomo / Clash.Meta YAML 配置（用 [`yaml`](https://www.npmjs.com/package/yaml) 解析）。Worker 只负责把 Gist 里的 URI 转成 `proxies` 条目并**追加**到模板；`proxy-groups` 怎么分组、怎么筛节点，完全按 [mihomo 官方字段](https://wiki.metacubex.one/en/config/proxy-groups/) 在模板里写（例如 `include-all-proxies` + `filter` / `exclude-filter` 正则）。

```yaml
mixed-port: 7890
mode: rule
log-level: info

dns:
  enable: true
  nameserver:
    - https://1.1.1.1/dns-query

proxy-groups:
  - name: PROXY
    type: select
    include-all-proxies: true

  - name: AUTO-HK
    type: url-test
    url: https://www.gstatic.com/generate_204
    interval: 300
    include-all-proxies: true
    filter: "(?i)港|hk|hongkong"
    exclude-filter: "试用|trial"

rules:
  - MATCH,PROXY
```

> `filter` / `exclude-filter` 是**字符串正则**（多个条件用反引号 `` ` `` 分隔表示 OR），由 mihomo 内核在运行时按节点名称筛选，不是 sing-box 那套 `action` / `keywords` 数组。

---

## ECH（Encrypted Client Hello）支持

sing-box 与 mihomo 输出均支持 ECH。Gist 中 `nodes` 文件的节点 URL 通过 query 参数（`vmess://` 则放在它本身的 base64 JSON 里）声明：

| 参数 | 别名 | 说明 |
|---|---|---|
| `ech=1` | — | 启用 ECH，通过 DNS 查 HTTPS RR 自动发现（查询域名默认用节点 SNI） |
| `ech-config=<base64>` | `echConfig` / `ech_config` | 固定 ECHConfigList（URL-encode 后放入 query） |
| `ech=<域名>+<DoH URL>` | — | Xray 风格，如 `cloudflare-ech.com+https://223.5.5.5/dns-query`；`+` 前域名写入 `query-server-name` |
| `ech=https://…/dns-query` | — | 仅指定 DoH（启用 ECH，查询域名仍用 SNI） |
| `query-server-name=<域名>` | `queryServerName` | 单独指定 ECH 的 HTTPS RR 查询域名（与 `sni` 可不同） |
| `ech-pq=1` | `echPq` / `ech_pq` | 后量子签名（仅 sing-box） |

对应输出（节选）：

- sing-box（≥ 1.13 支持 `query_server_name`）：
  ```json
  "ech": {
    "enabled": true,
    "query_server_name": "cloudflare-ech.com"
  }
  ```
  有 `ech-config` 时额外写入 `config`（PEM 行数组）。

- mihomo：
  ```yaml
  ech-opts:
    enable: true
    query-server-name: cloudflare-ech.com
  ```
  有 `ech-config` 时额外写入 `config`。

> **关于 `query-server-name`**：用于覆盖「查 ECH 用的 HTTPS DNS 记录」时的域名；留空则由内核用节点 `sni` / `servername`。Cloudflare 场景常写 `cloudflare-ech.com`，而真实站点仍在 `sni` 里。  
> **关于 `ech=…+https://…/dns-query` 里的 DoH**：Xray 会把整段写进 `echConfigList`；mihomo / sing-box 的单节点 outbound **没有**对应字段，DoH 需在订阅模板的 **全局 `dns`** 里配置（例如 `nameserver: https://223.5.5.5/dns-query`），否则 ECH 发现会走默认解析器。

---

## 目录结构

```
.
├── index.js                       # Worker 入口（路由、鉴权、响应）
├── index.html                     # 首页伪装博客（由 index.js 作为 text 模块 import）
├── fetchResource.js               # Gist / 模板拉取（truncated 兜底 + Cache API 缓存）
├── lib/
│   └── urlHelpers.js              # 共用 helpers（端口、base64、ECH 参数等）
├── parse2singbox/
│   ├── index.js                   # sing-box 编排：拉 Gist + 模板 → 解析 → 合并
│   ├── parseUrl2Singbox.js        # 节点 URL → sing-box outbound（含 ECH）
│   └── mergeTemplate.js           # {all} 占位、include/exclude 过滤、空 group 兜底
├── parse2mihomo/
│   ├── index.js                   # mihomo 编排
│   ├── parseUrl2Mihomo.js         # 节点 URL → mihomo proxy（含 ECH）
│   ├── mergeTemplate.js           # 将解析节点追加到 proxies
│   └── yamlStringify.js           # 无依赖的 YAML 序列化
├── wrangler.toml                  # Cloudflare Workers 配置（含 HTML text 模块规则）
├── package.json                   # 依赖：wrangler (dev) + yaml (runtime, 解析 mihomo 模板)
├── .dev.vars.example              # 本地 secrets 模板（复制为 .dev.vars 后填值）
└── .gitignore
```

---

## 进阶：本地 wrangler 直接部署（不走 GitHub）

如果不想接 GitHub 仓库、想从本机直接推到 Cloudflare：

```bash
npx wrangler login                            # 浏览器授权
npx wrangler secret put AUTH_TOKEN            # 逐个上传 secret
npx wrangler secret put GIST_TOKEN
npx wrangler secret put GIST_ID
npx wrangler secret put GIT_SINGBOX_RAW
npx wrangler secret put GIT_MIHOMO_RAW   # 仅启用 /mihomo 时需要
npm run deploy                                # = wrangler deploy
npm run tail                                  # 查看线上实时日志
```

适合个人玩具、临时部署。日常迭代仍然推荐走 GitHub 集成。

---

## License

MIT
