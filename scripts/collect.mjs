/**
 * 阶段 ①：采集
 * 并发抓取所有 RSS/Atom，解析成统一条目结构。
 * 单个源失败不影响整体（标 [SKIP]）。
 */
import { XMLParser } from 'fast-xml-parser';
import { loadSources, fetchConfig, loadSearch } from './config.mjs';
import { log } from './util.mjs';
import { canonicalUrl } from './quality.mjs';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  textNodeName: '#text',
  // 有些源把 HTML 塞进 CDATA，保留原文交给后面清洗
  cdataPropName: '__cdata',
  // 部分源（如 Intel Newsroom）嵌套层级极深或有异常标签，
  // 放宽限制避免 "Maximum nested tags exceeded" 直接失败
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
  allowBooleanAttributes: true,
});

/** 把可能是对象/数组/字符串的节点统一成字符串 */
function text(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'object') {
    if (node.__cdata != null) return text(node.__cdata);
    if (node['#text'] != null) return text(node['#text']);
    // atom: <link href="..."/>
    if (node['@_href']) return String(node['@_href']);
  }
  return '';
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** 从 Atom <link> 结构里挑 rel=alternate 的地址 */
function atomLink(entry) {
  const links = asArray(entry.link);
  const alt = links.find((l) => l && (l['@_rel'] === 'alternate' || !l['@_rel']));
  return text(alt) || text(links[0]);
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toISO(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 归一化单条：兼容 RSS 2.0 与 Atom */
export function normalize(item, source) {
  const title = stripHtml(text(item.title));
  const link = typeof item.link === 'string' ? item.link : atomLink(item) || text(item.guid) || text(item.id);
  const rawSummary =
    text(item.description) ||
    text(item.summary) ||
    text(item['content:encoded']) ||
    text(item.content) ||
    '';
  const fullContent = text(item['content:encoded']) || text(item.content);
  const published =
    toISO(text(item.pubDate)) ||
    toISO(text(item.published)) ||
    toISO(text(item.updated)) ||
    toISO(text(item['dc:date'])) ||
    null;

  if (!title || !link) return null;
  let publisher = source.name;
  if (source.kind === 'discovery') {
    try { publisher = new URL(link).hostname.replace(/^www\./, ''); } catch { return null; }
  }

  return {
    title,
    url: link.trim(),
    originalTitle: title,
    summary: stripHtml(rawSummary).slice(0, 4000),
    feedBody: stripHtml(fullContent).slice(0, 12000),
    published,
    source: { name: publisher, lang: source.lang, category: source.category, kind: source.kind || 'media', relay: Boolean(source.relay) },
    feedUrl: source.url,
    ...(source.kind === 'discovery' ? { discoveredVia: source.name } : {}),
    weight: Number(source.weight ?? 5),
  };
}

export async function fetchOne(source, attempt = 0) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), fetchConfig.timeoutMs);
  try {
    const res = await fetch(source.url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': fetchConfig.userAgent,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...(source.format === 'brave' ? { 'X-Subscription-Token': loadSearch().apiKey } : {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (source.format === 'brave') {
      const data = await res.json();
      if (!Array.isArray(data.results)) throw new Error('invalid_search_results');
      const normalized = data.results.map(r => normalize({ title: r.title, link: r.url, description: r.description, published: r.page_age }, source)).filter(Boolean);
      return { ok: true, source: source.name, items: normalized };
    }
    const xml = await res.text();
    if (!xml || xml.length < 50) throw new Error('empty body');

    const doc = parser.parse(xml);
    // RSS: rss.channel.item / RDF: rdf:RDF.item / Atom: feed.entry
    const channel = doc?.rss?.channel ?? doc?.['rdf:RDF'] ?? doc?.feed ?? null;
    if (!channel) throw new Error('invalid_feed_document');
    const items =
      asArray(channel?.item).length > 0
        ? asArray(channel.item)
        : asArray(channel?.entry).length > 0
          ? asArray(channel.entry)
          : asArray(doc?.feed?.entry);

    const normalized = items.map((i) => normalize(i, source)).filter(Boolean);
    return { ok: true, source: source.name, items: normalized };
  } catch (err) {
    if (attempt < fetchConfig.retries) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      return fetchOne(source, attempt + 1);
    }
    return { ok: false, source: source.name, error: err.message, items: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** 并发池 */
async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 采集全部源，返回 { items, report }
 * items 已做过 URL / 标题 去重
 */
export async function collect({ extraSources = [] } = {}) {
  const sources = [...loadSources(), ...extraSources];
  log.step(`采集 ${sources.length} 个信息源`);

  const results = await pool(
    sources.map((s) => () => fetchOne(s)),
    fetchConfig.concurrency,
  );

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  failed.forEach((f) => log.skip(`${f.source}: ${f.error}`));

  const all = ok.flatMap((r) => r.items);
  log.info(`抓取到 ${all.length} 条原始条目，来自 ${ok.length}/${sources.length} 个源`);

  // 去重：URL 规范化后取哈希；标题归一化后也做一次
  const byUrl = new Map();
  const byTitle = new Set();
  for (const it of all) {
    let key;
    try {
      key = canonicalUrl(it.url);
    } catch {
      key = it.url.toLowerCase();
    }
    if (!key || byUrl.has(key)) continue;
    const tkey = it.title.replace(/\s+/g, '').toLowerCase().slice(0, 60);
    if (byTitle.has(tkey)) continue;
    byTitle.add(tkey);
    byUrl.set(key, it);
  }

  const items = [...byUrl.values()];
  log.info(`去重后剩 ${items.length} 条`);

  return {
    items,
    report: {
      total: sources.length,
      ok: ok.length,
      failed: failed.map((f) => ({ source: f.source, error: f.error })),
      sources: results.map(r => ({ name: r.source, ok: r.ok, count: r.items.length, error: r.error || null })),
    },
  };
}
