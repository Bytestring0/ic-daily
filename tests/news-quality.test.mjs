import test from 'node:test';
import assert from 'node:assert/strict';
import { assessItem, canonicalUrl, dedupeEvents, sameEvent, qualifyDraft } from '../scripts/quality.mjs';
import { validateDecisions, reviewNews } from '../scripts/editor.mjs';
import { extractArticle, enrichArticles, feedEvidence } from '../scripts/articles.mjs';
import { normalize, fetchOne } from '../scripts/collect.mjs';
import { sanitizeQuery } from '../scripts/discovery.mjs';
const now = Date.parse('2026-10-19T12:00:00Z');
const item = (title, extra = {}) => ({ title, summary: '', url: 'https://example.com/news/1', published: '2026-10-19T08:00:00Z', source: { name: 'EE Times' }, ...extra });

test('reject real regressions regardless of publisher or chip buzzwords', () => {
  for (const title of [
    'ASML员工限定High-NA EUV乐高套件被复刻',
    'ASML employee-exclusive EUV Lego kit now available on Rebrickable',
    '嵌入式周报：边缘AI实时系统与PCIe 6.0进展',
    'Chip industry week in review',
    '新加坡AI战略转向部署与韧性建设',
    'Automotive demands driving passive components to extreme performance',
    '台积电AI扩张预示计算产业广泛转型',
    'Anthropic announces AI agent subscription',
  ]) assert.equal(assessItem(item(title), { now }).keep, false, title);
});

test('retain actual chip production and technical events without blanket EV or launch exclusions', () => {
  for (const title of [
    '台积电获批建设3nm晶圆厂',
    '中国初创展示EUV光源原型',
    'Nvidia launches new GPU architecture for AI accelerators',
    '碳化硅功率半导体量产，面向电动汽车',
    'ASML announces new EUV lithography system',
  ]) assert.equal(assessItem(item(title), { now }).keep, true, title);
  assert.equal(assessItem(item('TSMC announces new fab', { published: '2026-10-10T00:00:00Z' }), { now }).reason, 'stale');
  assert.equal(assessItem(item('TSMC announces new fab', { published: '2026-10-20T00:00:00Z' }), { now }).reason, 'future_date');
  assert.equal(assessItem(item('TSMC announces new fab', { published: null }), { now }).reason, 'missing_date');
});

test('24-hour window uses publication instants across time zones and excludes future timestamps', () => {
  const check = published => assessItem(item('TSMC announces new fab', { published }), { now, windowHours: 24 });
  assert.equal(check('2026-10-18T20:00:00+08:00').keep, true);
  assert.equal(check('2026-10-18T19:59:59.999+08:00').reason, 'stale');
  assert.equal(check('2026-10-19T20:00:00+08:00').keep, true);
  assert.equal(check('2026-10-19T20:00:00.001+08:00').reason, 'future_date');
  assert.equal(check('2026-10-19T20:30:00+08:00').reason, 'future_date');
});

test('deduplicate tracking URLs and cross-language event keys, keep distinct milestones', () => {
  assert.equal(canonicalUrl('https://example.com/news/1?utm_source=x#top'), 'https://example.com/news/1');
  assert.equal(canonicalUrl('javascript:alert(1)'), '');
  const a = item('台积电熊本二厂获批3nm计划', { eventKey: 'tsmc-approval-kumamoto-fab2-3nm' });
  const b = item('Japan approves TSMC Kumamoto 3nm fab', { url: 'https://other.com/story', eventKey: a.eventKey });
  const c = item('TSMC begins Arizona N2 production', { url: 'https://third.com/story', eventKey: 'tsmc-production-arizona-n2' });
  assert.equal(sameEvent(a, b), true);
  assert.equal(sameEvent(a, c), false);
  assert.equal(dedupeEvents([a, b, c]).items.length, 2);
  assert.equal(dedupeEvents([b], [a]).rejected[0].reason, 'already_covered');
  const old = item('中国初创展示EUV光源原型', { summary: '朗道硅光在展会展示EUV光源原型', url: 'https://tom.example/china-prototype-euv-light-source-15w-of-output' });
  const syndicated = item('Chinese startup presents 15-watt EUV source prototype', { summary: 'Langdao Silex presented a 15-watt EUV prototype', url: 'https://bits.example/article/prototype', eventKey: 'langdao-15w' });
  assert.equal(sameEvent(old, syndicated), true);
  assert.equal(dedupeEvents([syndicated], [old]).items.length, 0);
});

test('search planning removes date noise without treating search dates as article dates', () => {
  assert.equal(sanitizeQuery('October 2026 semiconductor production after:2026-10-18'), 'semiconductor production');
});

test('rewriting must retain reported status instead of turning a rumor into a company announcement', () => {
  const draft = qualifyDraft(item('消息称三星计划进军硅光子学'), { title: '三星计划2027年进入硅光子学', summary: '三星计划使用12英寸技术。' });
  assert.match(draft.title, /^消息称/);
  assert.match(draft.summary, /^据报道/);
});

test('AI editor must provide an exact quote; missing, fabricated and duplicate decisions fail closed', () => {
  const article = { ...item('TSMC announces fab'), body: 'TSMC announced a new semiconductor fabrication plant with additional production capacity.' };
  const decision = { index: 0, keep: true, novel: true, quality: 4, eventKey: 'tsmc-fab-expansion', category: 'foundry', evidence: ['TSMC announced a new semiconductor fabrication plant'] };
  assert.equal(validateDecisions([article], [decision], []).length, 1);
  assert.equal(validateDecisions([article], [{ ...decision, evidence: ['TSMC announced record revenue and profit this week'] }], []).length, 0);
  assert.equal(validateDecisions([article], [], []).length, 0);
  assert.equal(validateDecisions([article], [decision, decision], []).length, 0);
  assert.equal(validateDecisions([article], [{ ...decision, novel: false }], []).length, 0);
  assert.equal(validateDecisions([article], [{ ...decision, evidence: undefined, evidenceIds: [1] }], []).length, 1);
  assert.equal(validateDecisions([article], [{ ...decision, evidence: undefined, evidenceIds: [999] }], []).length, 0);
});

test('extract actual article body and publication date, reject blocked or empty pages', () => {
  const body = 'TSMC announced a new semiconductor fabrication plant with additional production capacity. '.repeat(15);
  const result = extractArticle(`<html><head><title>TSMC announces fab</title><meta property="article:published_time" content="2026-10-19T08:00:00Z"></head><body><nav>Subscribe and login</nav><article><h1>TSMC announces fab</h1><p>${body}</p></article></body></html>`, 'https://example.com/story');
  assert.ok(result.body.includes('semiconductor fabrication plant'));
  assert.equal(result.articlePublished, '2026-10-19T08:00:00.000Z');
  assert.throws(() => extractArticle('<html><head><title>Just a moment</title></head><body>Verify you are human</body></html>', 'https://example.com'), /blocked/);
});

test('failed article fetch is excluded, and Atom alternate links are preserved', async () => {
  const audit = [];
  assert.equal((await enrichArticles([item('TSMC announces fab')], { audit, reader: async () => { throw Error('article_http_403'); } })).length, 0);
  assert.equal(audit[0].reason, 'article_http_403');
  const normalized = normalize({ title: 'TSMC announces fab', link: [{ '@_href': 'https://example.com/self', '@_rel': 'self' }, { '@_href': 'https://example.com/story', '@_rel': 'alternate' }], published: '2026-10-19T08:00:00Z' }, { name: 'Atom' });
  assert.equal(normalized.url, 'https://example.com/story');
});

test('publisher RSS evidence can be used transparently; web-search snippets cannot', () => {
  const publisher = { ...item('TSMC announces new fab'), feedUrl: 'https://publisher.example/feed', summary: 'TSMC announced a semiconductor fabrication plant with new capacity and investment milestones. '.repeat(4) };
  const fallback = feedEvidence(publisher, 'blocked_or_paywalled');
  assert.equal(fallback.evidenceType, 'feed_excerpt');
  assert.equal(fallback.articleReadError, 'blocked_or_paywalled');
  assert.equal(feedEvidence({ ...publisher, source: { kind: 'discovery' } }), null);
  assert.equal(feedEvidence({ ...publisher, summary: 'A short headline only.' }), null);
});

test('editor failure stops publication instead of silently approving candidates', async () => {
  await assert.rejects(reviewNews([{ ...item('TSMC announces fab'), body: 'Actual original article text.' }], { reviewer: async () => { throw Error('upstream unavailable'); } }), /upstream unavailable/);
});

test('optional news search adapter preserves real publisher URLs and keeps its key out of results', async t => {
  const originalFetch = globalThis.fetch, oldKey = process.env.BRAVE_SEARCH_API_KEY;
  t.after(() => { globalThis.fetch = originalFetch; if (oldKey === undefined) delete process.env.BRAVE_SEARCH_API_KEY; else process.env.BRAVE_SEARCH_API_KEY = oldKey; });
  process.env.BRAVE_SEARCH_API_KEY = 'test-search-secret';
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers['X-Subscription-Token'], 'test-search-secret');
    return Response.json({ results: [{ title: 'TSMC announces new fab', url: 'https://pr.tsmc.com/english/news/123', description: 'Actual news excerpt', page_age: '2026-10-19T08:00:00Z' }] });
  };
  const out = await fetchOne({ name: '主题检索', format: 'brave', kind: 'discovery', url: 'https://api.search.brave.com/res/v1/news/search?q=TSMC', weight: 5 });
  assert.equal(out.ok, true);
  assert.equal(out.items[0].source.name, 'pr.tsmc.com');
  assert.equal(out.items[0].url, 'https://pr.tsmc.com/english/news/123');
  assert.equal(JSON.stringify(out).includes('test-search-secret'), false);
});
