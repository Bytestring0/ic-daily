#!/usr/bin/env node
/**
 * 微电子 / 集成电路 每日简报 · 流水线入口
 *
 *   node scripts/run.mjs              抓取今天并生成期次
 *   node scripts/run.mjs --date=2025-01-01
 *   node scripts/run.mjs --index-only 仅重建索引
 */
import { buildEdition, rebuildIndex } from './edition.mjs';
import { log } from './util.mjs';

const args = process.argv.slice(2);
const getArg = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};

async function main() {
  const started = Date.now();
  console.log('');
  console.log('  ┌────────────────────────────────────────────┐');
  console.log('  │   微电子 · 集成电路 每日简报  生成流水线   │');
  console.log('  └────────────────────────────────────────────┘');

  if (args.includes('--index-only')) {
    const idx = rebuildIndex();
    log.ok(`索引已重建，共 ${idx?.length ?? 0} 期`);
    return;
  }

  const date = getArg('date');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    log.error(`日期格式错误：${date}，应为 YYYY-MM-DD`);
    process.exit(1);
  }

  await buildEdition({ date });

  console.log('');
  log.ok(`全部完成，总耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  ${log.info ? '' : ''}下一步：npm run build 生成网站，或 npm run dev 本地预览`);
  console.log('');
}

main().catch((err) => {
  log.error(`流水线失败：${err?.stack || err}`);
  process.exit(1);
});
