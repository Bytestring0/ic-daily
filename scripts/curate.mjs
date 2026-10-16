/**
 * 阶段 ②③：过滤 + 打分 + 精选
 * 纯规则，不调用 LLM —— 保证即使没有 API key 也有稳定产出。
 */
import { WINDOW_HOURS, EDITION_LIMIT } from './config.mjs';
import { hoursAgo, log } from './util.mjs';

/** 关键词分档：命中越靠前，加分越多 */
const KW = [
  // 一档：产业链核心事件
  { re: /(tape[- ]?out|流片|风险试产|量产|mass production|ramp|yield|良率)/i, score: 6, tag: '制造' },
  { re: /(光刻|lithography|EUV|High-NA|NA\s?0\.55|浸没|duv)/i, score: 6, tag: '光刻' },
  { re: /(2nm|3nm|1\.4nm|A16|N2|N3|18A|14A|SF2|process node|制程|工艺节点)/i, score: 6, tag: '工艺' },
  { re: /(先进封装|CoWoS|SoIC|HBM|chiplet|3D\s?stack|混合键合|hybrid bonding)/i, score: 6, tag: '封装' },
  { re: /(出口管制|entity list|实体清单|制裁|sanction|BIS|关税|tariff|限售)/i, score: 6, tag: '政策' },
  { re: /(收购|并购|acquisition|merger|反垄断|antitrust|IPO|上市)/i, score: 5, tag: '资本' },

  // 二档：公司与产品
  { re: /(TSMC|台积电|Samsung Foundry|三星|Intel Foundry|中芯国际|SMIC|华虹|GlobalFoundries|格芯|Rapidus)/i, score: 4, tag: '代工' },
  { re: /(ASML|Applied Materials|应用材料|Lam Research|泛林|Tokyo Electron|TEL|KLA|科磊|中微|北方华创)/i, score: 4, tag: '设备' },
  { re: /(NVIDIA|英伟达|AMD|Intel|英特尔|Qualcomm|高通|Apple|苹果|联发科|MediaTek|华为|HiSilicon|海思)/i, score: 3, tag: '设计' },
  { re: /(SK\s?Hynix|海力士|Micron|美光|长江存储|YMTC|长鑫|CXMT|DRAM|NAND|3D\s?NAND)/i, score: 4, tag: '存储' },
  { re: /(Synopsys|新思|Cadence|楷登|Siemens EDA|西门子|EDA|IP\s?core)/i, score: 4, tag: 'EDA' },
  { re: /(RISC-V|ARM|x86|chiplet|GPU|NPU|TPU|AI\s?accelerator|加速卡)/i, score: 3, tag: '架构' },
  { re: /(GaN|SiC|碳化硅|氮化镓|功率器件|功率半导体|IGBT|化合物半导体)/i, score: 4, tag: '功率' },
  { re: /(光刻胶|photoresist|大硅片|wafer|衬底|substrate|ABF|载板|电子特气|CMP|靶材)/i, score: 3, tag: '材料' },

  // 三档：趋势与市场
  { re: /(财报|earnings|revenue|营收|毛利|guidance|指引|展望)/i, score: 3, tag: '业绩' },
  { re: /(扩产|扩厂|新建|fab|晶圆厂|投资|investment|capex|资本开支)/i, score: 3, tag: '产能' },
  { re: /(涨价|降价|缺货|库存|inventory|供需|价格)/i, score: 2, tag: '行情' },
  { re: /(人工智能|AI\s?chip|AI\s?芯片|大模型|算力|datacenter|数据中心)/i, score: 2, tag: 'AI' },
  { re: /(研究|论文|paper|突破|breakthrough|Nature|Science|IEDM|ISSCC)/i, score: 3, tag: '研究' },
];

/** 明显不相关的噪音（消费电子评测、股价喊单、纯招聘等） */
const NOISE = [
  /(招聘|急招|校招|面试题|内推|简历)/,
  /(显卡开箱|上手体验|跑分实测|散热改造|装机)/,
  /(涨停|跌停|资金流向|游资|抄底|加仓|喊单|荐股)/,
  /(福利|抽奖|优惠券|限时折扣|领券)/,
];

/** 计算相关性得分 */
export function scoreItem(item) {
  const hay = `${item.title} ${item.summary}`;
  let score = item.weight ?? 5;
  const tags = new Set();
  const hits = [];

  for (const k of KW) {
    if (k.re.test(hay)) {
      score += k.score;
      tags.add(k.tag);
      hits.push(k.tag);
    }
  }

  // 标题命中比正文命中重要
  for (const k of KW) {
    if (k.re.test(item.title)) score += Math.ceil(k.score / 2);
  }

  // 噪音惩罚
  for (const n of NOISE) {
    if (n.test(hay)) score -= 8;
  }

  // 时效性：越新越靠前
  const age = hoursAgo(item.published);
  if (age <= 6) score += 5;
  else if (age <= 12) score += 3;
  else if (age <= 24) score += 2;
  else if (age <= WINDOW_HOURS) score += 1;
  else score -= 6;

  // 中文源略加权（目标读者中文）
  if (item.source?.lang === 'zh') score += 1.5;

  // 摘要过短说明正文抓不到，降权
  if ((item.summary || '').length < 60) score -= 2;

  return { score, tags: [...tags], hits };
}

/**
 * 过滤 + 排序 + 取 TopN
 * 同时做「同类事件合并」：同一主题超过 3 条时只保留分最高的 3 条
 */
export function curate(items) {
  log.step('过滤、打分与精选');

  const now = Date.now();
  const kept = [];
  let droppedStale = 0;
  let droppedNoise = 0;

  for (const it of items) {
    const age = hoursAgo(it.published, now);
    // 没有日期的条目保留（很多源缺 pubDate），但降权
    if (age > WINDOW_HOURS) {
      droppedStale++;
      continue;
    }
    const { score, tags } = scoreItem(it);
    if (score < 3) {
      droppedNoise++;
      continue;
    }
    kept.push({ ...it, score, tags });
  }

  log.info(`时间窗内 ${kept.length} 条；剔除过期 ${droppedStale}，低分 ${droppedNoise}`);

  kept.sort((a, b) => b.score - a.score);

  // 主题去重：按主标签限制条数，避免整期都是同一条新闻
  const perTag = new Map();
  const diversified = [];
  for (const it of kept) {
    const primary = it.tags[0] || '其他';
    const n = perTag.get(primary) || 0;
    if (n >= 4) continue;
    perTag.set(primary, n + 1);
    diversified.push(it);
  }

  const selected = diversified.slice(0, EDITION_LIMIT);
  log.ok(`精选 ${selected.length} 条`);

  return selected;
}
