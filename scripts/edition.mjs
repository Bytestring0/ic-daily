/**
 * 阶段 ⑤：生成期次数据
 * 输出 content/editions/YYYY-MM-DD.json —— 网站的唯一数据源。
 * 结构即契约：前端只认这个 schema。
 */
import fs from 'node:fs';
import path from 'node:path';
import { paths, categoryMeta } from './config.mjs';
import { collect } from './collect.mjs';
import { curate } from './curate.mjs';
import { write } from './write.mjs';
import { todayInCST, log, sha1 } from './util.mjs';

/** 根据 importance 与 score 生成一句话导语（规则，不耗 token） */
function buildIntro(items, date) {
  const top = items.filter((i) => i.importance >= 4);
  if (top.length === 0) {
    return `本期收录 ${items.length} 条微电子与集成电路相关动态，覆盖 ${new Set(
      items.map((i) => i.category),
    ).size} 个细分方向。`;
  }
  const cats = [...new Set(top.slice(0, 4).map((i) => categoryMeta(i.category).label))];
  return `本期共 ${items.length} 条动态，其中 ${top.length} 条值得重点关注，集中在${cats.join('、')}方向。`;
}

export async function buildEdition({ date } = {}) {
  const startedAt = Date.now();
  const day = date || todayInCST();

  log.step(`构建 ${day} 期日报`);

  // ① 采集
  const { items: raw, report } = await collect();

  // ②③ 过滤打分精选
  const selected = curate(raw);

  if (selected.length === 0) {
    log.error('没有可用条目 —— 所有源可能都抓取失败，或时间窗内确实无内容');
    log.info('提示：可调大 WINDOW_HOURS 环境变量，或检查网络');
  }

  // ④ AI 撰写
  const written = await write(selected);

  // ⑤ 组装
  const entries = selected.map((it, i) => {
    const w = written[i] || {};
    const meta = categoryMeta(w.category || it.source?.category);
    return {
      id: sha1(it.url),
      title: w.title || it.title,
      summary: w.summary || '',
      points: w.points || [],
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
      sources: report.ok,
      sourcesTotal: report.total,
      categories: byCategory,
      failedSources: report.failed,
      durationMs: Date.now() - startedAt,
    },
    entries,
  };

  // 写入
  const dir = path.join(paths.content, 'editions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${day}.json`);
  fs.writeFileSync(file, JSON.stringify(edition, null, 2), 'utf8');

  // 同时更新索引（供前端列出所有期次）
  rebuildIndex();

  log.ok(`已写入 ${path.relative(paths.root, file)}`);
  log.info(`耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  return edition;
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
