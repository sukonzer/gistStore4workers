# gistStore4workers

用 GitHub Gist + Cloudflare Workers 托管订阅，并提供 sing-box / mihomo 配置转换。首页返回伪装博客。

项目提供 **两种使用模式**，可按需选用或同时使用：

| 模式 | 适用场景 | 是否需要 Secrets |
|---|---|---|
| **API 模式** | 固定 Gist 存节点，客户端直接订阅 URL | ✅ 需要 `AUTH_TOKEN` 等 |
| **UI 模式** | 浏览器里填节点 / 模板，即时生成配置或订阅链接 | ❌ 无需配置 Secret |

---

## API 模式

节点一行一条写在私有 Gist 的 `nodes` 文件里（`#` 开头为注释）。Worker 通过 token 路由拉取并转换：

| 路径 | 说明 |
|---|---|
| `/<AUTH_TOKEN>/nodes` | base64 订阅 |
| `/<AUTH_TOKEN>/singbox` | sing-box JSON 配置 |
| `/<AUTH_TOKEN>/mihomo` 或 `/clash` | mihomo (Clash.Meta) YAML |
| `/<AUTH_TOKEN>/<文件名>` | 读取 Gist 中同名文件 |

`AUTH_TOKEN` 长度 ≥ 13，路由使用常数时间比较。

### 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `AUTH_TOKEN` | ✅ | 访问路由 token |
| `GIST_TOKEN` | ✅ | GitHub PAT，需 `gist` 权限 |
| `GIST_ID` | ✅ | 目标 Gist ID |
| `GIT_SINGBOX_RAW` | 用 `/singbox` 时 | sing-box 模板 JSON 的 **raw** 链接 |
| `GIT_MIHOMO_RAW` | 用 `/mihomo` 时 | mihomo 模板 YAML 的 **raw** 链接 |

模板须为 raw 直链（如 `raw.githubusercontent.com` 或 jsDelivr），不可用 GitHub blob 页面地址。

sing-box 模板 `outbounds` 可用 `"{all}"` 占位符；mihomo 模板用 `include-all-proxies` + `filter` 分组。节点 URL 支持 ECH 参数（`ech=1`、`ech-config` 等），详见 `parse2singbox/parseUrl2Singbox.js`。

---

## UI 模式

打开 `/sub` 进入配置页，无需 `AUTH_TOKEN`：

1. **节点**：本地粘贴（每行一条 URI）或填远程订阅地址
2. **核心**：sing-box 或 mihomo
3. **模板**：本地粘贴或填远程 raw 地址
4. 点击「生成配置」，页面展示 JSON / YAML 预览

### 订阅 URL

当**节点与模板均为远程 URI** 时，会额外生成可导入客户端的订阅地址：

```
/sub/singbox?nr=<节点URL>&tr=<模板URL>
/sub/mihomo?nr=<节点URL>&tr=<模板URL>
```

`nr` 为节点订阅地址，`tr` 为模板 raw 地址；

含本地内容时只返回配置预览，需手动复制到客户端。

### API 端点

| 路径 | 方法 | 说明 |
|---|---|---|
| `/sub` | GET | 配置 UI |
| `/sub` | POST | JSON body 生成配置（同 UI 表单字段） |
| `/sub/singbox` | GET | 按 query 参数生成 sing-box 配置 |
| `/sub/mihomo` | GET | 按 query 参数生成 mihomo 配置 |

---

## 部署

### Cloudflare Dashboard（推荐）

1. Fork 仓库，在 **Workers & Pages → Create → Connect to Git** 连接
2. 框架选 **None**，构建命令留空（读取根目录 `wrangler.toml`）
3. **Settings → Variables and Secrets** 添加 API 模式所需的 Secret（仅 API 模式需要）
4. 验证：`/` 伪装博客，`/sub` UI 页，`/<AUTH_TOKEN>/singbox` 订阅

建议绑定自定义域名，`*.workers.dev` 在部分网络下不稳定。

### 本地调试

```bash
npm install
copy ".dev.vars copy.example" .dev.vars   # 填入 Secret（API 模式）
npm run dev                        # http://127.0.0.1:8787
```

UI 模式本地可直接访问 `/sub`，无需 `.dev.vars`。

### wrangler 直部署

```bash
npx wrangler login
npx wrangler secret put AUTH_TOKEN   # 逐个上传
npm run deploy
```

---

## 目录结构

```
index.js              Worker 入口
index.html            伪装博客
sub.html              UI 配置页
api/subGen.js         UI 模式 API
lib/                  构建与 URL 编解码
parse2singbox/        sing-box 解析与合并
parse2mihomo/         mihomo 解析与合并
fetchResource.js      Gist / 远程资源拉取
```

---

## License

MIT
