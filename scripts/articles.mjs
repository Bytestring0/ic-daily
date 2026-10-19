import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { qualityConfig, fetchConfig } from './config.mjs';
import { clean, canonicalUrl } from './quality.mjs';
import { pool, log } from './util.mjs';

export function extractArticle(html, url) {
  const { document } = parseHTML(html);
  Object.defineProperty(document, 'documentURI', { value: url });
  const published = document.querySelector('meta[property="article:published_time"],meta[name="date"],meta[name="parsely-pub-date"],time[datetime]');
  let date = published?.getAttribute('content') || published?.getAttribute('datetime') || null;
  let structuredBody = '';
  const walk = obj => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) return obj.forEach(walk);
    if (/Article|NewsArticle|BlogPosting/.test(String(obj['@type']))) {
      date ||= obj.datePublished || null;
      if (typeof obj.articleBody === 'string') structuredBody = obj.articleBody;
    }
    if (obj['@graph']) walk(obj['@graph']);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { walk(JSON.parse(script.textContent)); } catch {}
  }
  const blocked = /just a moment|access denied|verify you are human|人机验证|订阅后阅读|subscribe to (?:continue|read)|sign in to (?:continue|read)/i.test(`${document.title} ${document.body?.textContent?.slice(0, 1500)}`);
  if (blocked && !structuredBody) throw new Error('blocked_or_paywalled');
  const article = new Readability(document, { charThreshold: 200, maxElemsToParse: 50000 }).parse();
  const body = clean(structuredBody || article?.textContent);
  const minimum = /[\u4e00-\u9fff]/.test(body) ? 140 : qualityConfig.minArticleLength;
  if (body.length < minimum) throw new Error('insufficient_article_text');
  return { body: body.slice(0, 10000), articleTitle: clean(article?.title), articlePublished: date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null };
}

async function fetchHtml(url, signal) {
  const response = await fetch(url, { signal, headers: { 'User-Agent': fetchConfig.userAgent, Accept: 'text/html,application/xhtml+xml' } });
  if (!response.ok) throw new Error(`article_http_${response.status}`);
  if (!response.headers.get('content-type')?.includes('html')) throw new Error('not_an_html_article');
  const limit = 6_000_000; const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('article_too_large');
    chunks.push(chunk);
  }
  return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: response.url };
}
export async function readArticle(item) {
  const url = canonicalUrl(item.url);
  if (!url) throw new Error('invalid_article_url');
  let result, article;
  try {
    result = await fetchHtml(url, AbortSignal.timeout(qualityConfig.articleTimeoutMs));
    article = extractArticle(result.html, result.finalUrl);
  } catch (error) {
    const fallback = feedEvidence(item, error.message);
    if (fallback) return fallback;
    throw error;
  }
  // Web search results often have no date. Only the original page may supply it.
  const published = article.articlePublished || (item.source?.kind === 'discovery' ? null : item.published);
  if (!published) throw new Error('missing_original_date');
  return { ...item, ...article, published, url: canonicalUrl(result.finalUrl), originalTitle: item.originalTitle || item.title, evidenceType: 'article', retrievedAt: new Date().toISOString() };
}

export function feedEvidence(item, articleError = 'article_unavailable') {
  // Publisher RSS text is evidence too. Never treat web-search snippets as full articles.
  if (item.source?.kind === 'discovery' || !item.published || !item.feedUrl) return null;
  const full = clean(item.feedBody);
  const excerpt = clean(item.summary);
  const body = full.length > excerpt.length ? full : excerpt;
  const minimum = /[\u4e00-\u9fff]/.test(body) ? 100 : 200;
  if (body.length < minimum || /just a moment|access denied|verify you are human/i.test(body)) return null;
  return { ...item, body, originalTitle: item.originalTitle || item.title, evidenceType: full.length >= body.length && full.length > 500 ? 'feed_full' : 'feed_excerpt', retrievedAt: new Date().toISOString(), articlePublished: null, articleReadError: articleError };
}
export async function enrichArticles(items, { audit = [], reader = readArticle } = {}) {
  log.step(`读取 ${items.length} 篇原始报道（无法读取则不收录）`);
  const outcomes = await pool(items.map(item => async () => reader(item)), qualityConfig.articleConcurrency);
  const kept = [];
  outcomes.forEach((out, i) => {
    if (!out || out.__error) audit.push({ title: items[i].title, url: items[i].url, stage: 'article', reason: out?.__error?.message || 'article_unavailable' });
    else kept.push(out);
  });
  log.info(`原文可用 ${kept.length}/${items.length} 篇`);
  return kept;
}
