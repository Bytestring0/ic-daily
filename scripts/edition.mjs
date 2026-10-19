/**
 * 阶段 ⑤：生成期次数据
 * 输出 content/editions/YYYY-MM-DD.json —— 网站的唯一数据源。
 * 结构即契约：前端只认这个 schema。
 */
import fs from 'node:fs';
import path from 'node:path';
import { paths, categoryMeta, qualityConfig, loadLLM, WINDOW_HOURS, ALLOW_UNDATED } from './config.mjs';
import { collect } from './collect.mjs';
import { curate } from './curate.mjs';
import { write } from './write.mjs';
import { discoverySources } from './discovery.mjs';
import { enrichArticles } from './articles.mjs';
import { reviewNews } from './editor.mjs';
import { assessItem } from './quality.mjs';
import { todayInCST, log, sha1 } from './util.mjs';

/** 根据 importance 与 score 生成一句话导语（规则，不耗 token） */
export function buildIntro(items, date) {
  const top = items.filter((i) => i.importance >= 4);
  if (top.length === 0) {
    return `本期收录 ${items.length} 条微电子与集成电路相关动态，覆盖 ${new Set(
      items.map((i) => i.category),
    ).size} 个细分方向。`;
  }
  const cats = [...new Set(top.slice(0, 4).map((i) => categoryMeta(i.category).label))];
  return `本期共 ${items.length} 条动态，其中 ${top.length} 条值得重点关注，集中在${cats.join('、')}方向。`;
}

export function recentHistory(day) {
  const dir = path.join(paths.content, 'editions');
  if (!fs.existsSync(dir)) return [];
  const cutoff = new Date(`${day}T00:00:00+08:00`).getTime() - qualityConfig.historyDays * 86400_000;
  return fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) < day && Date.parse(`${f.slice(0, 10)}T00:00:00+08:00`) >= cutoff).sort().reverse().flatMap(f => {
    const e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return e.entries.map(entry => ({ ...entry, date: e.date }));
  });
}

export async function buildEdition({ date } = {}) {
  const startedAt = Date.now();
  const day = date || todayInCST();
  const now = day === todayInCST() ? Date.now() : Date.parse(`${day}T23:59:59+08:00`);
  const history = recentHistory(day);
  const audit = { date: day, startedAt: new Date().toISOString(), discovery: {}, rejected: [], selected: [] };
  const cacheDir = path.join(paths.cache, 'news');
  fs.mkdirSync(cacheDir, { recursive: true });
  const saveAudit = () => fs.writeFileSync(path.join(cacheDir, `${day}.quality.json`), JSON.stringify(audit, null, 2));

  try {

  log.step(`构建 ${day} 期日报`);

  // ① 采集
  const extraSources = await discoverySources({ date: day, history, audit: audit.discovery });
  saveAudit();
  const { items: raw, report } = await collect({ extraSources });
  audit.sources = report.sources;
  fs.writeFileSync(path.join(cacheDir, `${day}.raw.json`), JSON.stringify(raw, null, 2));

  // ②③ 过滤打分精选
  const candidates = curate(raw, { now, history, audit: audit.rejected });
  audit.discovery.results = raw.filter(item => item.discoveredVia).length;
  audit.discovery.candidates = candidates.filter(item => item.discoveredVia).length;
  saveAudit();
  const readable = await enrichArticles(candidates, { audit: audit.rejected });
  fs.writeFileSync(path.join(cacheDir, `${day}.read.json`), JSON.stringify(readable, null, 2));
  const verified = readable.filter(item => {
    const d = assessItem(item, { now, windowHours: WINDOW_HOURS, allowUndated: ALLOW_UNDATED });
    if (!d.keep || !item.published) { audit.rejected.push({ title: item.title, url: item.url, stage: 'original_date', reason: d.reason }); return false; }
    return true;
  });
  const selected = await reviewNews(verified, { history, audit: audit.rejected });
  audit.selected = selected.map(item => ({ title: item.title, url: item.url, eventKey: item.eventKey, editorial: item.editorial }));

  if (selected.length === 0) {
    throw new Error('没有通过原文与新闻质量审核的条目；不凑数、不覆盖已有期次。详见 .cache/news/ 中的质量报告。');
  }

  // ④ AI 撰写
  const written = await write(selected, { strict: loadLLM().enabled });

  // ⑤ 组装
  const entries = selected.map((it, i) => {
    const w = written[i] || {};
    const meta = categoryMeta(w.category || it.source?.category);
    return {
      id: sha1(it.url),
      title: w.title || it.title,
      summary: w.summary || '',
      points: w.points || [],
      cards: w.cards || [],
      category: w.category || it.source?.category || 'market',
      categoryLabel: meta.label,
      categoryColor: meta.color,
      importance: w.importance ?? 3,
      tags: it.tags || [],
      source: it.source?.name || '未知来源',
      sourceLang: it.source?.lang || 'en',
      url: it.url,
      published: it.published,
      score: Number((it.score || 0).toFixed(2)),
      eventKey: it.eventKey || null,
      originalTitle: it.originalTitle,
      provenance: { url: it.url, retrievedAt: it.retrievedAt, articlePublished: it.articlePublished, evidenceType: it.evidenceType },
      editorial: it.editorial,
      relatedSources: it.relatedSources || [],
    };
  });

  // 按重要度为主、原始分为辅排序
  entries.sort((a, b) => b.importance - a.importance || b.score - a.score);

  // 分类统计
  const byCategory = {};
  for (const e of entries) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
  }

  const edition = {
    date: day,
    generatedAt: new Date().toISOString(),
    intro: buildIntro(entries, day),
    stats: {
      count: entries.length,
      sources: new Set(entries.map(e => e.source)).size,
      sourcesFetched: report.ok,
      sourcesTotal: report.total,
      categories: byCategory,
      failedSources: report.failed,
      durationMs: Date.now() - startedAt,
      quality: { target: qualityConfig.target, minimum: qualityConfig.minimum, coverageMet: entries.length >= qualityConfig.minimum, windowHours: WINDOW_HOURS, candidates: candidates.length, readable: readable.length, accepted: entries.length, rejected: audit.rejected.length, editor: loadLLM().enabled ? loadLLM().model : 'rules', discoveryQueries: extraSources.length },
    },
    entries,
  };

  // 写入
  const dir = path.join(paths.content, 'editions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${day}.json`);
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(cacheDir, `${day}.before-${Date.now()}.json`));
  }
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(edition, null, 2), 'utf8');
  fs.renameSync(temp, file);

  // 同时更新索引（供前端列出所有期次）
  rebuildIndex();

  log.ok(`已写入 ${path.relative(paths.root, file)}`);
  log.info(`耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  return edition;
  } catch (error) {
    audit.error = error.message;
    throw error;
  } finally {
    audit.completedAt = new Date().toISOString();
    saveAudit();
  }
}

/** 重建期次索引，前端用它生成列表页与导航 */
export function rebuildIndex() {
  const dir = path.join(paths.content, 'editions');
  if (!fs.existsSync(dir)) return;

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();

  const index = files.map((f) => {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    // 顶部三条标题，用于列表页预览
    const top = data.entries.slice(0, 3).map((e) => e.title);
    return {
      date: data.date,
      count: data.stats?.count ?? data.entries.length,
      intro: data.intro,
      top,
      categories: data.stats?.categories ?? {},
    };
  });

  fs.writeFileSync(
    path.join(paths.content, 'index.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), total: index.length, editions: index }, null, 2),
    'utf8',
  );
  return index;
}
