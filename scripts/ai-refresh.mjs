import fs from 'node:fs';
import path from 'node:path';
import { paths, loadLLM, categoryMeta } from './config.mjs';
import { write } from './write.mjs';
import { rebuildIndex } from './edition.mjs';
if (!loadLLM().enabled) throw new Error('请先配置本地 .env 中的 LLM_API_KEY。');
const index = JSON.parse(fs.readFileSync(path.join(paths.content, 'index.json'), 'utf8'));
const date = process.argv.find(a => a.startsWith('--date='))?.slice(7) || index.editions[0]?.date;
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('需要 YYYY-MM-DD 日期。');
const file = path.join(paths.content, 'editions', `${date}.json`);
const edition = JSON.parse(fs.readFileSync(file, 'utf8'));
const rewritten = await write(edition.entries.map(e => ({ ...e, source: { name: e.source, category: e.category } })), { strict: true });
// Keep the original edition recoverable; .cache is ignored by git.
fs.mkdirSync(paths.cache, { recursive: true });
const backup = path.join(paths.cache, `${date}.before-ai.json`);
if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
edition.entries = edition.entries.map((e, i) => {
  const update = rewritten[i]; const meta = categoryMeta(update.category);
  return { ...e, ...update, categoryLabel: meta.label, categoryColor: meta.color };
});
edition.stats.categories = {};
for (const e of edition.entries) edition.stats.categories[e.category] = (edition.stats.categories[e.category] || 0) + 1;
edition.intro = `本期收录 ${edition.entries.length} 条微电子与集成电路相关动态，覆盖 ${Object.keys(edition.stats.categories).length} 个细分方向。`;
edition.generatedAt = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(edition, null, 2) + '\n');
rebuildIndex();
console.log(`已更新 ${date} 的 AI 摘要与要点，原始数据备份于 .cache/。`);
