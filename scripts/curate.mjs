import { WINDOW_HOURS, ALLOW_UNDATED, qualityConfig, categoryMeta } from './config.mjs';
import { assessItem, dedupeEvents } from './quality.mjs';
import { log } from './util.mjs';

export function scoreItem(item) {
  const assessment = assessItem(item, { windowHours: WINDOW_HOURS, allowUndated: ALLOW_UNDATED });
  return { score: assessment.score || 0, tags: assessment.tags || [], hits: assessment.tags || [] };
}
export function curate(items, { now = Date.now(), history = [], audit = [] } = {}) {
  log.step('统一新闻性与半导体相关性门槛（所有来源适用）');
  const candidates = [];
  for (const item of items) {
    const decision = assessItem(item, { now, windowHours: WINDOW_HOURS, allowUndated: ALLOW_UNDATED });
    if (!decision.keep) { audit.push({ title: item.title, url: item.url, stage: 'rules', reason: decision.reason }); continue; }
    candidates.push({ ...item, score: decision.score, tags: [categoryMeta(decision.category).label], suggestedCategory: decision.category });
  }
  candidates.sort((a, b) => b.score - a.score || Date.parse(b.published) - Date.parse(a.published));
  const unique = dedupeEvents(candidates, history);
  audit.push(...unique.rejected.map(r => ({ ...r, stage: 'dedupe' })));
  // A candidate pool, not a quota to fill. Final selection happens after reading.
  const selected = [], perSource = new Map();
  for (const item of unique.items) {
    const name = item.source?.name;
    if (selected.length >= qualityConfig.candidateLimit || (perSource.get(name) || 0) >= qualityConfig.sourceLimit * 2) {
      audit.push({ title: item.title, url: item.url, stage: 'rules', reason: 'candidate_or_source_limit' }); continue;
    }
    perSource.set(name, (perSource.get(name) || 0) + 1); selected.push(item);
  }
  log.info(`${items.length} 条输入 → ${selected.length} 条原文核验候选；拒绝 ${audit.length} 条`);
  return selected;
}
