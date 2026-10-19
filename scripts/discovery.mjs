import { loadLLM, loadSearch, qualityConfig } from './config.mjs';
import { callLLM, extractJSON } from './write.mjs';
import { log } from './util.mjs';

export const SEED_QUERIES = [
  'semiconductor foundry lithography announces production',
  'HBM DRAM NAND packaging announces investment',
  '半导体 晶圆 光刻 量产 公告',
  '芯片 EDA 收购 融资 发布',
];
export async function discoverySources({ date, history = [], audit = {} }) {
  if (!qualityConfig.discovery) return [];
  let queries = SEED_QUERIES;
  const cfg = loadLLM();
  if (cfg.enabled) {
    try {
      const raw = await callLLM({ ...cfg, timeoutMs: Math.min(cfg.timeoutMs, 60000) }, [
        { role: 'system', content: '你是半导体新闻检索策划，只负责生成检索词，不生成新闻、不编造事件。输出严格 JSON。' },
        { role: 'user', content: `今天是北京时间 ${date}。为最近一天的芯片产业硬新闻生成 4 条检索式，2条中文、2条英文。覆盖制造/设备/材料、存储/先进封装、芯片设计/EDA、政策/财报/并购。用具体产业对象与事件动作，避免泛 AI 应用、数码产品、观点、周报。可使用 site: 限定厂商官网、主管机构、行业媒体，但不要只限旧来源。不要添加你想象的新闻事实。已报道标题仅供避免旧闻：${JSON.stringify(history.slice(0, 15).map(e => e.title))}。格式：{"queries":["检索词"]}` },
      ], 0, false);
      const parsed = extractJSON(raw);
      const valid = parsed?.queries?.filter(q => typeof q === 'string' && q.trim().length >= 8 && q.length <= 180).map(sanitizeQuery).filter(Boolean).slice(0, 4);
      if (valid?.length) { queries = valid; audit.plannedBy = cfg.model; }
    } catch { log.warn('AI 检索规划不可用，使用固定主题检索；不生成虚构线索'); }
  }
  audit.plannedBy ||= 'seed_queries'; audit.queries = queries;
  const brave = qualityConfig.discoveryProvider === 'brave';
  audit.provider = brave ? 'brave_news' : 'bing_public_rss';
  if (brave && !loadSearch().apiKey) { audit.error = 'missing_brave_search_key'; log.warn('未配置新闻搜索 Key；继续采集固定来源，不伪造搜索结果'); return []; }
  return queries.map((query, i) => ({
    name: `主题检索 ${i + 1}`,
    url: brave ? `https://api.search.brave.com/res/v1/news/search?${new URLSearchParams({ q: query, freshness: 'pd', count: '10' })}` : `https://www.bing.com/search?${new URLSearchParams({ q: query, format: 'rss', ensearch: '1', filters: 'ex1:"ez1"' })}`,
    format: brave ? 'brave' : 'rss',
    lang: /[\u4e00-\u9fff]/.test(query) ? 'zh' : 'en', category: 'market', kind: 'discovery', weight: 5,
  }));
}

export function sanitizeQuery(query) {
  // Publication time is checked on the article, not inferred from search snippets.
  return query.replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/gi, '').replace(/\b(?:after|before):\S+/gi, '').replace(/20\d{2}(?:[年/-]\d{1,2})?(?:[月/-]\d{1,2})?日?/g, '').replace(/\s+/g, ' ').trim();
}
