/** Editorial rules apply to every publisher. A publisher name never bypasses them. */
export const clean = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
export function canonicalUrl(value) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    return u.href.replace(/\/$/, '');
  } catch { return ''; }
}

const CORE = /芯片|半导体|集成电路|晶圆|流片|制程|光刻|封装|封测|晶体管|光罩|掩模|存储芯片|碳化硅|氮化镓|光刻胶|硅片|基板|\b(semiconductors?|chips?|chipmaking|chipsets?|foundr(?:y|ies)|wafers?|lithography|photomasks?|transistors?|EDA|HBM\w*|DRAM|NAND|EUV|DUV|ASIC|FPGA|SoC|MCUs?|processors?|CPU|GPU|NPU|ADC|DAC|PCIe|Tessent|accelerators?|Exynos|Kirin|RISC-V|SiC|GaN)\b/i;
const COMPANY = /台积电|台積電|中芯国际|中芯國際|华虹|联电|聯電|长鑫|長鑫|长江存储|長江存儲|海力士|美光|英伟达|英特尔|高通|新思|楷登|中微|北方华创|\b(TSMC|SMIC|ASML|Nvidia|Intel|AMD|Qualcomm|Micron|Hynix|Synopsys|Cadence|Siemens|TI|Infineon|Renesas|NXP|Microchip|Broadcom|Rapidus|GlobalFoundries|KLA)\b/i;
const EVENT = /宣布|发布|發布|推出|获批|批准|投产|量产|试产|流片|完成|展示|收购|并购|融资|投资|扩产|扩建|建厂|营收|財報|财报|出口|限制|管制|禁令|签署|签约|突破|研发|研發|制成|成功|计划|計劃|确认|订单|出货|增长|扭亏|合作|\b(announc\w*|launch\w*|introduc\w*|approv\w*|unveil\w*|debut\w*|acquir\w*|acquisition|invest\w*|funding|rais\w*|expand\w*|expansion|reports?|earnings|revenue|restrict\w*|ban\w*|prototype|develop\w*|demonstrat\w*|tape[- ]?out|production|ramps?|signs?|plans?|breakthrough|targets?|partnership|orders?|shipments?|confirms?|extends?|advances?|embeds?|adds?|receiv\w*|carries)\b/i;
const NOT_NEWS = /乐高|樂高|积木|玩具|周边|周邊|招聘|校招|抽奖|领券|促销|开箱|评测|上手体验|荐股|涨停|龙虎榜|教程|入门指南|周报|週報|周回顾|一周回顾|要闻汇总|早报|日报|\b(lego|rebrickable|toys?|giveaway|coupons?|hands[- ]on|review|roundup|week\s+in\s+review|weekly|tutorial|how\s+to|webinar|sponsored|advertorial|video game|engineering game|simulation game)\b/i;
const ANALYSIS = /预示|意味着|为什么|如何|浅谈|深度解读|趋势展望|\b(opinion|commentary|signals?\s+a|why\s|how\s|outlook|insights)\b/i;
const OFF_TOPIC = /无源元件|被动元件|\bpassive components?\b|手机激活|整机销量|AI战略|AI戰略|模型竞赛|\bAI strategy\b/i;
export function assessItem(item, { now = Date.now(), windowHours = 24, allowUndated = false } = {}) {
  const title = clean(item.originalTitle || item.title);
  const summary = clean(item.summary);
  const reject = reason => ({ keep: false, reason });
  if (!canonicalUrl(item.url)) return reject('invalid_url');
  const published = Date.parse(item.published);
  if (!Number.isFinite(published) && !allowUndated && item.source?.kind !== 'discovery') return reject('missing_date');
  if (published > now + 3600_000) return reject('future_date');
  if ((now - published) / 3600_000 > windowHours) return reject('stale');
  if (NOT_NEWS.test(title)) return reject('roundup_promotion_or_non_news');
  if (OFF_TOPIC.test(title)) return reject('outside_semiconductor_scope');
  if (item.source?.name?.startsWith('arXiv')) return reject('preprint_not_daily_news');
  if (!CORE.test(title) && !(COMPANY.test(title) && EVENT.test(title))) return reject('no_chip_subject_in_headline');
  if (ANALYSIS.test(title) && !/获批|批准|收购|融资|量产|\b(acqui\w*|approv\w*|rais\w*|production)\b/i.test(title)) return reject('analysis_not_new_event');
  if (!EVENT.test(`${title} ${summary.slice(0, 450)}`)) return reject('no_concrete_event');
  const category = inferCategory(`${title} ${summary.slice(0, 250)}`);
  const age = Number.isFinite(published) ? (now - published) / 3600_000 : windowHours;
  const score = 10 + Math.min(10, Number(item.weight) || 0) + (CORE.test(title) ? 5 : 0) + (item.source?.kind === 'primary' ? 5 : 0) + (/\d/.test(title) ? 2 : 0) + Math.max(0, 4 - age / 6);
  return { keep: true, reason: 'candidate_requires_evidence_review', score, tags: [category], category };
}

export function inferCategory(text) {
  const patterns = [
    ['policy', /出口管制|制裁|禁令|补贴|批准|\b(export controls?|sanctions?|ban|subsid\w*)\b/i],
    ['equipment', /光刻机|光刻光源|EUV光源|\b(ASML|lithography|EUV light|etching|metrology)\b/i],
    ['eda', /\b(EDA|Synopsys|Cadence|design automation|IP core)\b|新思|楷登/i],
    ['memory', /\b(HBM\w*|DRAM|NAND|memory chips?|Micron|Hynix)\b|存储芯片|长鑫|长江存储|美光|海力士/i],
    ['foundry', /晶圆厂|晶圆代工|制程|\b(TSMC|SMIC|foundry|fab|process node|Rapidus)\b|台积电|中芯/i],
    ['material', /封装|封测|基板|材料|光刻胶|\b(packaging|substrate|photoresist|chiplet|SiC|GaN)\b/i],
    ['design', /架构|芯片|\b(chip|GPU|CPU|NPU|MCUs?|ASIC|FPGA|processors?|RISC-V)\b/i],
  ];
  return patterns.find(([, re]) => re.test(text))?.[0] || 'market';
}

const aliases = [[/台积电|台積電|\btsmc\b/gi, 'tsmc'], [/英伟达|\bnvidia\b/gi, 'nvidia'], [/英特尔|\bintel\b/gi, 'intel'], [/\bbolt(?: graphics)?\b/gi, 'bolt'], [/海力士|\bsk hynix\b/gi, 'hynix'], [/朗道硅光|\blangdao(?:\s+silex)?\b/gi, 'langdao']];
function normalizedTitle(item) {
  let t = clean(item.originalTitle || item.title).toLowerCase();
  for (const [re, to] of aliases) t = t.replace(re, to);
  return t.replace(/[^\p{L}\p{N}]/gu, '');
}
function grams(text) { return new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2))); }
export function sameEvent(a, b) {
  if (canonicalUrl(a.url) && canonicalUrl(a.url) === canonicalUrl(b.url)) return true;
  // A differently worded follow-up can repeat the same prototype's specifications.
  // Known concrete entity + product + measured milestone beats model-generated keys.
  const prototype = item => {
    const text = `${item.originalTitle || item.title} ${item.summary || ''} ${item.url || ''}`;
    const entity = aliases.find(([re]) => new RegExp(re.source, re.flags.replace('g', '')).test(text))?.[1];
    if (!entity || !/EUV|极紫外/i.test(text) || !/prototype|原型/i.test(text)) return null;
    const power = /(\d+(?:\.\d+)?)\s*[- ]?(?:watts?|w)\b/i.exec(text)?.[1] || /(\d+)\s*瓦/.exec(text)?.[1];
    return power ? `${entity}-euv-prototype-${power}w` : null;
  };
  const pa = prototype(a), pb = prototype(b);
  if (pa && pb) return pa === pb;
  if (a.eventKey && b.eventKey) return a.eventKey === b.eventKey;
  const ta = normalizedTitle(a), tb = normalizedTitle(b);
  if (ta.length < 8 || tb.length < 8) return false;
  const ga = grams(ta), gb = grams(tb);
  const common = [...ga].filter(g => gb.has(g)).length;
  return 2 * common / (ga.size + gb.size) >= .72;
}

export function qualifyDraft(item, draft) {
  const uncertain = /消息称|据传|传闻|曝光|\b(rumou?rs?|reportedly|leaks?|leaked)\b/i.test(item.originalTitle || item.title);
  const qualified = { ...draft };
  if (uncertain && !/消息称|据报道|传闻|曝光|据悉/.test(qualified.title)) qualified.title = `消息称：${qualified.title}`;
  if (uncertain && !/据报道|消息称|报道称|传闻|据悉/.test(qualified.summary)) qualified.summary = `据报道，${qualified.summary}`;
  return qualified;
}
export function dedupeEvents(items, history = []) {
  const kept = [], rejected = [];
  for (const item of items) {
    const prior = history.find(p => sameEvent(item, p));
    const sibling = kept.find(p => sameEvent(item, p));
    if (prior || sibling) rejected.push({ title: item.title, url: item.url, reason: prior ? 'already_covered' : 'same_event', duplicateOf: (prior || sibling).url });
    else kept.push(item);
  }
  return { items: kept, rejected };
}
