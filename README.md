# 微电子简报 · IC Daily

每日**微电子 / 集成电路**行业动态。RSS 采集 → 去重打分 → AI 撰写 → Astro 静态生成 → GitHub Pages 发布。

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

> **密钥安全**：页面为纯静态，不含任何 AI 调用代码。模型只在构建期由 Node.js 调用，
> key 从 `.env`（已 gitignore）或 CI Secrets 读取，不会进入 `dist/`，也不会暴露给浏览器。

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

**没配 key 会怎样？** 不会报错。流水线自动降级为规则模式：标题直接清洗、摘要取原文。
站点照常生成，只是文案质量下降。

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
① collect  ── 并发抓取 18 个源 → 解析 RSS/Atom → URL+标题去重
     │        单个源失败只记 [SKIP]，不中断
     ▼
② curate   ── 半导体关键词表打分（制程/光刻/封装/政策/厂商…）
     │        叠加时效权重、源权重、噪音惩罚
     ▼
③ select   ── 按主标签分散（同类最多 4 条）→ 取 Top 24
     ▼
④ write    ── LLM 输出严格 JSON（标题/摘要/要点/分类/重要度）
     │        分批并发，失败自动回退规则摘要
     ▼
⑤ edition  ── 组装 content/editions/YYYY-MM-DD.json + 重建索引
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

内置源（均已实测可抓取）：

| 类别 | 信源 |
|---|---|
| 英文深度媒体 | Semiconductor Engineering、Semiconductor Today、SemiAnalysis、SemiWiki、EE Times、EE Times Asia、Bits&Chips、Light Reading |
| 英文设计/嵌入 | EDN、Embedded.com、AnandTech、Tom's Hardware |
| 产业与市场 | DIGITIMES、IEEE Spectrum Semiconductors、NVIDIA Newsroom |
| 中文媒体 | 芯东西、雷锋网、IT之家、cnBeta |
| 研究 | arXiv cs.AR |

### 调整领域关键词

编辑 `scripts/curate.mjs` 里的 `KW` 数组。每条形如：

```js
{ re: /(EUV|光刻|High-NA)/i, score: 6, tag: '光刻' },
```

`score` 越高该主题越容易入选；`tag` 用于主题分散和前端标签。

### 调整产出规模

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `EDITION_LIMIT` | 24 | 每期最多收录条数 |
| `WINDOW_HOURS` | 48 | 只收录最近 N 小时的条目 |
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
