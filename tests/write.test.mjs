import test from 'node:test';
import assert from 'node:assert/strict';
import { callLLM, extractJSON, write } from '../scripts/write.mjs';

const article = i => ({
  title: `TSMC fab news ${i}`,
  summary: `Original source summary ${i}`,
  body: `TSMC announced a new semiconductor fabrication plant ${i}.`,
  source: { name: 'Test publisher', category: 'foundry' },
});
const draft = (index, title = `AI 标题 ${index}`) => ({ index, title, summary: `已核对的摘要：${title}`, category: 'foundry', importance: 4 });

function mockLLM(t, handler) {
  const originalFetch = globalThis.fetch;
  const keys = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_CONCURRENCY'];
  const originalEnv = new Map(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, {
    LLM_API_KEY: 'test-only-key', LLM_BASE_URL: 'https://llm.example/v1',
    LLM_MODEL: 'u2-flash', LLM_CONCURRENCY: '3',
  });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://llm.example/v1/chat/completions');
    const request = JSON.parse(options.body);
    calls.push(request);
    const result = await handler(request, calls.length);
    if (result instanceof Response) return result;
    return Response.json({ choices: [{ message: { content: typeof result === 'string' ? result : JSON.stringify(result) } }] });
  };
  return calls;
}

function inputTitles(request) {
  return [...request.messages[1].content.matchAll(/^\[\d+\] 标题：(.+)$/gm)].map(match => match[1]);
}

test('JSON extraction tolerates fences and explanatory text without accepting broken JSON', () => {
  assert.deepEqual(extractJSON('```json\n{"items": []}\n```'), { items: [] });
  assert.deepEqual(extractJSON('结果：\n{"items": []}\n结束'), { items: [] });
  assert.equal(extractJSON('{"items": [{"title": "truncated'), null);
  assert.equal(extractJSON(''), null);
});

test('JSON extraction repairs trailing commas, missing quotes and literal newlines while retaining text', () => {
  assert.deepEqual(extractJSON('{items: [{index: 0, title: "标题", summary: "摘要",},],}'), { items: [{ index: 0, title: '标题', summary: '摘要' }] });
  assert.deepEqual(extractJSON('{"summary":"正文包含"引用"和参数"}'), { summary: '正文包含"引用"和参数' });
  assert.deepEqual(extractJSON('{"summary":"第一行\n第二行"}'), { summary: '第一行\n第二行' });
  assert.deepEqual(extractJSON('<think>思考中的 {不是输出}</think>\n```json\n{"items":[]}\n```'), { items: [] });
  assert.deepEqual(extractJSON('结果 {"summary":"参数 {A} 与 [B]"} 结束'), { summary: '参数 {A} 与 [B]' });
  assert.equal(extractJSON('{"items":[{"index":0,"title":"标题","summary":"完整的内层对象"}'), null);
  assert.deepEqual(extractJSON('{"summary":"保留 <think>标签内容</think> 原文"}'), { summary: '保留 <think>标签内容</think> 原文' });
  assert.equal(extractJSON('{items:[{index:1e,title:"标题",summary:"摘要"}]}'), null);
  assert.deepEqual(extractJSON('结果 [0]：{"items":[]}'), { items: [] });
});

test('the reported 5/7 failure recovers via single-item rewrites, preserving successful batches and order', async t => {
  const items = Array.from({ length: 7 }, (_, i) => article(i));
  const calls = mockLLM(t, request => {
    const titles = inputTitles(request);
    if (titles.length === 2 && titles[0] === items[0].title) return '{"items": [';
    return { items: titles.map((title, index) => draft(index, `改写 ${title}`)) };
  });
  const result = await write(items, { strict: true });
  assert.equal(result.length, 7);
  assert.deepEqual(result.map(r => r.title), items.map(it => `改写 ${it.title}`));
  assert.equal(calls.length, 6); // Four initial batches, then two single-item rewrites.
  assert.deepEqual(calls.slice(4).map(inputTitles), [[items[0].title], [items[1].title]]);
  assert.ok(calls.slice(4).every(request => request.messages[1].content.includes('index 必须是 0')));
});

test('missing or invalid drafts are retried alone without overwriting successful drafts', async t => {
  const items = [article(0), article(1)];
  const calls = mockLLM(t, (_request, n) => n === 1
    ? { items: [draft(1, '保留成功稿件'), { ...draft(0), summary: '  ' }] }
    : { items: [draft(0, '补写稿件')] });
  const result = await write(items, { strict: true });
  assert.deepEqual(result.map(r => r.title), ['补写稿件', '保留成功稿件']);
  assert.equal(calls.length, 2);
  assert.deepEqual(inputTitles(calls[1]), [items[0].title]);
});

test('duplicate and out-of-range indices never silently replace valid drafts', async t => {
  const calls = mockLLM(t, (_request, n) => n === 1
    ? { items: [draft(0, '冲突 A'), draft(0, '冲突 B'), draft(0, '冲突 C'), draft(1, '有效稿件'), draft(99)] }
    : { items: [draft(0, '无歧义补写')] });
  const result = await write([article(0), article(1)], { strict: true });
  assert.deepEqual(result.map(r => r.title), ['无歧义补写', '有效稿件']);
  assert.equal(calls.length, 2);
});

test('JSON schema failures and omitted items receive both bounded recovery attempts', async t => {
  const calls = mockLLM(t, (_request, n) => {
    if (n === 1) return { wrong: [] };
    if (n === 2) return { items: [] };
    return { items: [draft(0, '第三次完成')] };
  });
  assert.equal((await write([article(0)], { strict: true }))[0].title, '第三次完成');
  assert.equal(calls.length, 3);
});

test('persistent JSON syntax errors are repaired without repeated API calls', async t => {
  const calls = mockLLM(t, () => '{items:[{index:0,title:"标题",summary:"原文摘要",},],}');
  assert.equal((await write([article(0)], { strict: true }))[0].summary, '原文摘要');
  assert.equal(calls.length, 1);
});

test('the final recovery round uses a minimal schema when full drafts repeatedly fail', async t => {
  const calls = mockLLM(t, (request, n) => {
    if (n < 3) return '{"items":[';
    assert.match(request.messages[1].content, /不要输出 cards、points/);
    assert.equal(request.messages[1].content.includes('heading'), false);
    return { title: '精简稿件', summary: '真实模型摘要。' }; // Compatible single-item response.
  });
  const [result] = await write([article(0)], { strict: true });
  assert.equal(result.title, '精简稿件');
  assert.equal(result.category, 'foundry');
  assert.deepEqual(result.cards, []);
  assert.equal(calls.length, 3);
});

test('bare arrays are accepted only with explicit valid indices', async t => {
  const calls = mockLLM(t, () => [draft(1, '第二条'), draft(0, '第一条')]);
  assert.deepEqual((await write([article(0), article(1)], { strict: true })).map(d => d.title), ['第一条', '第二条']);
  assert.equal(calls.length, 1);
});

test('completion text arrays are normalized and truncated output is never silently repaired', async t => {
  mockLLM(t, () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: [{ type: 'text', text: '{"it' }, { type: 'text', text: 'ems":[]}' }] } }] }));
  const cfg = { baseUrl: 'https://llm.example/v1', apiKey: 'test', model: 'u2-flash', timeoutMs: 1000 };
  assert.equal(await callLLM(cfg, []), '{"items":[]}');
  globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"items":[]}' } }] });
  await assert.rejects(callLLM(cfg, []), /completion_truncated/);
});

test('strict mode still stops publication after bounded retries and identifies failed items', async t => {
  const calls = mockLLM(t, () => 'not JSON');
  await assert.rejects(write([article(0)], { strict: true }), error => {
    assert.match(error.message, /0\/1 条完成/);
    assert.match(error.message, /失败条目 1: JSON 解析失败/);
    assert.match(error.message, /不覆盖已有日报/);
    return true;
  });
  assert.equal(calls.length, 3);
});

test('non-strict mode uses rule summaries only after recovery attempts are exhausted', async t => {
  const calls = mockLLM(t, () => ({ items: [{ index: 0, title: '', summary: '' }] }));
  const result = await write([article(0)]);
  assert.equal(calls.length, 3);
  assert.equal(result[0].title, article(0).title);
  assert.equal(result[0].summary, article(0).summary);
});

test('permanent HTTP errors fail promptly and never leak private upstream response bodies', async t => {
  const calls = mockLLM(t, () => new Response('private upstream credentials', { status: 401 }));
  await assert.rejects(write([article(0)], { strict: true }), error => {
    assert.match(error.message, /HTTP 401/);
    assert.equal(error.message.includes('private upstream credentials'), false);
    return true;
  });
  assert.equal(calls.length, 1);
});

test('HTTP rate limits can recover in a later rewrite round', async t => {
  const calls = mockLLM(t, (_request, n) => n === 1
    ? new Response('rate limit', { status: 429 })
    : { items: [draft(0)] });
  assert.equal((await write([article(0)], { strict: true })).length, 1);
  assert.equal(calls.length, 2);
});

test('without an API key rule mode never calls the model, and empty input needs no requests', async t => {
  const calls = mockLLM(t, () => { throw Error('must not call the model'); });
  assert.deepEqual(await write([], { strict: true }), []);
  delete process.env.LLM_API_KEY;
  assert.equal((await write([article(0)]))[0].summary, article(0).summary);
  assert.equal(calls.length, 0);
});
