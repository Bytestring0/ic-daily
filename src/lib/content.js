/**
 * 前端数据访问层
 * 构建时从 content/ 读取 JSON。所有页面统一走这里，避免路径散落。
 */
import fs from 'node:fs';
import path from 'node:path';

const CONTENT = path.resolve(process.cwd(), 'content');

function readJSON(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

/** 期次索引 */
export function getIndex() {
  return readJSON(path.join(CONTENT, 'index.json'), { total: 0, editions: [] });
}

/** 单期完整数据 */
export function getEdition(date) {
  return readJSON(path.join(CONTENT, 'editions', `${date}.json`), null);
}

/** 最新一期 */
export function getLatest() {
  const idx = getIndex();
  if (!idx.editions?.length) return null;
  return getEdition(idx.editions[0].date);
}

/** 所有期次数据（构建期一次性读入） */
export function getAllEditions() {
  const idx = getIndex();
  return (idx.editions || []).map((e) => getEdition(e.date)).filter(Boolean);
}

export function formatDateCN(dateStr) {
  const [y, m, d] = String(dateStr).split('-');
  const week = ['日', '一', '二', '三', '四', '五', '六'];
  const dt = new Date(`${dateStr}T12:00:00+08:00`);
  return {
    full: `${y} 年 ${Number(m)} 月 ${Number(d)} 日`,
    short: `${Number(m)}/${Number(d)}`,
    weekday: `星期${week[dt.getUTCDay()]}`,
    ymd: dateStr,
  };
}
