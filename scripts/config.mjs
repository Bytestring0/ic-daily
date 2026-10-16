/**
 * 统一配置加载
 * 所有可调参数集中在这里，其他模块不读环境变量。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  return list.filter((s) => s && s.enabled !== false && s.url);
}

/** LLM 配置：OpenAI 兼容端点 */
export function loadLLM() {
  return {
    baseUrl: (process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'deepseek-chat',
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

/** 时间窗口：只收录最近 N 小时内的条目 */
export const WINDOW_HOURS = Number(process.env.WINDOW_HOURS || 48);

/** 分类中文名与配色（供前端复用） */
export const CATEGORY_META = {
  foundry: { label: '晶圆代工', color: '#e8703a' },
  equipment: { label: '设备', color: '#3a86e8' },
  eda: { label: 'EDA', color: '#8b5cf6' },
  memory: { label: '存储', color: '#d946a0' },
  design: { label: '芯片设计', color: '#0ea5a5' },
  material: { label: '材料与封测', color: '#b8860b' },
  policy: { label: '政策与地缘', color: '#dc2626' },
  research: { label: '研究与论文', color: '#4f7c3a' },
  market: { label: '市场与产业', color: '#5a6472' },
};

export function categoryMeta(key) {
  return CATEGORY_META[key] || CATEGORY_META.market;
}
