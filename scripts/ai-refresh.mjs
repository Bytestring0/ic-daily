/** Re-read original URLs, re-select events, then rewrite. Never rephrase AI output as evidence. */
import fs from 'node:fs';
import path from 'node:path';
import { paths, loadLLM, categoryMeta, WINDOW_HOURS } from './config.mjs';
import { write } from './write.mjs';
import { rebuildIndex, recentHistory, buildIntro } from './edition.mjs';
import { curate } from './curate.mjs';
import { enrichArticles } from './articles.mjs';
import { reviewNews } from './editor.mjs';
import { assessItem } from './quality.mjs';
if (!loadLLM().enabled) throw new Error('请先配置本地 .env 中的 LLM_API_KEY。');
const index = JSON.parse(fs.readFileSync(path.join(paths.content, 'index.json'), 'utf8'));
const date = process.argv.find(a => a.startsWith('--date='))?.slice(7) || index.editions[0]?.date;
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('需要 YYYY-MM-DD 日期。');
const file = path.join(paths.content, 'editions', `${date}.json`);
const edition = JSON.parse(fs.readFileSync(file, 'utf8'));
const now = Date.parse(`${date}T23:59:59+08:00`);
const history = recentHistory(date);
const audit = { date, mode: 'refresh_from_original_urls', rejected: [] };
const cache = path.join(paths.cache, 'news'); fs.mkdirSync(cache, { recursive: true });
try {
  const candidates = curate(edition.entries.map(e => ({ ...e, title: e.originalTitle || e.title, source: { name: e.source, category: e.category, lang: e.sourceLang }, weight: 5 })), { now, history, audit: audit.rejected });
  const readable = await enrichArticles(candidates, { audit: audit.rejected });
  const eligible = readable.filter(item => {
    const decision = assessItem(item, { now, windowHours: WINDOW_HOURS });
    if (!decision.keep) audit.rejected.push({ title: item.title, url: item.url, stage: 'original_date', reason: decision.reason });
    return decision.keep;
  });
  const selected = await reviewNews(eligible, { history, audit: audit.rejected });
  if (!selected.length) throw new Error('没有通过审核的新闻，不覆盖原期次。');
  const rewritten = await write(selected, { strict: true });
  const original = new Map(edition.entries.map(e => [e.id, e]));
  edition.entries = selected.map((item, i) => ({
    ...original.get(item.id), ...rewritten[i], source: item.source.name, url: item.url,
    published: item.published, originalTitle: item.originalTitle, eventKey: item.eventKey,
    categoryLabel: categoryMeta(rewritten[i].category).label, categoryColor: categoryMeta(rewritten[i].category).color,
    provenance: { url: item.url, retrievedAt: item.retrievedAt, articlePublished: item.articlePublished, evidenceType: item.evidenceType }, editorial: item.editorial,
  }));
  edition.stats.categories = {};
  for (const e of edition.entries) edition.stats.categories[e.category] = (edition.stats.categories[e.category] || 0) + 1;
  edition.stats.count = edition.entries.length;
  edition.stats.sources = new Set(edition.entries.map(e => e.source)).size;
  edition.stats.quality = { candidates: candidates.length, readable: readable.length, accepted: edition.entries.length, rejected: audit.rejected.length, editor: loadLLM().model };
  edition.intro = buildIntro(edition.entries, date);
  edition.generatedAt = new Date().toISOString();
  fs.copyFileSync(file, path.join(cache, `${date}.before-refresh-${Date.now()}.json`));
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(edition, null, 2) + '\n'); fs.renameSync(`${file}.tmp`, file);
  rebuildIndex();
  audit.accepted = edition.entries.map(e => ({ title: e.title, url: e.url, editorial: e.editorial }));
  console.log(`已从原文重新审核 ${date}：保留 ${edition.entries.length} 条。`);
} catch (error) { audit.error = error.message; throw error; }
finally { fs.writeFileSync(path.join(cache, `${date}.refresh-quality.json`), JSON.stringify(audit, null, 2)); }
