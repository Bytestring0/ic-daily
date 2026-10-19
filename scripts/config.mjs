/**
 * 统一配置加载
 * 所有可调参数集中在这里，其他模块不读环境变量。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Node CLI and the local API share the same private configuration.
if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));

export const paths = {
  root: ROOT,
  sources: path.join(ROOT, 'config', 'sources.yaml'),
  content: path.join(ROOT, 'content'),
  cache: path.join(ROOT, '.cache'),
};

/** 读取信息源列表 */
export function loadSources() {
  const raw = fs.readFileSync(paths.sources, 'utf8');
  const doc = YAML.parse(raw);
  const list = Array.isArray(doc?.sources) ? doc.sources : [];
  return list.filter((s) => s && s.enabled !== false && s.url).map(s => ({ ...s, url: s.urlEnv && process.env[s.urlEnv] ? process.env[s.urlEnv] : s.url }));
}

/** LLM 配置：OpenAI 兼容端点 */
export function loadLLM() {
  return {
    baseUrl: (process.env.LLM_BASE_URL || 'https://maas-api.unisound.com/v1').replace(/\/+$/, ''),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'u2-flash',
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 180_000),
    concurrency: Number(process.env.LLM_CONCURRENCY || 3),
    // 未配置 key 时自动退化为「纯规则模式」，流水线依然能跑完
    get enabled() {
      return Boolean(process.env.LLM_API_KEY);
    },
  };
}

/** 抓取参数 */
export const fetchConfig = {
  timeoutMs: Number(process.env.FETCH_TIMEOUT_MS || 20_000),
  concurrency: Number(process.env.FETCH_CONCURRENCY || 6),
  retries: Number(process.env.FETCH_RETRIES || 2),
  userAgent:
    'Mozilla/5.0 (compatible; ICDailyBot/1.0; +https://github.com/) AppleWebKit/537.36 Chrome/120 Safari/537.36',
};

/** 每期日报收录条数上限 */
export const EDITION_LIMIT = Number(process.env.EDITION_LIMIT || 24);

export const qualityConfig = {
  target: Number(process.env.EDITION_TARGET || 18),
  minimum: Number(process.env.EDITION_MINIMUM || 15),
  candidateLimit: Number(process.env.CANDIDATE_LIMIT || 90),
  sourceLimit: Number(process.env.PER_SOURCE_LIMIT || 8),
  historyDays: Number(process.env.HISTORY_DAYS || 7),
  articleTimeoutMs: Number(process.env.ARTICLE_TIMEOUT_MS || 15000),
  articleConcurrency: Number(process.env.ARTICLE_CONCURRENCY || 4),
  minArticleLength: 300,
  discovery: process.env.NEWS_DISCOVERY !== 'false',
  discoveryProvider: process.env.NEWS_SEARCH_PROVIDER || (process.env.BRAVE_SEARCH_API_KEY ? 'brave' : 'bing'),
};

export function loadSearch() { return { apiKey: process.env.BRAVE_SEARCH_API_KEY || '' }; }

/** 时间窗口：严格只收录最近 N 小时内的条目（默认 24h） */
export const WINDOW_HOURS = Number(process.env.WINDOW_HOURS || 48);

export function loadMail() {
  return {
    enabled: process.env.MAIL_ENABLED === 'true',
    host: process.env.SMTP_HOST || 'smtp.qq.com', port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== 'false', user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || process.env.SMTP_USER || '',
    to: (process.env.MAIL_TO || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean),
    site: process.env.MAIL_SITE_URL || process.env.SITE_URL || 'https://bytestring0.github.io/ic-daily/',
  };
}

/**
 * 无发布日期的条目是否收录。
 * 默认 false —— 时效性是这份简报的核心，宁缺毋滥。
 */
export const ALLOW_UNDATED = process.env.ALLOW_UNDATED === 'true';

/** 超过此小时数视为"过时"，直接丢弃（即使窗口放宽） */
export const STALE_HOURS = Number(process.env.STALE_HOURS || WINDOW_HOURS);

/** 分类中文名与配色（供前端复用） */
export const CATEGORY_META = {
  foundry:   { label: '晶圆代工',   color: '#1a5fa8' },  // 光刻蓝
  equipment: { label: '设备',       color: '#0e7c86' },  // 青
  eda:       { label: 'EDA',        color: '#6b4fbb' },  // 紫
  memory:    { label: '存储',       color: '#b02f6e' },  // 洋红
  design:    { label: '芯片设计',   color: '#1f7a4d' },  // 绿
  material:  { label: '材料与封测', color: '#b08d57' },  // 铜互连
  policy:    { label: '政策与地缘', color: '#c0392b' },  // 红
  research:  { label: '研究与论文', color: '#4a7c3f' },  // 橄榄
  market:    { label: '市场与产业', color: '#5c6b7a' },  // 灰蓝
};

export function categoryMeta(key) {
  return CATEGORY_META[key] || CATEGORY_META.market;
}
