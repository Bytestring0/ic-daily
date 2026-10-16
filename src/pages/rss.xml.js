/**
 * 生成 RSS 订阅源（静态构建时输出 /rss.xml）
 * 每天一期作为一个 item，正文为当期全部条目的 HTML。
 */
import { getIndex, getEdition, formatDateCN } from '../lib/content.js';

export const prerender = true;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function GET(context) {
  const site = (context.site?.href || 'https://example.github.io').replace(/\/$/, '');
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const idx = getIndex();

  const items = (idx.editions || [])
    .slice(0, 30)
    .map((meta) => {
      const ed = getEdition(meta.date);
      if (!ed) return null;
      const url = `${site}${base}/edition/${ed.date}/`;
      const body = ed.entries
        .map(
          (e) =>
            `<h3><a href="${esc(e.url)}">${esc(e.title)}</a></h3>` +
            `<p><small>${esc(e.categoryLabel)} · ${esc(e.source)}</small></p>` +
            `<p>${esc(e.summary)}</p>`,
        )
        .join('\n');
      const pub = new Date(`${ed.date}T09:00:00+08:00`).toUTCString();
      return `    <item>
      <title>${esc(formatDateCN(ed.date).full + ' 微电子简报')}</title>
      <link>${esc(url)}</link>
      <guid isPermaLink="true">${esc(url)}</guid>
      <pubDate>${pub}</pubDate>
      <description><![CDATA[<p>${esc(ed.intro)}</p>${body}]]></description>
    </item>`;
    })
    .filter(Boolean)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>微电子简报 · IC Daily</title>
    <link>${esc(site + base)}</link>
    <description>每日微电子与集成电路产业动态</description>
    <language>zh-CN</language>
    <atom:link href="${esc(site + base)}/rss.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
