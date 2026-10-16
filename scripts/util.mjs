/** 日志与通用工具 */

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (c, s) => (useColor ? `${c}${s}${C.reset}` : s);

export const log = {
  step: (m) => console.log(`\n${paint(C.bold + C.cyan, '▶')} ${paint(C.bold, m)}`),
  info: (m) => console.log(`  ${paint(C.dim, m)}`),
  ok: (m) => console.log(`  ${paint(C.green, '✓')} ${m}`),
  skip: (m) => console.log(`  ${paint(C.yellow, '[SKIP]')} ${paint(C.dim, m)}`),
  warn: (m) => console.log(`  ${paint(C.yellow, '!')} ${m}`),
  error: (m) => console.error(`  ${paint(C.red, '✗')} ${m}`),
};

/** 简单并发池：保持结果顺序 */
export async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      try {
        results[i] = await tasks[i]();
      } catch (err) {
        results[i] = { __error: err };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export function sha1(str) {
  // 避免引入 crypto 依赖复杂度，用轻量稳定哈希（仅用于去重标识）
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(12, '0');
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 北京时区日期 YYYY-MM-DD */
export function todayInCST(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date); // en-CA 输出 YYYY-MM-DD
}

export function hoursAgo(iso, now = Date.now()) {
  if (!iso) return Infinity;
  return (now - new Date(iso).getTime()) / 3_600_000;
}
