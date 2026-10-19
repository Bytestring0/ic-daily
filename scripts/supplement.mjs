/** Expand the latest edition from the current run's cached candidates without rewriting approved stories. */
import fs from 'node:fs';
import path from 'node:path';
import { paths, WINDOW_HOURS, qualityConfig, categoryMeta, loadLLM, EDITION_LIMIT } from './config.mjs';
import { recentHistory, rebuildIndex, buildIntro } from './edition.mjs';
import { curate } from './curate.mjs';
import { canonicalUrl } from './quality.mjs';
import { enrichArticles } from './articles.mjs';
import { reviewNews } from './editor.mjs';
import { write } from './write.mjs';
import { sha1 } from './util.mjs';

const index = JSON.parse(fs.readFileSync(path.join(paths.content, 'index.json'), 'utf8'));
const date = index.editions[0].date;
const file = path.join(paths.content, 'editions', `${date}.json`);
const edition = JSON.parse(fs.readFileSync(file, 'utf8'));
const cache = path.join(paths.cache, 'news');
const raw = JSON.parse(fs.readFileSync(path.join(cache, `${date}.raw.json`), 'utf8'));
const previousRead = JSON.parse(fs.readFileSync(path.join(cache, `${date}.read.json`), 'utf8'));
const history = [...recentHistory(date), ...edition.entries.map(e => ({ ...e, date }))];
const audit = { date, baseCount: edition.entries.length, rejected: [] };
try {
  const existingSources = {};
  edition.entries = edition.entries.filter(e => {
    const count = existingSources[e.source] || 0;
    if (count >= qualityConfig.sourceLimit) { audit.rejected.push({ title: e.title, url: e.url, stage: 'diversity', reason: 'source_limit' }); return false; }
    existingSources[e.source] = count + 1; return true;
  });
  const candidates = curate(raw, { now: Date.now(), history, audit: audit.rejected });
  const cached = new Map(previousRead.map(e => [canonicalUrl(e.url), e]));
  const { readArticle } = await import('./articles.mjs');
  const readable = await enrichArticles(candidates, { audit: audit.rejected, reader: async item => {
    const prior = cached.get(canonicalUrl(item.url));
    if (prior) return { ...item, ...prior };
    return readArticle(item);
  } });
  const eligible = readable.filter(e => e.published && Date.now() - Date.parse(e.published) <= WINDOW_HOURS * 3600_000 && Date.parse(e.published) <= Date.now() + 3600_000);
  const readCache = new Map([...previousRead, ...readable].map(e => [canonicalUrl(e.url), e]));
  fs.writeFileSync(path.join(cache, `${date}.read.json`), JSON.stringify([...readCache.values()], null, 2));
  const selected = (await reviewNews(eligible, { history, audit: audit.rejected, existingSources })).slice(0, EDITION_LIMIT - edition.entries.length);
  const written = await write(selected, { strict: loadLLM().enabled });
  selected.forEach((item, i) => {
    const w = written[i], meta = categoryMeta(w.category);
    edition.entries.push({ id: sha1(item.url), ...w, categoryLabel: meta.label, categoryColor: meta.color, tags: [meta.label], source: item.source.name, sourceLang: item.source.lang, url: item.url, published: item.published, score: Number((item.score || 0).toFixed(2)), eventKey: item.eventKey, originalTitle: item.originalTitle, provenance: { url: item.url, retrievedAt: item.retrievedAt, articlePublished: item.articlePublished, evidenceType: item.evidenceType }, editorial: item.editorial, relatedSources: item.relatedSources || [] });
  });
  const categories = {};
  for (const e of edition.entries) categories[e.category] = (categories[e.category] || 0) + 1;
  edition.stats = { ...edition.stats, count: edition.entries.length, sources: new Set(edition.entries.map(e => e.source)).size, categories, quality: { ...edition.stats.quality, target: qualityConfig.target, minimum: qualityConfig.minimum, accepted: edition.entries.length, coverageMet: edition.entries.length >= qualityConfig.minimum, supplemented: selected.length } };
  edition.intro = buildIntro(edition.entries, date); edition.generatedAt = new Date().toISOString();
  fs.copyFileSync(file, path.join(cache, `${date}.before-supplement-${Date.now()}.json`));
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(edition, null, 2)); fs.renameSync(`${file}.tmp`, file);
  rebuildIndex();
  audit.accepted = selected.map(e => ({ title: e.title, url: e.url, editorial: e.editorial })); audit.count = edition.entries.length;
  const reportPath = path.join(cache, `${date}.quality.json`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const acceptedUrls = new Set(edition.entries.map(e => canonicalUrl(e.url)));
  const rejected = new Map([...report.rejected, ...audit.rejected].filter(e => !acceptedUrls.has(canonicalUrl(e.url))).map(e => [canonicalUrl(e.url), e]));
  report.rejected = [...rejected.values()]; report.selected = edition.entries.map(e => ({ title: e.title, url: e.url, eventKey: e.eventKey, editorial: e.editorial }));
  report.completedAt = new Date().toISOString(); report.coverageMet = edition.stats.quality.coverageMet;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`补充 ${selected.length} 条，${date} 共 ${edition.entries.length} 条。`);
} catch (error) { audit.error = error.message; throw error; }
finally { fs.writeFileSync(path.join(cache, `${date}.supplement-quality.json`), JSON.stringify(audit, null, 2)); }
