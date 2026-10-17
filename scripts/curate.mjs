/**
 * 阶段 ②③：过滤 + 打分 + 精选
 * 纯规则，不调用 LLM —— 保证即使没有 API key 也有稳定产出。
 *
 * 打分思路：
 *   · IC 相关词命中 → 加分（软性加权，不做硬性门槛）
 *   · 明确无关的消费电子/汽车/家电 → 直接丢弃
 *   · 严格时间窗（默认 24h），越新加分越多
 */
import { WINDOW_HOURS, EDITION_LIMIT, ALLOW_UNDATED } from './config.mjs';
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
  { re: /(TSMC|台积电|Samsung Foundry|三星|Intel Foundry|中芯国际|SMIC|华虹|GlobalFoundries|格芯|Rapidus|联电|UMC)/i, score: 4, tag: '代工' },
  { re: /(ASML|Applied Materials|应用材料|Lam Research|泛林|Tokyo Electron|TEL|KLA|科磊|中微|北方华创|盛美|拓荆)/i, score: 4, tag: '设备' },
  { re: /(NVIDIA|英伟达|AMD|Intel|英特尔|Qualcomm|高通|Apple|苹果|联发科|MediaTek|华为|HiSilicon|海思|寒武纪|地平线|壁仞|摩尔线程)/i, score: 3, tag: '设计' },
  { re: /(SK\s?Hynix|海力士|Micron|美光|长江存储|YMTC|长鑫|CXMT|DRAM|NAND|3D\s?NAND|铠侠|Kioxia)/i, score: 4, tag: '存储' },
  { re: /(Synopsys|新思|Cadence|楷登|Siemens EDA|西门子|EDA|IP\s?core)/i, score: 4, tag: 'EDA' },
  { re: /(RISC-V|ARM|x86|chiplet|GPU|NPU|TPU|ASIC|FPGA|SoC|MCU|AI\s?accelerator|加速卡)/i, score: 3, tag: '架构' },
  { re: /(GaN|SiC|碳化硅|氮化镓|功率器件|功率半导体|IGBT|化合物半导体)/i, score: 4, tag: '功率' },
  { re: /(光刻胶|photoresist|大硅片|wafer|衬底|substrate|ABF|载板|电子特气|CMP|靶材|信越|SUMCO|沪硅)/i, score: 3, tag: '材料' },
  { re: /(日月光|Amkor|安靠|长电|通富|华天|力成|封测)/i, score: 3, tag: '封测' },
  { re: /(京东方|BOE|TCL华星|维信诺|显示驱动|面板)/i, score: 2, tag: '显示' },

  // 三档：趋势与市场
  { re: /(财报|earnings|revenue|营收|毛利|guidance|指引|展望)/i, score: 3, tag: '业绩' },
  { re: /(扩产|扩厂|新建|fab|晶圆厂|投资|investment|capex|资本开支)/i, score: 3, tag: '产能' },
  { re: /(涨价|降价|缺货|库存|inventory|供需)/i, score: 2, tag: '行情' },
  { re: /(人工智能|AI\s?chip|AI\s?芯片|大模型|算力|datacenter|数据中心)/i, score: 2, tag: 'AI' },
  { re: /(研究|论文|paper|突破|breakthrough|Nature|Science|IEDM|ISSCC)/i, score: 3, tag: '研究' },
  { re: /(芯片|半导体|集成电路|foundry|代工|晶圆|封装)/i, score: 2, tag: 'IC' },
];

/**
 * 明确无关的内容 —— 命中即丢弃。
 * 只放"与 IC 产业完全无关"的强信号，避免误伤。
 */
const NOISE = [
  /(招聘|急招|校招|面试题|内推|发简历)/,
  /(显卡开箱|上手体验|跑分实测|散热改造|装机单|装机配置)/,
  /(涨停|跌停|资金流向|游资|抄底|加仓|喊单|荐股|龙虎榜)/,
  /(福利|抽奖|优惠券|限时折扣|领券|秒杀)/,
  // 消费电子整机（不含芯片内容的纯产品新闻）
  /(迷你主机|轻薄本|游戏本|一体机|充电宝|机械键盘|鼠标垫|蓝牙耳机|桌面音箱)/,
  /(智能手表|手环|手表升级|手表开启|手机评测|新机发布|折叠屏手机开售)/,
  // 汽车 / 家电
  /(车型|续航里程|车主|试驾|充电桩|混动|纯电SUV)/,
  /(冰箱|洗衣机|空调扇|扫地机器人|油烟机)/,
];

/**
 * 垂直 IC 媒体白名单 —— 这些源的条目天然与产业相关，
 * 不做相关性硬过滤，只做时效过滤。
 */
const VERTICAL_SOURCES = new Set([
  'Semiconductor Engineering',
  'Semiconductor Today',
  'Semiconductor Digest',
  'SemiAnalysis',
  'SemiWiki',
  'EE Times',
  'EE Times Asia',
  'EDN',
  'Embedded.com',
  'Bits&Chips',
  'DIGITIMES',
  'IEEE Spectrum Semiconductors',
  'NVIDIA Newsroom',
  '芯东西',
  'arXiv cs.AR',
  'arXiv eess.SP',
]);

/**
 * 泛科技源 —— 内容混杂（游戏/家电/手机/汽车都可能出现），
 * 必须命中足够强的 IC 信号才收录。
 */
const hasStrongIC = (text) =>
  /(芯片|半导体|集成电路|晶圆|流片|制程|光刻|封装|封测|EDA|foundry|代工|晶圆厂|fab\s|GPU|CPU|NPU|HBM|DRAM|NAND|EUV|碳化硅|功率半导体|晶体管|nm工艺|2nm|3nm|5nm|memory|processor|foundry)/i.test(
    text,
  );

/**
 * 非 IC 业务黑名单 —— 即使出现在垂直媒体上也要剔除。
 * DIGITIMES / IT之家 等会报道同公司的非半导体业务（汽车、储能、游戏）。
 */
const OFF_TOPIC = [
  // 能源 / 电力（非芯片业务）
  /(储能|钠离子|变压器|光伏|风电|充电站|energy storage|sodium-ion|transformer|solar|wind power)/i,
  // 游戏 / 娱乐内容
  /(游戏|发售|Steam|DLC|扩展包|主机独占|皮肤|game|gaming|expansion pack|launch title)/i,
  // 消费电子整机（非芯片）
  /(开售|首发.*元|促销|微波炉|机箱|散热风扇|显示器发售|电竞屏|键盘|鼠标垫|soundbar|mechanical keyboard|PC case)/i,
  // 汽车 / 出行
  /(特斯拉|小鹏|蔚来|理想|比亚迪|车型|造车|试驾|EV |electric vehicle|roadster|sedan|SUV|autonomous driving platform)/i,
  // 手机 / 穿戴（非芯片业务）
  /(手机.*发布|一加|荣耀.*系列|笔记本.*开售|YOGA|表带|头带|AirTag|smartphone launch|wearable band|smartwatch)/i,
  // 电子纸 / 显示面板（边缘品类）
  /(电子纸|E ?Ink|Kaleido|彩色墨水屏|e-paper)/i,
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

  // 噪音惩罚（严重偏离主题）
  for (const n of NOISE) {
    if (n.test(hay)) score -= 12;
  }

  // 时效性：严格 24h 窗口下，越新越靠前
  const age = hoursAgo(item.published);
  if (age <= 3) score += 8;
  else if (age <= 6) score += 6;
  else if (age <= 12) score += 4;
  else if (age <= 18) score += 2;
  else if (age <= 24) score += 1;
  else score -= 10;

  // 中文源略加权（目标读者中文）
  if (item.source?.lang === 'zh') score += 1.5;

  // 摘要过短说明正文抓不到，降权
  if ((item.summary || '').length < 60) score -= 2;

  return { score, tags: [...tags], hits };
}

/** 是否为明确无关内容 */
function isNoise(text) {
  return NOISE.some((n) => n.test(text));
}

/**
 * 过滤 + 排序 + 取 TopN
 * 严格时效：超过 WINDOW_HOURS 一律丢弃；无日期默认丢弃。
 */
export function curate(items) {
  log.step('过滤、打分与精选');

  const now = Date.now();
  const kept = [];
  let droppedStale = 0;
  let droppedUndated = 0;
  let droppedNoise = 0;
  let droppedLow = 0;

  for (const it of items) {
    // 无日期：默认丢弃（时效性是核心）
    if (!it.published) {
      if (!ALLOW_UNDATED) {
        droppedUndated++;
        continue;
      }
    } else if (hoursAgo(it.published, now) > WINDOW_HOURS) {
      droppedStale++;
      continue;
    }

    const hay = `${it.title} ${it.summary}`;
    const isVertical = VERTICAL_SOURCES.has(it.source?.name);

    // 非 IC 业务黑名单：所有源都适用（垂直媒体也会报道相关公司的非芯片业务）
    if (OFF_TOPIC.some((re) => re.test(hay))) {
      droppedNoise++;
      continue;
    }

    // 明确无关噪音（垂直源免检，避免误伤论文标题）
    if (!isVertical && isNoise(hay)) {
      droppedNoise++;
      continue;
    }

    const { score, tags } = scoreItem(it);

    // 泛科技源：必须命中强 IC 信号，且达到分数门槛
    if (!isVertical) {
      if (!hasStrongIC(hay) || score < 10) {
        droppedLow++;
        continue;
      }
    } else if (score < 4) {
      // 垂直源只做极低门槛兜底
      droppedLow++;
      continue;
    }

    kept.push({ ...it, score, tags });
  }

  log.info(
    `时间窗 ${WINDOW_HOURS}h 内有效 ${kept.length} 条 | 丢弃：过期 ${droppedStale}、` +
      `无日期 ${droppedUndated}、无关 ${droppedNoise}、低分 ${droppedLow}`,
  );

  // 时效优先：先按时间倒序，再按分数微调
  kept.sort((a, b) => {
    const ta = a.published ? new Date(a.published).getTime() : 0;
    const tb = b.published ? new Date(b.published).getTime() : 0;
    // 分数占主导，时间作次级排序（避免旧但高分的条目压住新条目）
    if (Math.abs(b.score - a.score) > 6) return b.score - a.score;
    return tb - ta;
  });

  // 主题分散：同一主标签最多 4 条
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
