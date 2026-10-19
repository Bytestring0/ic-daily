# 微电子简报 · IC Daily

每日**微电子 / 集成电路**行业动态。RSS 采集 → 去重打分 → AI 撰写 → Astro 静态生成 → GitHub Pages 发布。

## 新闻质量与 AI 发现

渠道分为厂商公告、行业媒体与主题搜索。新增 AMD、SK hynix、三星、ST 官方公告、eeNews Europe，并启用 Semiconductor Digest。所有发布方都经过统一的相关性与新闻性审核，没有媒体白名单免检。

流程是：AI 规划中英文检索词 → RSS / 搜索采集 → 排除周报、营销、教程、数码周边和泛 AI 内容 → 读取原文及发布时间 → AI 编辑判断新事实、逐字证据与历史重复 → 每事件一条 → AI 撰写。

默认目标 18 条、最低覆盖目标 15 条、上限 24 条，每个发布方最多 8 条，时间窗 48 小时；与最近 7 天已报道事件比对。普通但有具体新事实的芯片动态也会收录，不只收重大事件。覆盖不足会记录在质量报告中，不伪造事件。调整采集规则后可运行 `npm run news:expand`，从本次私有缓存中审核尚未收录的线索，保留已通过的稿件并补充新条目。

优先读取原文。原文被付费墙或网络拦截时，发布方 RSS 中足够完整的正文或公开摘要也可作为证据；使用公开摘要的条目会明确标记，不能补写摘要没有的细节。搜索引擎片段不能替代原文。日期不符或资料不足仍会淘汰；启用 AI 时，编辑或撰写失败会停止发布，零条通过审核时保留已有期次。

简洁模式每条包含较完整的摘要，以及 1–4 张带小标题的详细要点卡片。内容充足时每张约 45–120 字，涵盖参数、时间、应用范围或进展；资料不足不硬凑卡片。

`npm run daily` 的私有诊断文件位于 `.cache/news/YYYY-MM-DD.raw.json`、`.read.json` 与 `.quality.json`，可看到渠道健康、检索词、原文和每条淘汰原因。构建后的条目保留原始标题、来源 URL、读取时间及编辑证据。`npm run ai:refresh` 会重新读取原文并重新筛选，不再反复改写 AI 摘要。

主题检索默认使用无 Key 的公共 Bing RSS。它可能返回百科、无关内容或旧文，不能把搜索结果日期当作新闻发布日期；这些结果仍需通过原文门槛。需要稳定的新闻搜索服务时，可在 `.env` 中配置 `NEWS_SEARCH_PROVIDER=brave` 与 `BRAVE_SEARCH_API_KEY`，使用 [Brave News Search](https://api-dashboard.search.brave.com/app/documentation/news-search/get-started)。这是独立服务，不能把语言模型 Key 当作搜索 Key。未配置的付费搜索服务不会发起调用。

原文证据匹配能约束编造，不能替代独立事实核查；厂商自述、计划、传闻必须保留其不确定性。

### EETOP 与其他公众号

已添加 EETOP、半导体行业观察、半导体产业纵横的第三方公众号 RSS 中转；这些不是公众号官方 API，当前本地网络访问中转站失败，采集报告会如实显示。可在 GitHub Secrets 中设置 `EETOP_RSS_URL` 换成自己的 we-mp-rss / 公众号 RSS 服务地址，或直接编辑 `config/sources.yaml` 的相应 URL。原始文章链接保留为微信链接，不绕过登录和验证码。

另新增 TechPowerUp、Power Electronics News、Electronics-Lab，继续按半导体相关性过滤消费电子整机、周边、教程与合集。

## 部署成功后发送一张图片日报

GitHub Actions 的 `notify` 任务在 Pages 部署成功且日报内容有更新后运行：重建页面 → 将简洁模式的新闻卡片排成双列长图 → 生成一张 PNG → 通过 SMTP 作为邮件内嵌图片发送。不会向收件人发送整段新闻纯文字。

**收件邮箱没有默认值，也不会写进代码、配置样例、截图、构建产物或公开日志。** 所有地址和发信凭据仅从环境变量 / GitHub Secrets 读取。多个收件人用逗号分隔，分别发送，互相不可见。

在仓库 **Settings → Secrets and variables → Actions** 配置：

| 类型 | 名称 | 内容 |
|---|---|---|
| Variable | `MAIL_ENABLED` | `true` 开启；未设置则不发邮件 |
| Secret | `MAIL_TO` | 收件邮箱，支持逗号分隔的多个地址 |
| Secret | `SMTP_HOST` | 发信服务器，例如 `smtp.qq.com` |
| Secret | `SMTP_USER` | 发信邮箱账号 |
| Secret | `SMTP_PASS` | 邮箱的 SMTP 授权码，不能使用 QQ 登录密码 |
| Secret | `MAIL_FROM` | 可选，默认等于 `SMTP_USER` |
| Variable | `SMTP_PORT` | 可选，默认 `465` |
| Variable | `SMTP_SECURE` | 可选，默认 `true`；587 + STARTTLS 使用 `false` |

QQ 邮箱可在邮箱设置的“账号/安全”中开启 POP3/SMTP 或 IMAP/SMTP，并生成授权码，填入 `SMTP_PASS`。发信邮箱与收件邮箱可以相同，也可以不同；更换收件人只需修改 `MAIL_TO` Secret。

本地检查图片和邮件正文，不发送：

```bash
npm run build
npm run mail:image -- --browser=chrome
npm run mail:preview
```

文件位于 `.cache/mail/digest.png` 和 `.cache/mail/preview.html`（均 gitignore）。CI 会安装 Chromium 和中文字体，并上传仅含 PNG 的 `digest-image` Artifact。邮件配置缺失时不会尝试使用任何硬编码邮箱。当前只验证了离线邮件构造和模拟 SMTP，真实发送需先配置授权码。

## 阅读界面

三栏结构：左侧导航（日历、搜索、主题），中间正文，右侧目录。右上角可在两种模式间切换，选择会保存在浏览器。

| 模式 | 形态 | 用途 |
|---|---|---|
| 阅读模式 | 索引 + 逐条正文，右侧目录跟随滚动高亮 | 通读当日全部动态 |
| 简洁模式 | 铜橙色大标题 + 要点四宫格卡片，顶部分类 tab | 快速扫读、投屏、截图分享 |

另支持明暗主题、日历切换期次、关键词搜索（`Ctrl / ⌘ + K`）、手机单栏布局。

```bash
npm install
npm run daily        # 抓取 + AI 改写，生成今日期次
npm run build        # 构建静态站点到 dist/
npm run dev          # 本地预览
npm run ai:refresh   # 只用 AI 重写已有一期；原始数据备份到 .cache/

# 指定期次
npm run ai:refresh -- --date=2026-10-17
```
---

## 快速开始

```bash
npm install

# 生成今天的日报（不配 API key 也能跑，走规则模式）
npm run daily

# 本地预览
npm run dev            # http://localhost:4321

# 构建静态站
npm run build          # 产物在 dist/
```

### 启用 AI 改写（可选但推荐）

任选一家兼容 OpenAI 接口的服务，设置三个环境变量即可：

```bash
# Linux / macOS
export LLM_BASE_URL="https://api.deepseek.com/v1"
export LLM_API_KEY="sk-xxxxxxxx"
export LLM_MODEL="deepseek-chat"

# Windows PowerShell
$env:LLM_BASE_URL="https://api.deepseek.com/v1"
$env:LLM_API_KEY="sk-xxxxxxxx"
$env:LLM_MODEL="deepseek-chat"
```

常见取值：

| 服务 | LLM_BASE_URL | LLM_MODEL 示例 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 阿里百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| 月之暗面 | `https://api.moonshot.cn/v1` | `kimi-k2-0905-preview` |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-plus` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| 本地 Ollama | `http://localhost:11434/v1` | `qwen2.5:14b` |

**没配 key 会怎样？** 使用规则筛选和原文摘要，不启用 AI 编辑；原文和日期门槛仍然适用。没有合格条目时不生成新期次。

---

## 命令一览

| 命令 | 作用 |
|---|---|
| `npm run daily` | 抓取并生成今天这一期 |
| `npm run daily -- --date=2026-01-15` | 生成指定日期 |
| `npm run index` | 仅重建期次索引（content/index.json） |
| `npm run dev` | 本地开发预览 |
| `npm run build` | 构建静态站点到 `dist/` |
| `npm run pipeline:build` | 生成 + 构建（CI 用的组合命令） |

---

## 项目结构

```
ic-daily/
├── config/
│   └── sources.yaml          ← 信息源列表，改这个文件即可增删源
├── scripts/                  ← 数据流水线（Node，无框架依赖）
│   ├── run.mjs               入口
│   ├── config.mjs            配置加载
│   ├── collect.mjs           ① 并发抓取 RSS / 解析 / 去重
│   ├── curate.mjs            ②③ 关键词打分 / 过滤 / 精选
│   ├── write.mjs             ④ LLM 改写（OpenAI 兼容）
│   ├── edition.mjs           ⑤ 组装 JSON / 重建索引
│   └── util.mjs              日志与并发工具
├── content/                  ← 数据产物（网站的唯一数据源）
│   ├── index.json            期次索引
│   └── editions/
│       └── 2026-01-15.json   单期完整数据
├── src/                      ← Astro 前端
│   ├── pages/
│   │   ├── index.astro       首页（当日）
│   │   ├── archive.astro     往期归档
│   │   ├── about.astro       关于
│   │   ├── rss.xml.js        RSS 输出
│   │   └── edition/[date].astro  单期详情
│   ├── components/EntryCard.astro
│   ├── layouts/Base.astro
│   ├── lib/content.js        数据读取
│   └── styles/global.css     视觉系统
└── .github/workflows/daily.yml  每日定时 + 部署
```

---

## 数据流

```
sources.yaml
     │
     ▼
① discover ── AI 规划主题检索；厂商公告与媒体 RSS 并行采集
     ▼
② collect  ── 解析 RSS/Atom / 新闻搜索结果 → URL+标题去重
     │        单个源失败只记 [SKIP]，不中断
     ▼
③ curate   ── 统一相关性、新闻性、时效性门槛
     ▼
④ articles ── 读取原始报道；不可读 / 付费墙 / 日期不符则淘汰
     ▼
⑤ editor   ── AI 编辑 + 原文摘录校验 + 7天事件去重 + 来源配额
     ▼
⑥ write    ── 根据原文撰写标题 / 摘要 / 要点；AI 失败则停止发布
     ▼
⑦ edition  ── 保存证据、质量统计与期次 JSON + 重建索引
     ▼
Astro 静态生成  →  dist/  →  GitHub Pages
```

**设计要点：AI 只负责语义，排版全部由代码完成。**
这样输出稳定、可复现，不会因模型波动导致版面崩坏。

---

## 自定义

### 增删信息源

编辑 `config/sources.yaml`：

```yaml
sources:
  - name: 我的信源
    url: https://example.com/feed.xml
    lang: zh            # zh | en
    category: foundry   # foundry|equipment|eda|memory|design|material|policy|research|market
    weight: 8           # 0-10，影响排序
    enabled: true
```

内置渠道（每次运行会报告实际可用性，不能将失效源记为成功）：

| 类别 | 信源 |
|---|---|
| 厂商公告 | AMD、SK hynix、Samsung、STMicroelectronics、NVIDIA |
| 英文深度媒体 | Semiconductor Engineering、Semiconductor Today、Semiconductor Digest、SemiAnalysis、SemiWiki、EE Times、EE Times Asia、Bits&Chips、eeNews Europe |
| 英文设计/嵌入 | EDN、Embedded.com、Tom's Hardware |
| 产业与市场 | DIGITIMES、IEEE Spectrum Semiconductors、NVIDIA Newsroom |
| 中文媒体 | 芯东西、雷锋网、IT之家、cnBeta |
| 主题发现 | AI 规划的中英文搜索，覆盖固定来源之外的原文 |

### 调整领域关键词

编辑 `scripts/quality.mjs` 中的主题、事件动作和排除规则；语义编辑标准位于 `scripts/editor.mjs`。修改后运行 `npm test`，确保不会重新放入周边、合集与跨媒体重复事件。

### 调整产出规模

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `EDITION_LIMIT` | 24 | 每期上限 |
| `EDITION_TARGET` | 18 | 目标条数 |
| `EDITION_MINIMUM` | 15 | 覆盖不足时记录警示 |
| `WINDOW_HOURS` | 48 | 原文发布日期时间窗 |
| `PER_SOURCE_LIMIT` | 8 | 每期单个发布方上限 |
| `HISTORY_DAYS` | 7 | 历史事件去重范围 |
| `NEWS_DISCOVERY` | true | 启用 AI 主题检索规划 |
| `LLM_CONCURRENCY` | 3 | LLM 并发请求数 |
| `FETCH_CONCURRENCY` | 6 | RSS 抓取并发数 |

---

## 部署到 GitHub Pages

1. 新建仓库并推送：

```bash
git init
git add .
git commit -m "init: 微电子简报"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

2. 仓库 **Settings → Actions → General → Workflow permissions** 选
   **Read and write permissions**（定时任务需要 push 数据）。

3. 仓库 **Settings → Pages → Source** 选 **GitHub Actions**。

4. （可选）**Settings → Secrets and variables → Actions** 添加
   `LLM_API_KEY`（以及可选的 `LLM_BASE_URL` / `LLM_MODEL`）。

5. 到 **Actions** 标签页手动跑一次 `Daily IC Digest` 验证。

之后每天北京时间约 **09:10** 自动生成并部署。

> 站点地址根据仓库名自动判断：
> - 仓库名是 `<user>.github.io` → 部署在根路径
> - 其他仓库 → 部署在 `https://<user>.github.io/<repo>/`
>
> 这个逻辑写在 workflow 的「计算 site 与 base 路径」步骤里，无需手动改配置。

---

## 免责声明

内容由 AI 辅助聚合生成，**可能存在事实错误或时效偏差**，不构成任何投资建议。
所有条目均保留原始链接，关键信息请核对原文。内容版权归原作者所有，本站仅做聚合索引。

## License

MIT
