import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { pathToFileURL } from 'node:url';
import { loadMail, paths } from './config.mjs';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function buildImageMessage(edition, image, config) {
  if (!Buffer.isBuffer(image) || !image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('邮件图片必须是有效 PNG');
  const site = new URL(config.site);
  if (!['https:', 'http:'].includes(site.protocol)) throw new Error('日报链接无效');
  const link = new URL(`edition/${edition.date}/`, `${site.href.replace(/\/$/, '')}/`).href;
  return {
    subject: `微电子简报 · ${edition.date} · ${edition.entries.length} 条动态`,
    text: `本期微电子简报已更新，共 ${edition.entries.length} 条。完整卡片长图见邮件图片或附件。\n在线阅读：${link}`,
    html: `<div style="max-width:100%;font-family:Arial,sans-serif"><p>${escape(edition.date)} · ${edition.entries.length} 条动态 · <a href="${escape(link)}">在线阅读与查看原始来源</a></p><img src="cid:ic-daily-digest" alt="${escape(edition.date)} 微电子简报卡片长图" style="display:block;width:100%;max-width:1520px;height:auto" /></div>`,
    attachments: [{ filename: `ic-daily-${edition.date}.png`, content: image, cid: 'ic-daily-digest', contentDisposition: 'inline', contentType: 'image/png' }],
  };
}
export async function deliverDigest(edition, image, config, { createTransport = nodemailer.createTransport } = {}) {
  if (!config.enabled) return { skipped: true, reason: 'disabled' };
  if (!config.host || !config.user || !config.pass || !config.from || !config.to.length) throw new Error('请在 GitHub Secrets 配置 SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_TO');
  if ([config.from, ...config.to].some(s => /[\r\n]/.test(s)) || config.to.some(s => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s))) throw new Error('邮件地址格式无效');
  const message = buildImageMessage(edition, image, config);
  const transport = createTransport({ host: config.host, port: config.port, secure: config.secure, requireTLS: !config.secure, auth: { user: config.user, pass: config.pass }, connectionTimeout: 20000, socketTimeout: 60000, disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
  let sent = 0;
  try {
    // Send individually so subscribers never see other recipients' addresses.
    for (const to of [...new Set(config.to)]) {
      const info = await transport.sendMail({ ...message, from: config.from, to });
      if (info.rejected?.length) throw new Error('邮件服务拒绝接收，请检查服务端设置');
      sent++;
    }
  } finally { transport.close?.(); }
  return { sent };
}
async function main() {
  const config = loadMail();
  const preview = process.argv.includes('--preview');
  if (!preview && !config.enabled) { console.log('邮件通知未启用，跳过。'); return; }
  const imagePath = process.argv.find(s => s.startsWith('--image='))?.slice(8) || path.join(paths.cache, 'mail', 'digest.png');
  const index = JSON.parse(fs.readFileSync(path.join(paths.content, 'index.json'), 'utf8'));
  const edition = JSON.parse(fs.readFileSync(path.join(paths.content, 'editions', `${index.editions[0].date}.json`), 'utf8'));
  const image = fs.readFileSync(imagePath);
  if (preview) {
    const message = buildImageMessage(edition, image, config);
    fs.mkdirSync(path.join(paths.cache, 'mail'), { recursive: true });
    fs.writeFileSync(path.join(paths.cache, 'mail', 'preview.html'), message.html.replace('cid:ic-daily-digest', 'digest.png'));
    console.log('已生成邮件正文预览，不包含收件人，也未发送。'); return;
  }
  const result = await deliverDigest(edition, image, config);
  console.log(`图片日报已发送，成功 ${result.sent} 封。`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('邮件发送失败，请检查 SMTP 配置和授权码。'); process.exitCode = 1; });
