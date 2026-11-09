/**
 * 阶段 ④：AI 撰写
 * OpenAI 兼容 Chat Completions 接口。
 * 核心设计：AI 只负责「语义」，输出严格 JSON；排版全部由代码处理。
 * 无 API key 时自动降级为规则摘要，流水线照常完成。
 */
import { loadLLM, CATEGORY_META } from './config.mjs';
import { pool, log, sleep } from './util.mjs';
import { qualifyDraft } from './quality.mjs';

const SYSTEM_PROMPT = `你是一名资深的半导体/集成电路行业分析师，负责为中文读者撰写每日行业简报。

你的输出必须是严格的 JSON，不要有任何解释文字、不要用 markdown 代码块包裹。

写作要求：
1. 客观、专业、信息密度高。删除"据悉""值得注意的是"这类空话。
2. 中文表达，但公司名、技术名词、制程代号保留通行英文（如 TSMC、EUV、HBM3E、N2、CoWoS）。
3. 摘要 2-3 句，约 100-180 字，交代事件来龙去脉，不复述标题。
4. 如果原文信息不足，如实简略，禁止编造数字、日期、人名、引语。
5. 数字与事实必须来自原文；保留原文数字和单位，不自行换算或补全。
6. 不写空泛行业意义或趋势预测。摘要直接交代主体、动作、对象与新事实。
7. 不把“计划/预计/原型/传闻”改成“已完成/已量产/获批”，保留原文的不确定性。`;

function buildUserPrompt(batch) {
  const lines = batch.map((it, i) => {
    const parts = [
      `[${i}] 标题：${it.title}`,
      `来源：${it.source?.name || '未知'}（${it.published || '无日期'}）`,
    ];
    if (it.suggestedCategory) parts.push(`编辑分类：${it.suggestedCategory}`);
    if (it.body) parts.push(`原文正文：${it.body.slice(0, 4500)}`);
    else if (it.summary) parts.push(`来源摘要（不是全文）：${it.summary.slice(0, 1200)}`);
    if (it.editorial?.evidence?.length) parts.push(`已核对的原文证据：${it.editorial.evidence.join('\n')}`);
    return parts.join('\n');
  });

  return `下面是今日候选新闻。请为每一条输出一个对象。

${lines.join('\n\n')}

输出格式（严格符合此 JSON 结构，items 数组长度必须等于 ${batch.length}，序号 index 对应上面的 [n]）：
{
  "items": [
    {
      "index": 0,
      "title": "改写后的中文标题，不超过 30 字，不要用问句和标题党",
      "summary": "2-3句中文摘要，交代主体、动作、关键数字与进度",
      "cards": [{"heading":"4-10字的小标题", "body":"45-120字的具体内容，包含参数、时间表、对象或范围；同一条内各卡片互不重复。原文充足时给3-4张卡，资料少时可给1-2张，不为填满而编造"}],
      "category": "从这些里选一个: foundry|equipment|eda|memory|design|material|policy|research|market",
      "importance": 1
    }
  ]
}

importance 取 1-5 的整数，5 表示当日的重大事件（重大并购、制程突破、政策变动、龙头财报），1 表示日常资讯。
必须完整输出所有条目后再结束，不要省略 index、title 或 summary；字符串中的双引号、换行必须按 JSON 规范转义。`;
}

/** 从模型返回里抠出 JSON（容忍 ```json 包裹或前后杂字） */
export function extractJSON(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(s);
  } catch {
    /* continue */
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

export async function callLLM(cfg, messages, attempt = 0, json = true) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.3,
        max_tokens: json ? 6000 : 2000,
        // U2 uses prompt-constrained JSON; its API does not advertise json_object.
        // Disable reasoning for short daily summaries and interactive reading.
        ...(cfg.model === 'u2-flash' ? { thinking: { type: 'disabled' }, reasoning_effort: 'none' } : {}),
        ...(json && !cfg.model.startsWith('u2') ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!res.ok) {
      // Never propagate upstream response bodies: they can contain private details.
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('empty completion');
    return content;
  } catch (err) {
    const retriable = json && attempt < 2 && !/HTTP 4\d\d/.test(String(err.message));
    if (retriable) {
      await sleep(1500 * (attempt + 1));
      return callLLM(cfg, messages, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 规则降级：直接清洗原始标题 */
function fallbackItem(it) {
  return {
    title: it.title.replace(/\s*[-|–]\s*[^-|–]{2,20}$/, '').slice(0, 60),
    summary: (it.summary || '').slice(0, 160) || it.title,
    points: [],
    category: it.source?.category || 'market',
    importance: 3,
  };
}

/** 只接受唯一 index 与非空标题/摘要；有问题的条目留待单条补写。 */
function validDrafts(parsed, count) {
  const drafts = new Map();
  const seen = new Set();
  for (const r of parsed.items) {
    if (!Number.isInteger(r?.index) || r.index < 0 || r.index >= count) continue;
    if (seen.has(r.index)) {
      drafts.delete(r.index);
      continue;
    }
    seen.add(r.index);
    if (typeof r.title === 'string' && r.title.trim() && typeof r.summary === 'string' && r.summary.trim()) {
      drafts.set(r.index, r);
    }
  }
  return drafts;
}

/**
 * 主入口：批量改写，失败条目最多再单独补写两轮，已成功条目不重复请求。
 * 严格模式耗尽重试后停止发布；非严格模式才使用规则摘要。
 * 返回与入参等长的数组，每项含 title/summary/points/category/importance。
 */
export async function write(items, { strict = false } = {}) {
  const cfg = loadLLM();

  if (!cfg.enabled) {
    log.warn('未配置 LLM_API_KEY —— 使用规则模式（不做 AI 改写）');
    return items.map(fallbackItem);
  }

  log.step(`AI 撰写（${cfg.model}，${items.length} 条）`);

  const BATCH = 2;
  const batches = [];
  for (let i = 0; i < items.length; i += BATCH) {
    batches.push({ start: i, slice: items.slice(i, i + BATCH) });
  }

  const results = new Array(items.length).fill(null);
  const errors = new Map();
  const blocked = new Set();
  const RETRIES = 2;
  let pending = batches;

  for (let round = 0; round <= RETRIES && pending.length; round++) {
    const outcomes = await pool(
      pending.map((b) => async () => {
        const messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(b.slice) },
        ];
        if (round > 0) messages[1].content += '\n上次输出无法通过 JSON 或条目完整性校验。请只重写当前这一条，index 必须是 0，返回完整的 {"items":[...]} JSON，不要解释或使用代码块。';
        const raw = await callLLM(cfg, messages);
        const parsed = extractJSON(raw);
        if (!Array.isArray(parsed?.items)) throw new Error('JSON 解析失败或缺少 items 数组');
        return validDrafts(parsed, b.slice.length);
      }),
      cfg.concurrency,
    );

    outcomes.forEach((out, bi) => {
      const b = pending[bi];
      const byIndex = out instanceof Map ? out : new Map();
      const reason = out?.__error?.message || '条目缺失、重复 index 或标题/摘要无效';
      if (byIndex.size < b.slice.length) {
        log.warn(`AI ${round === 0 ? `批次 ${bi + 1}/${batches.length}` : `补写第 ${round}/${RETRIES} 轮（条目 ${b.start + 1}）`} 未完整生成：${String(reason).slice(0, 80)}`);
      }

      b.slice.forEach((it, k) => {
        const index = b.start + k;
        const r = byIndex.get(k);
        if (!r) {
          errors.set(index, reason);
          // Authentication and other permanent client errors cannot be fixed by rewriting.
          if (/HTTP 4\d\d/.test(reason) && !/HTTP (408|429)\b/.test(reason)) blocked.add(index);
          return;
        }
        errors.delete(index);
        const cards = Array.isArray(r.cards) ? r.cards.filter(c => c && typeof c.heading === 'string' && typeof c.body === 'string' && c.body.trim()).slice(0, 4).map(c => ({ heading: c.heading.trim().slice(0, 20), body: c.body.trim().slice(0, 240) })) : [];
        results[index] = qualifyDraft(it, {
          title: String(r.title || it.title).trim().slice(0, 80),
          summary: String(r.summary || '').trim().slice(0, 600),
          cards,
          points: Array.isArray(r.points)
            ? r.points.filter((p) => typeof p === 'string' && p.trim()).slice(0, 4)
            : cards.map(c => c.body),
          category: Object.hasOwn(CATEGORY_META, it.suggestedCategory) ? it.suggestedCategory : Object.hasOwn(CATEGORY_META, r.category) ? r.category : it.source?.category || 'market',
          importance: Math.min(5, Math.max(1, Number(r.importance) || 3)),
        });
      });
    });

    pending = items.flatMap((it, index) => results[index] || blocked.has(index) ? [] : [{ start: index, slice: [it] }]);
    if (pending.length && round < RETRIES) log.info(`保留已完成稿件，${pending.length} 条失败条目将单独补写`);
  }

  const aiOk = results.filter(Boolean).length;
  if (strict && aiOk !== items.length) {
    const details = [...errors].map(([index, reason]) => `${index + 1}: ${String(reason).slice(0, 80)}`).join('；');
    throw new Error(`AI 未完整生成（${aiOk}/${items.length} 条完成；失败条目 ${details}），本次不覆盖已有日报。请稍后重试。`);
  }
  if (aiOk !== items.length) log.warn(`AI 改写 ${aiOk}/${items.length} 条完成，其余在补写后仍失败，使用规则摘要`);
  else log.ok(`AI 改写完成：${aiOk}/${items.length} 条全部走了模型`);
  return results.map((draft, index) => draft || fallbackItem(items[index]));
}
