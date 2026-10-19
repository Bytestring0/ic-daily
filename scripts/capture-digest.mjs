/** Render the built simple-mode cards into one image. No mail settings enter this page. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { ROOT } from './config.mjs';

const root = path.join(ROOT, 'dist');
const args = process.argv.slice(2);
const arg = key => args.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const output = path.resolve(ROOT, arg('out') || '.cache/mail/digest.png');
const base = (arg('base') || '').replace(/\/$/, '');
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('请先执行 npm run build。');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let pathname; try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  if (base && pathname !== base && !pathname.startsWith(`${base}/`)) { res.writeHead(404); return res.end(); }
  pathname = pathname.slice(base.length);
  let file = path.resolve(root, `.${pathname || '/'}`);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(arg('browser') ? { channel: arg('browser') } : {}) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}${base}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    document.documentElement.dataset.mode = 'simple'; document.documentElement.dataset.theme = 'light';
    const main = document.querySelector('.digest-main');
    const hero = document.querySelector('.digest-hero');
    const grid = document.createElement('div'); grid.className = 'mail-grid';
    [...document.querySelectorAll('.entry')].sort((a,b) => Number(a.id.slice(2)) - Number(b.id.slice(2))).forEach(entry => grid.append(entry));
    const foot = document.createElement('p'); foot.className = 'mail-note';
    foot.textContent = '微电子简报 · 内容依据标注来源整理，报道与计划请核对原文。';
    if (!main || !hero || !grid.children.length) throw Error('没有可截图的日报内容');
    main.replaceChildren(hero, grid, foot);
  });
  await page.addStyleTag({ content: `
    html,body { width:1600px; margin:0; overflow:visible; } .left-rail,.topbar,.contents-rail,.site-foot,.skip-link { display:none!important; }
    .page-shell { margin:0!important; } .digest-layout { display:block!important; width:1600px; max-width:none!important; padding:0 40px!important; }
    .digest-main { padding:24px; } .digest-hero { padding:15px 5px 25px!important; margin:0 0 24px!important; } .digest-hero h1 { font-size:34px; }
    .mail-grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; align-items:start; }
    .mail-grid .entry { margin:0!important; padding:24px!important; background:var(--card); border:1px solid var(--line)!important; border-radius:14px; box-shadow:none; }
    .mail-grid .entry-title { font-size:23px!important; line-height:1.55!important; margin:12px 0 16px!important; }
    .mail-grid .entry-facts { grid-template-columns:1fr 1fr!important; gap:10px!important; }
    .mail-grid .fact { padding:13px!important; border-radius:8px!important; box-shadow:none!important; }
    .mail-grid .fact-summary { padding:0 0 8px!important; } .mail-grid .fact-summary p { font-size:15px!important; line-height:1.8!important; }
    .mail-grid .fact-point { min-height:0!important; } .mail-grid .fact-point h4 { display:block!important; font-size:14px!important; margin:0 0 6px!important; }
    .mail-grid .fact-point p { font-size:14px!important; line-height:1.8!important; } .mail-grid .entry-footer { margin-top:15px!important; flex-wrap:wrap; }
    .mail-grid .entry-source { font-size:11px; } .mail-grid .entry-tags { display:none; } .mail-note { font-size:13px; color:var(--ink-3); margin:25px 0; }
  ` });
  await page.evaluate(() => document.fonts.ready);
  if (errors.length) throw new Error(`图片页面运行错误：${errors[0]}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await page.locator('.digest-main').screenshot({ path: output, animations: 'disabled' });
  const dimensions = await page.locator('.digest-main').boundingBox();
  console.log(`日报长图已生成：${path.relative(ROOT, output)} (${Math.round(dimensions.width)}×${Math.round(dimensions.height)})`);
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
