// =====================================================================
// 当前项目的干员效率 JSON 生成器。
// 输入仅来自 public/assets/gamedata/latest/excel 下的 Torappu 三份快照，
// 输出为 packages/riic-efficiency/data/operators/{干员ID}.json 和 terms.json。
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OPERATOR_SKILL_OVERRIDES,
  overrideKey,
} from "./operator-skill-overrides.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const EXCEL_DIR = path.join(
  ROOT,
  "public",
  "assets",
  "gamedata",
  "latest",
  "excel",
);
const CHARACTER_TABLE_PATH = path.join(EXCEL_DIR, "character_table.json");
const BUILDING_DATA_PATH = path.join(EXCEL_DIR, "building_data.json");
const GAMEDATA_CONST_PATH = path.join(EXCEL_DIR, "gamedata_const.json");
const MOOD_CHECK_PATH = path.join(ROOT, "public", "skill-mood-check.json");
const PACKAGE_DATA_DIR = path.join(ROOT, "packages", "riic-efficiency", "data");
const PACKAGE_OPERATOR_DIR = path.join(PACKAGE_DATA_DIR, "operators");
const SCHEMA_VERSION = 2;

// 当前模拟器的数据契约使用这些稳定的设施 key。
const ROOM_MAP = {
  控制中枢: "control",
  贸易站: "trading",
  制造站: "manufacture",
  发电站: "power",
  会客室: "meeting",
  加工站: "processing",
  人力办公室: "hire",
  办公室: "hire",
  训练室: "training",
  回收站: "recycle",
  宿舍: "dormitory",
};
const ROOM_TYPE_MAP = {
  CONTROL: "control",
  TRADING: "trading",
  MANUFACTURE: "manufacture",
  POWER: "power",
  MEETING: "meeting",
  HIRE: "hire",
  WORKSHOP: "processing",
  TRAINING: "training",
  RECYCLE: "recycle",
  DORMITORY: "dormitory",
};
const ROOM_LABELS = Object.fromEntries(
  Object.entries(ROOM_MAP).map(([label, key]) => [key, label]),
);
const CLUE_PREFERENCE_BY_FACTION = {
  莱茵生命: 1,
  企鹅物流: 2,
  黑钢国际: 3,
  乌萨斯学生自治团: 4,
  格拉斯哥帮: 5,
  喀兰贸易: 6,
  罗德岛制药: 7,
};
const OUTPUT_ROOMS = new Set([
  "control",
  "trading",
  "manufacture",
  "power",
  "meeting",
  "hire",
  "recycle",
  "dormitory",
]);
const ROOM_ORDER = [
  "control",
  "trading",
  "manufacture",
  "power",
  "meeting",
  "hire",
  "processing",
  "training",
  "recycle",
  "dormitory",
];

// ===== 富文本清理：当前 Torappu 使用 <$term><@style>名称</></> 标记。 =====
// 术语标记转换为可读名称，同时记录名称到术语 key 的映射，供条件解析引用。
function cleanDesc(desc) {
  const groups = {};
  let text = String(desc || "").replace(/<<(?=[$@])/g, "<");
  text = text.replace(/<@[^>]+>/g, "");
  text = text.replace(/<\$([^>]+)>([\s\S]*?)<\/>/g, (all, key, inner) => {
    const label = inner
      .replace(/<@[^>]+>/g, "")
      .replace(/<\/>/g, "")
      .trim();
    groups[label] = key.trim();
    return label;
  });
  text = text.replace(/<\/>/g, "");
  return { text, groups };
}

function rarityValue(value) {
  const match = String(value ?? "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function listedTermMembers(description, characterTable) {
  const lines = String(description ?? "").split(/\r?\n/);
  const heading = lines[0]?.trim();
  if (heading === "包含所有异格干员") {
    return Object.entries(characterTable)
      .filter(
        ([id, character]) =>
          id.startsWith("char_") && character?.name && character.isSpChar,
      )
      .map(([, character]) => character.name);
  }
  if (!heading?.startsWith("包含以下") && !heading?.startsWith("由以下")) {
    return [];
  }
  return lines
    .slice(1)
    .join("")
    .split(/[、,，]/)
    .map((member) => member.trim())
    .filter(Boolean);
}

function sharedTerms(termDescriptions, characterTable) {
  const terms = Object.fromEntries(
    Object.entries(termDescriptions).map(([key, term]) => {
      const members = listedTermMembers(term?.description, characterTable);
      return [
        key,
        {
          name: term?.termName ?? key,
          ...(term?.description ? { definition: term.description } : {}),
          ...(members.length ? { members } : {}),
        },
      ];
    }),
  );
  Object.entries(TERM_ALIASES).forEach(([name, key]) => {
    if (terms[key]) return;
    const members = Object.values(characterTable)
      .filter((character) => character?.name && character.branch === name)
      .map((character) => character.name);
    terms[key] = { name, ...(members.length ? { members } : {}) };
  });
  return terms;
}

function ruleset() {
  return {
    schemaVersion: SCHEMA_VERSION,
    version: "arknights-riic-2026-09",
    defaultDurationMinutes: 720,
    powerOutputPerHour: 10,
    clueBaseTimeHours: 20,
    clueOutputPerHour: 0.05,
    clueLimit: 11,
    creditPerClue: 40,
    hireOutputPerHour: 1 / 12,
    hireLimit: 3,
    droneLimit: 250,
    baseEfficiency: {
      trading: 100,
      manufacture: 100,
      power: 100,
      meeting: 107,
      hire: 100,
    },
    meetingEfficiencyByLevel: { 1: 107, 2: 109, 3: 111 },
    manufactureStorageByLevel: { 1: 24, 2: 36, 3: 54 },
    tradeOrderLimitByLevel: { 1: 6, 2: 8, 3: 10 },
    manufactureRules: {
      中级作战记录: {
        product: "中级作战记录",
        recipe: "作战记录",
        amount: 1,
        hours: 3,
        volume: 5,
      },
      赤金: {
        product: "赤金",
        recipe: "贵金属",
        amount: 1,
        hours: 1.2,
        volume: 2,
      },
      "源石碎片:固源岩": {
        product: "源石碎片",
        recipe: "源石碎片",
        amount: 1,
        hours: 1,
        volume: 3,
        materials: { 固源岩: 2, 龙门币: 1600 },
      },
      "源石碎片:装置": {
        product: "源石碎片",
        recipe: "源石碎片",
        amount: 1,
        hours: 1,
        volume: 3,
        materials: { 装置: 1, 龙门币: 1000 },
      },
    },
    tradeOrdersByLevel: {
      1: [
        {
          name: "2贵金属订单",
          product: "龙门币",
          amount: 2,
          gold: 1000,
          hours: 2.4,
          probability: 1,
        },
      ],
      2: [
        {
          name: "2贵金属订单",
          product: "龙门币",
          amount: 2,
          gold: 1000,
          hours: 2.4,
          probability: 0.6,
        },
        {
          name: "3贵金属订单",
          product: "龙门币",
          amount: 3,
          gold: 1500,
          hours: 3.5,
          probability: 0.4,
        },
      ],
      3: [
        {
          name: "2贵金属订单",
          product: "龙门币",
          amount: 2,
          gold: 1000,
          hours: 2.4,
          probability: 0.3,
        },
        {
          name: "3贵金属订单",
          product: "龙门币",
          amount: 3,
          gold: 1500,
          hours: 3.5,
          probability: 0.5,
        },
        {
          name: "4贵金属订单",
          product: "龙门币",
          amount: 4,
          gold: 2000,
          hours: 4.6,
          probability: 0.2,
        },
      ],
    },
    orundumTradeOrder: {
      productAmount: 20,
      materialAmount: 2,
      hours: 2,
    },
    tailorProbabilities: {
      "1α": [0.15, 0.3, 0.55],
      "2α": [0.13, 0.22, 0.65],
      "1α1β": [0.05, 0.1, 0.85],
    },
    cluePreferenceByFaction: {
      莱茵生命: 1,
      企鹅物流: 2,
      黑钢国际: 3,
      乌萨斯学生自治团: 4,
      格拉斯哥帮: 5,
      喀兰贸易: 6,
      罗德岛制药: 7,
    },
    resourceKeyAliases: {
      LMD: "龙门币",
      Orundum: "合成玉",
      "Pure Gold": "赤金",
      "Battle Record": "中级作战记录",
      "Originium Shard": "源石碎片",
    },
    maxEliteLevelByRarity: { 1: 0, 2: 0, 3: 1, 4: 2, 5: 2, 6: 2 },
  };
}

// 标签文字 → 术语 key（在 gamedata_const.termDescriptionDict 中）；找不到时警告并返回 null
function groupKey(label, groups, warn) {
  if (groups[label]) return groups[label];
  if (groups[label + "干员"]) return groups[label + "干员"]; // 标签文字可能带"干员"后缀（如"黑钢国际干员"）
  // 标签文字带"技能/类技能"后缀而术语标签只到类别名（如"莱茵科技类技能" vs 术语"莱茵科技类"）
  const stripped = String(label || "")
    .replace(/类技能$/, "类")
    .replace(/技能$/, "");
  if (stripped !== label && groups[stripped]) return groups[stripped];
  // 无 [T=…] 标记：按术语名反查（含去"干员"后缀，如"格拉斯哥帮干员" → 术语"格拉斯哥帮"）
  const k = termKeyOf(label, groups, warn);
  if (k) return k;
  if (warn)
    warn(
      "未找到标签「" +
        label +
        "」对应的术语 key（描述中可能没有 <$term> 标记）",
    );
  return null;
}

function clueChanceEffect(target, text) {
  if (text.includes("线索板上尚未拥有的线索")) {
    return {
      target,
      stat: "clueChance",
      text: "更容易获得尚未拥有的线索",
      cluePreference: "unowned",
    };
  }
  if (text.includes("线索板上已经拥有的线索")) {
    return {
      target,
      stat: "clueChance",
      text: "更容易获得已经拥有的线索",
      cluePreference: "owned",
    };
  }
  const faction = Object.keys(CLUE_PREFERENCE_BY_FACTION).find((name) =>
    text.includes(name),
  );
  if (faction) {
    return {
      target,
      stat: "clueChance",
      text: `更容易获得线索${CLUE_PREFERENCE_BY_FACTION[faction]}`,
      cluePreference: CLUE_PREFERENCE_BY_FACTION[faction],
    };
  }
  return { target, stat: "clueChance", text };
}

// 术语「名称 → key」索引（main() 里加载 gamedata_const 构建，供无标记文字反查）
let TERM_BY_NAME = null;
const TERM_ALIASES = {
  行医: "cc.c.clinician",
};
function termKeyOf(label, groups, warn) {
  if (!label) return null;
  if (groups[label]) return groups[label];
  if (TERM_BY_NAME) {
    // 先试原名，再去"干员"后缀试（如"格拉斯哥帮干员" → "格拉斯哥帮"）；各试加 技能/类技能 后缀
    const cands = [String(label)];
    if (cands[0].endsWith("干员")) cands.push(cands[0].replace(/干员$/, ""));
    for (const base of cands) {
      for (const suffix of ["", "技能", "类技能"]) {
        const k = TERM_BY_NAME.get(base + suffix);
        if (k) return k;
      }
    }
  }
  if (TERM_ALIASES[label]) return TERM_ALIASES[label];
  if (warn) warn("未找到标签「" + label + "」对应的术语 key");
  return null;
}

// 解析解锁条件："精英0/精英1/精英2" → {type:'elite',value:n}；"30级" → {type:'level',value:30}
function parseUnlock(cond) {
  if (cond && typeof cond === "object") {
    const phase = Number(String(cond.phase || "").match(/\d+/)?.[0] ?? 0);
    const level = Number(cond.level ?? 1);
    return level === 1
      ? { type: "elite", value: phase }
      : { type: "level", value: level };
  }
  const s = String(cond || "");
  let m = s.match(/精英([012])/);
  if (m) return { type: "elite", value: Number(m[1]) };
  m = s.match(/(\d+)级/);
  if (m) return { type: "level", value: Number(m[1]) };
  return null; // 未知解锁条件（警告由调用方处理）
}

// ===== 数值效果解析 =====
// 按模式逐一匹配，**可命中多个效果**（如缪尔赛思 = 固定+线性；各模式正则互斥，
// 不会误匹配到其它模式文本），所有匹配完成后返回；condition 为布尔条件（无则 null）
function parseValueEffects(text, target, groups, cond, warn) {
  const effects = [];
  const push = (eff) => {
    if (cond) eff.condition = cond;
    effects.push(eff);
  };
  let m;

  // 0) 线索概率类（clueChance，会客室）："更容易获得XX线索"等，只展示不参与效率计算；
  //    提取完整文本到 text 字段后从文本中移除，避免误报与误匹配
  const clueRe =
    /更容易获得[^，。]*线索|必定获得[^，。]*线索|每当新搜集到的线索[^。]*?出现概率[^。]*|提升会客室内另一干员[^。]*线索倾向效果[^。]*/;
  while ((m = text.match(clueRe))) {
    push(clueChanceEffect(target, m[0]));
    text = text.replace(clueRe, "");
  }

  // 1) 时间曲线（伊内丝 聚影）：线索搜集速度提升X%，此后每小时提升Y%，最终达到Z%
  //    （空构 技术交流：首小时X%，此后每小时Y%，最终达到Z%）
  //    命中曲线后跳过同类的固定数值匹配（防重复计数）
  let isCurve = false;
  if (
    (m = text.match(
      /线索搜集速度提升([+-]?\d+)%，此后每小时提升([+-]?\d+)%，最终达到([+-]?\d+)%/,
    ))
  ) {
    push({
      target: target,
      stat: "clueSpeed",
      curve: {
        type: "ramp",
        startValue: Number(m[1]),
        startHours: 1,
        step: Number(m[2]),
        cap: Number(m[3]),
      },
    });
    isCurve = true;
  } else if (
    (m = text.match(
      /首小时([+-]?\d+)%，此后每小时([+-]?\d+)%，最终达到([+-]?\d+)%/,
    ))
  ) {
    push({
      target: target,
      stat: "droneCharge",
      curve: {
        type: "ramp",
        startValue: Number(m[1]),
        startHours: 1,
        step: Number(m[2]),
        cap: Number(m[3]),
      },
    });
    isCurve = true;
  }
  // 1.5) 线性：基地点数 每N点XX额外提升+X%（赤刃明霄陈 扶危行侠 / 双月 情报专家）；
  //      每拥有N点XX，线索搜集速度额外提升+X%（莱欧斯 饱餐的干劲）。
  //      须在固定数值（模式 2）之前匹配并从文本移除（其"线索搜集速度额外提升X%"子串会被固定误配）
  if ((m = text.match(/每拥有(\d+)点(.+?)，线索搜集速度额外提升([+-]?\d+)%/))) {
    push({
      target: target,
      stat: "clueSpeed",
      per: {
        per: Number(m[1]),
        value: Number(m[3]),
        source: "basePoint",
        term: groupKey(m[2], groups, warn),
      },
    });
    text = text.replace(
      /每拥有(\d+)点(.+?)，线索搜集速度额外提升([+-]?\d+)%/,
      "",
    );
  }
  if ((m = text.match(/每(\d+)点(.+?)额外提升([+-]?\d+)%/))) {
    push({
      target: target,
      stat: "clueSpeed",
      per: {
        per: Number(m[1]),
        value: Number(m[3]),
        source: "basePoint",
        term: groupKey(m[2], groups, warn),
      },
    });
    text = text.replace(/每(\d+)点(.+?)额外提升([+-]?\d+)%/, "");
  }
  // 2) 固定数值：线索搜集速度(额外)提升+X%（会客室）
  if (
    !isCurve &&
    (m = text.match(/线索搜集速度(?:额外)?提升([+-]?\d+(?:\.\d+)?)%/))
  ) {
    push({ target: target, stat: "clueSpeed", value: Number(m[1]) });
  }
  // 3) 固定数值：无人机（每小时/额外）充能速度+X%（发电站）
  if (
    (m = text.match(/无人机(?:每小时)?充能速度(?:额外)?([+-]?\d+(?:\.\d+)?)%/))
  ) {
    push({ target: target, stat: "droneCharge", value: Number(m[1]) });
  }
  // 4) 设施数量计数（晨曦）：发电站额外+1（仅影响设施数量）
  if ((m = text.match(/发电站额外([+-]?\d+)/))) {
    push({ target: "power", stat: "facilityCount", value: Number(m[1]) });
  }
  // 5) 跨设施效果（正义骑士号）：野鬃所在的制造站生产力+5%
  if ((m = text.match(/(.+?)所在的制造站生产力([+-]?\d+)%/))) {
    effects.push({
      target: "manufacture",
      stat: "manuProd",
      value: Number(m[2]),
      condition: {
        type: "opInFacilityAndTarget",
        op: m[1],
        facility: "manufacture",
      },
    });
  }
  // 6) 线性：每间宿舍每级额外+X%（菲莱 灵河共鸣）
  if ((m = text.match(/每间宿舍每级为充能速度额外([+-]?\d+(?:\.\d+)?)%/))) {
    push({
      target: target,
      stat: "droneCharge",
      per: { per: 1, value: Number(m[1]), source: "dormLevel" },
    });
  }
  // 7) 线性：每N架无人机上限+X%（最多+Y%）（承曦格雷伊 巡线框架）；capUnit=value：cap 是数值上限
  if (
    (m = text.match(
      /每(\d+)架无人机上限([+-]?\d+)%无人机充能速度（最多([+-]?\d+)%）/,
    ))
  ) {
    push({
      target: target,
      stat: "droneCharge",
      per: {
        per: Number(m[1]),
        value: Number(m[2]),
        cap: Number(m[3]),
        capUnit: "value",
        source: "droneLimit",
      },
    });
  }
  // 8) 线性：基建内每有N名除自身以外的[阵营]干员（最多M名），充能速度额外+X%（缪尔赛思 生态科主任）
  if (
    (m = text.match(
      /每有(\d+)名除自身以外的(.+?)干员（最多(\d+)名），充能速度额外([+-]?\d+)%/,
    ))
  ) {
    push({
      target: target,
      stat: "droneCharge",
      per: {
        per: Number(m[1]),
        value: Number(m[4]),
        cap: Number(m[3]),
        source: "opGroupInBase",
        group: groupKey(m[2], groups, warn),
        other: true,
      },
    });
  }
  // 9) 线性：每个招募位（不包含初始招募位）+X%线索搜集速度（骋风 广交义友）
  if (
    (m = text.match(
      /每个招募位（不包含初始招募位）提升([+-]?\d+)%线索搜集速度/,
    ))
  ) {
    push({
      target: target,
      stat: "clueSpeed",
      per: { per: 1, value: Number(m[1]), source: "recruitSlots" },
    });
  }
  // 含数字却仍未识别才算异常（"进驻发电站时，"这类纯前缀不警告）
  if (!effects.length && /\d/.test(text)) warn("未识别的效果文本：" + text);
  return effects;
}

// ===== 办公室效果解析（target 基值为 'hire' 或跨设施/全局） =====
// 办公室主效率 stat 为 hireSpd（人脉资源联络速度 %）；并新增：
//   basePointGain（基地点数产出，+term）、basePointConvert（基地点数转化，from/to/rate）、
//   per.source=baseFacilityWithGroup（进驻某阵营干员的设施间数）。
// 各线性模式含"人脉资源的联络速度"子串，须在这一层先按优先级匹配并从文本移除，
// 否则会被末尾的固定匹配（人脉资源+X%）误配。返回 effects 数组。
function parseOfficeEffects(text, target, groups, cond, warn) {
  const effects = [];
  const push = (eff) => {
    if (cond) eff.condition = cond;
    effects.push(eff);
  };
  let m;
  const del = (re, src) => src.replace(re, "");

  // 0) 线索概率（办公室：每产生1次联络次数，增加XX线索概率）→ clueChance（只展示，会客室线索倾向）
  if ((m = text.match(/每产生\s*1\s*次联络次数，增加(.+?)线索的概率/))) {
    push(
      clueChanceEffect(
        "meeting",
        "每产生1次联络次数，增加" +
          m[1] +
          "线索的概率（工作时长和招募位影响概率）",
      ),
    );
    text = del(/每产生\s*1\s*次联络次数，增加.+?线索的概率/, text);
  }

  // 1) 基建内（不含副手及活动室）每有一间进驻[阵营]的设施 → baseFacilityWithGroup（凯尔希·思衡托）
  //    "联络速度额外+X%（最多Y间）"；capUnit=count（最多Y间）。
  if (
    (m = text.match(
      /基建内（不包含副手及活动室）每有一间进驻(.+?)的设施，联络速度额外([+-]?\d+(?:\.\d+)?)%（最多([+-]?\d+)间）/,
    ))
  ) {
    push({
      target: "hire",
      stat: "hireSpd",
      per: {
        per: 1,
        value: Number(m[2]),
        cap: Number(m[3]),
        source: "baseFacilityWithGroup",
        group: groupKey(m[1], groups, warn),
      },
    });
    text = del(
      /基建内（不包含副手及活动室）每有一间进驻.+?的设施，联络速度额外[+-]?\d+(?:\.\d+)?%（最多[+-]?\d+间）/,
      text,
    );
  }

  // 2) 基地点数转化 basePointConvert（絮雨·追忆：每1点记忆碎片转化为1点感知信息）
  //    rate = 目标数/源数；from/to 取术语 key。
  while (
    (m = text.match(
      /每\s*([+-]?\d+)\s*点(.+?)转化为\s*([+-]?\d+)\s*点(.+?)(?:[，,。]|$)/,
    ))
  ) {
    push({
      target: "hire",
      stat: "basePointConvert",
      from: groupKey(m[2], groups, warn),
      to: groupKey(m[4], groups, warn),
      rate: Number(m[3]) / Number(m[1]),
    });
    text = text
      .replace(
        /每\s*[+-]?\d+\s*点.+?转化为\s*[+-]?\d+\s*点.+?(?:[，,。]|$)/,
        "",
      )
      .replace(/心情耗尽时清空.+$/, "");
  }

  // 3) 每间宿舍每级额外+X%人脉资源的联络速度（锡人·梅兰德侦探）→ per dormLevel hireSpd
  if (
    (m = text.match(/每间宿舍每级额外([+-]?\d+(?:\.\d+)?)%人脉资源的联络速度/))
  ) {
    push({
      target: "hire",
      stat: "hireSpd",
      per: { per: 1, value: Number(m[1]), source: "dormLevel" },
    });
    text = del(/每间宿舍每级额外[+-]?\d+(?:\.\d+)?%人脉资源的联络速度/, text);
  }

  // 4) 每个招募位（不包含初始招募位）额外+X%会客室线索搜集速度（乌啾/乌有/月禾/隐现）
  //    → target='meeting'，per recruitSlots clueSpeed（办公室技能，作用会客室线索）
  if (
    (m = text.match(
      /每个招募位（不包含初始招募位）额外([+-]?\d+(?:\.\d+)?)%会客室线索搜集速度/,
    ))
  ) {
    push({
      target: "meeting",
      stat: "clueSpeed",
      per: { per: 1, value: Number(m[1]), source: "recruitSlots" },
    });
    text = del(
      /每个招募位（不包含初始招募位）额外[+-]?\d+(?:\.\d+)?%会客室线索搜集速度/,
      text,
    );
  }

  // 5) 每个招募位（不包含初始招募位）+X点[基地点数]（桑葚·灾后普查 / 深律·心声图绘 / 絮雨·巡游）
  //    → basePointGain，per recruitSlots，term 指定基地点数
  if (
    (m = text.match(
      /每个招募位（不包含初始招募位）([+-]?\d+(?:\.\d+)?)点(.+?)(?:[，,。]|$|，)/,
    ))
  ) {
    push({
      target: "hire",
      stat: "basePointGain",
      term: groupKey(m[2], groups, warn),
      per: { per: 1, value: Number(m[1]), source: "recruitSlots" },
    });
    text = del(
      /每个招募位（不包含初始招募位）[+-]?\d+(?:\.\d+)?点.+?(?:[，,。]|$|，)/,
      text,
    );
  }

  // 6) 每个招募位（不包含初始招募位）+X%人脉资源的联络速度（林·用人唯才）→ per recruitSlots hireSpd
  if (
    (m = text.match(
      /每个招募位（不包含初始招募位）([+-]?\d+(?:\.\d+)?)%人脉资源的联络速度/,
    ))
  ) {
    push({
      target: "hire",
      stat: "hireSpd",
      per: { per: 1, value: Number(m[1]), source: "recruitSlots" },
    });
    text = del(
      /每个招募位（不包含初始招募位）[+-]?\d+(?:\.\d+)?%人脉资源的联络速度/,
      text,
    );
  }

  // 6.5) 每个招募位（不包含初始招募位）使心情每小时消耗±X（雪绒·保证体力）→ per recruitSlots moodCost
  if (
    (m = text.match(
      /每个招募位（不包含初始招募位）使心情每小时消耗([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    const eff = {
      target: "hire",
      stat: "moodCost",
      per: { per: 1, value: Number(m[1]), source: "recruitSlots" },
    };
    if (cond) eff.condition = cond;
    effects.push(eff);
    text = del(
      /每个招募位（不包含初始招募位）使心情每小时消耗[+-]?\d+(?:\.\d+)?/,
      text,
    );
  }

  // 6.6) 固定心情消耗（办公室：深律/圣聆初雪/行箸/林/桑葚/水灯心/斥罪/地灵 等 ±X）
  //      置于 per 版之后，避免"每个招募位使心情消耗"被固定值误配。
  if ((m = text.match(/心情每小时消耗([+-]?\d+(?:\.\d+)?)/))) {
    const eff = { target: "hire", stat: "moodCost", value: Number(m[1]) };
    if (cond) eff.condition = cond;
    effects.push(eff);
    text = text.replace(/心情每小时消耗[+-]?\d+(?:\.\d+)?/, "");
  }

  // 7) 每N[点/瓶/个][基地点数]额外+M%人脉资源联络速度（闪击·语言学）→ per basePoint hireSpd，term 指定基地点数
  while (
    (m = text.match(
      /每([+-]?\d+)[点瓶个](.+?)额外([+-]?\d+(?:\.\d+)?)%联络速度/,
    ))
  ) {
    push({
      target: "hire",
      stat: "hireSpd",
      per: {
        per: Number(m[1]),
        value: Number(m[3]),
        source: "basePoint",
        term: groupKey(m[2], groups, warn),
      },
    });
    text = text.replace(
      /每[+-]?\d+[点瓶个].+?额外[+-]?\d+(?:\.\d+)?%联络速度/,
      "",
    );
  }

  // 8) 固定：人脉资源的联络速度（额外）+X%（办公室主效率）
  if ((m = text.match(/人脉资源的联络速度(?:额外)?([+-]?\d+(?:\.\d+)?)%/))) {
    push({ target: "hire", stat: "hireSpd", value: Number(m[1]) });
  }

  // 含数字却仍未识别才算异常（"进驻人力办公室时，"这类纯前缀不警告）
  if (!effects.length && /\d/.test(text))
    warn("未识别的办公室效果文本：" + text);
  return effects;
}

// ===== 宿舍效果解析（target 恒为 'dormitory'；仅记录 moodRecover 模块，不生成实际作用代码） =====
// 宿舍房间技能全部为"进驻宿舍时…"心情恢复类。本次仅**记录**（生成 JSON 数据 + 规范登记字段），
// 模拟器侧不实现宿舍恢复结算（宿舍干员不入工作队列；target='dormitory' 的效果不影响其它设施）。
// 记录字段口径（见 干员技能JSON规范.md §4.5/§4.7/§4.8）：
//   - scope:'self' 自身型 / scope:'room' 该宿舍内 / subjects:'single' 单体型（某个干员）/
//     subjects:'spread' 均摊型（平均分配）/"同种效果取最高" → stack:'max' + maxGroup
//     （dormRec-room / dormRec-single / dormRec-spread；跨宿舍效果使用 dormRec-overall）
//   - 固定 + 线性 → 单一效果 { baseValue, per }（"叠加后的最终值同种效果取最高"）
//   - "如果目标是XX则恢复效果额外+Y" → 独立 single 效果（术语 → scopeGroup；单干员 → op）
//   - 对象心情阈值（"心情N以下"）→ moodBelow；菲亚梅塔·自律 → blockOtherRecovery
//   - per.source：ownLevel（当前宿舍每级）/ recruitSlots / facilityCount(power) /
//     opGroupInBase（基建内每名XX，上限M名）/ dormNotFull（该宿舍每名心情未满干员）/
//     dormOccupantsOwn（该宿舍其他干员）——后两者本次仅登记字段，模拟器未实现
//   - basePoint 类（塑心/森西/车尔尼/爱丽丝：提供/转化）和宿舍特殊规则按规范记录；
//     无法表达的新增句式仍会在末尾警告。
function parseDormEffects(text, target, groups, cond, warn) {
  const effects = [];
  const push = (eff) => {
    if (cond) eff.condition = cond;
    effects.push(eff);
  };
  const del = (re, src) => src.replace(re, "");
  let m;
  const delMaxNote = (s) =>
    s
      .replace(/（[^）]*取最高[^）]*）/g, "")
      .replace(
        /且同种效果取最高|并且同种效果取最高|同种效果分别取最高|同种效果取最高/g,
        "",
      );
  // 合成"固定 + per"的宿舍内全员效果（"叠加后的最终值同种效果取最高"）
  let roomBase = null,
    roomPer = null,
    roomOther = false;
  const pushRoom = () => {
    if (roomPer) {
      const eff = {
        target: "dormitory",
        stat: "moodRecover",
        scope: "room",
        per: roomPer,
        stack: "max",
        maxGroup: "dormRec-room",
      };
      if (roomBase != null) eff.baseValue = roomBase; // 固定 + 线性合并为单一效果
      if (roomOther) eff.other = true;
      push(eff);
    } else if (roomBase != null) {
      const eff = {
        target: "dormitory",
        stat: "moodRecover",
        value: roomBase,
        scope: "room",
        stack: "max",
        maxGroup: "dormRec-room",
      };
      if (roomOther) eff.other = true;
      push(eff);
    }
  };

  // -1) 特殊规则：如果自身为满心情，则与当前宿舍前一位进驻的干员互换心情（菲亚梅塔·患难之交）
  //     → 新 stat 'moodSwap'：模拟器按排班表设置「菲亚梅塔绑定队列/固定回复」执行（见 计算规则 18）
  if (
    (m = text.match(/如果自身为满心情，则?与当前宿舍前一位进驻的干员互换心情/))
  ) {
    push({ target: "dormitory", stat: "moodSwap" });
    text = del(/如果自身为满心情，则?与当前宿舍前一位进驻的干员互换心情/, text);
  }
  // 0) 附段 A："如果目标是XX，则恢复效果额外+Y"（新约能天使/寒檀/黑/特米米/深靛/森西/罗德岛隐秘队）    //    目标是术语 → scopeGroup（原类别保留）；单干员（锡兰/蓝毒等无术语）→ op。先于主段提取。
  while (
    (m = text.match(/如果目标是(.+?)，则恢复效果额外([+-]?\d+(?:\.\d+)?)/))
  ) {
    const goals = String(m[1])
      .split(/和/)
      .map((s) => s.replace(/成员$/, "").trim())
      .filter(Boolean);
    goals.forEach((g) => {
      const eff = {
        target: "dormitory",
        stat: "moodRecover",
        value: Number(m[2]),
        scope: "room",
        subjects: "single",
        stack: "max",
        maxGroup: "dormRec-single",
      };
      const key = termKeyOf(g, groups, null);
      if (key) eff.scopeGroup = key;
      else eff.op = g.replace(/干员$/, "");
      push(eff);
    });
    text = del(/如果目标是.+?，则恢复效果额外[+-]?\d+(?:\.\d+)?/, text);
  }
  // 0.5) 附段 B："如果该宿舍内有其他干员，则每人额外为自身心情每小时恢复+X"（协律·赋格融汇 / 芳汀·"独处"）
  //      → per dormOccupantsOwn（施放者所在宿舍进驻数，other 排除自身）→ 作用自身
  if (
    (m = text.match(
      /如果该宿舍内有其他干员，则每人额外为自身心情每小时恢复([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    push({
      target: "dormitory",
      stat: "moodRecover",
      scope: "self",
      per: {
        per: 1,
        value: Number(m[1]),
        source: "dormOccupantsOwn",
        other: true,
      },
    });
    text = del(
      /如果该宿舍内有其他干员，则每人额外为自身心情每小时恢复[+-]?\d+(?:\.\d+)?/,
      text,
    );
  }

  // 1) 对象心情阈值型："该宿舍内心情N以下的干员恢复效果额外+X"（撷英调香师·净化呼吸 / 刺玫·芬芳疗养·β）
  if (
    (m = text.match(
      /该宿舍内心情([+-]?\d+)以下的干员恢复效果额外([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    push({
      target: "dormitory",
      stat: "moodRecover",
      value: Number(m[2]),
      scope: "room",
      moodBelow: Number(m[1]),
      stack: "max",
      maxGroup: "dormRec-mood-below",
    });
    text = del(
      /该宿舍内心情[+-]?\d+以下的干员恢复效果额外[+-]?\d+(?:\.\d+)?/,
      text,
    );
  }
  // 2) 自身型："自身心情每小时恢复±X"（含负值：安比尔/杜林·慵懒）
  //    菲亚梅塔·自律："无法获得其他来源提供的心情恢复效果" → blockOtherRecovery
  let blockOther = false;
  if ((m = text.match(/无法获得其他来源提供的心?情恢复效果/))) {
    blockOther = true;
    text = del(/无法获得其他来源提供的心?情恢复效果/, text);
  }
  if ((m = text.match(/自身心情每小时恢复([+-]?\d+(?:\.\d+)?)/))) {
    const eff = {
      target: "dormitory",
      stat: "moodRecover",
      value: Number(m[1]),
      scope: "self",
    };
    if (blockOther) eff.blockOtherRecovery = true;
    push(eff);
    text = del(/自身心情每小时恢复[+-]?\d+(?:\.\d+)?/, text);
  } else if (blockOther) {
    push({
      target: "dormitory",
      stat: "moodRecover",
      blockOtherRecovery: true,
    });
  }
  // 3) 单体型："该宿舍内(除自身以外)…某个干员每小时恢复+X"（同种效果取最高 → dormRec-single 组）
  if (
    (m = text.match(
      /该宿舍内(?:除自身以外)?(?:心情未满的)?某个干员每小时恢复([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    push({
      target: "dormitory",
      stat: "moodRecover",
      value: Number(m[1]),
      scope: "room",
      other: true,
      subjects: "single",
      stack: "max",
      maxGroup: "dormRec-single",
    });
    text = del(
      /该宿舍内(?:除自身以外)?(?:心情未满的)?某个干员每小时恢复[+-]?\d+(?:\.\d+)?/,
      text,
    );
  }
  // 4) 均摊型："使心情未满的宿舍成员，平均分配到总计每小时心情恢复+X"（冰酿·小酌怡情）
  if (
    (m = text.match(
      /心情未满的宿舍成员，平均分配到总计每小时心情恢复([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    push({
      target: "dormitory",
      stat: "moodRecover",
      value: Number(m[1]),
      scope: "room",
      subjects: "spread",
      stack: "max",
      maxGroup: "dormRec-spread",
    });
    text = del(
      /心情未满的宿舍成员，平均分配到总计每小时心情恢复[+-]?\d+(?:\.\d+)?/,
      text,
    );
  }
  // 5) 全员固定型："该宿舍内(除自身以外)?所有干员[的]?心情每小时恢复+X"（同种效果取最高 → dormRec-room 组）
  if (
    (m = text.match(
      /该宿舍内(除自身以外)?所有干员[的]?心情每小时恢复([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    roomBase = Number(m[2]);
    if (m[1]) roomOther = true;
    text = del(
      /该宿舍内(?:除自身以外)?所有干员[的]?心情每小时恢复[+-]?\d+(?:\.\d+)?/,
      text,
    );
  }
  // 6) per 型（线性，可与固定合成 baseValue；每模式命中后 del）
  if ((m = text.match(/当前宿舍每级为恢复效果额外([+-]?\d+(?:\.\d+)?)/))) {
    roomPer = { per: 1, value: Number(m[1]), source: "ownLevel" };
    text = del(/当前宿舍每级为恢复效果额外[+-]?\d+(?:\.\d+)?/, text);
  }
  if (
    (m = text.match(
      /每个招募位（不包含初始招募位）额外([+-]?\d+(?:\.\d+)?)恢复效果/,
    ))
  ) {
    roomPer = { per: 1, value: Number(m[1]), source: "recruitSlots" };
    text = del(
      /每个招募位（不包含初始招募位）额外[+-]?\d+(?:\.\d+)?恢复效果/,
      text,
    );
  }
  if ((m = text.match(/每有1间发电站，则恢复效果额外([+-]?\d+(?:\.\d+)?)/))) {
    roomPer = {
      per: 1,
      value: Number(m[1]),
      source: "facilityCount",
      facility: "power",
    };
    text = del(/每有1间发电站，则恢复效果额外[+-]?\d+(?:\.\d+)?/, text);
  }
  if (
    (m = text.match(
      /该宿舍每有1名心情未满的干员，则恢复效果额外([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    roomPer = { per: 1, value: Number(m[1]), source: "dormNotFull" };
    text = del(
      /该宿舍每有1名心情未满的干员，则恢复效果额外[+-]?\d+(?:\.\d+)?/,
      text,
    );
  }
  // 每有N点XX，该宿舍内所有干员的心情每小时恢复额外+Y（塑心·无词颂歌：每5点无声共鸣 +0.01）→ per basePoint
  if (
    (m = text.match(
      /每有([+-]?\d+)点(.+?)，该宿舍内所有干员的心情每小时恢复额外([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    roomPer = {
      per: Number(m[1]),
      value: Number(m[3]),
      source: "basePoint",
      term: termKeyOf(m[2], groups, warn),
    };
    text = del(
      /每有[+-]?\d+点.+?，该宿舍内所有干员的心情每小时恢复额外[+-]?\d+(?:\.\d+)?/,
      text,
    );
  }
  // 基建内（不包含副手及活动室使用者）每名XX干员为该宿舍内所有干员心情每小时恢复速度+Y（最多生效N名，且同种效果取最高）
  if (
    (m = text.match(
      /基建内（不包含副手及活动室使用者）每名(.+?)干员为该宿舍内所有干员心情每小时恢复速度\+?([+-]?\d+(?:\.\d+)?)（最多生效(\d+)名，且同种效果取最高）/,
    ))
  ) {
    roomPer = {
      per: 1,
      value: Number(m[2]),
      cap: Number(m[3]),
      source: "opGroupInBase",
      group: groupKey(m[1], groups, warn),
    };
    text = del(
      /基建内（不包含副手及活动室使用者）每名.+?干员为该宿舍内所有干员心情每小时恢复速度\+?[+-]?\d+(?:\.\d+)?（最多生效\d+名，且同种效果取最高）/,
      text,
    );
  }
  pushRoom();

  // 7) 宿舍基地点数（用户口径，见 干员技能JSON规范.md 计算规则 16）：提供（basePointGain）/ 转化（basePointConvert）
  //    7a) 塑心·无声共鸣："该宿舍内每有1名干员，无声共鸣+1" → per dormHere（该宿舍进驻数，dormFullTreat 口径）
  if ((m = text.match(/该宿舍内每有([+-]?\d+)名干员，?(.+?)([+-]?\d+)/))) {
    const tk = groupKey(m[2].replace(/([+-]?\d+)$/, "").trim(), groups, warn);
    if (tk)
      push({
        target: "dormitory",
        stat: "basePointGain",
        term: tk,
        per: { per: Number(m[1]), value: Number(m[3]), source: "dormHere" },
      });
    text = del(/该宿舍内每有[+-]?\d+名干员，?.+?[+-]?\d+/, text);
  }
  //    7b) 森西/爱丽丝/车尔尼槽1："当前宿舍每级提供N层/个 term" → per ownLevel（该宿舍等级）
  if ((m = text.match(/当前宿舍每级提供([+-]?\d+)[层个](.+?)(?:，|$)/))) {
    const tk = groupKey(m[2], groups, warn);
    if (tk)
      push({
        target: "dormitory",
        stat: "basePointGain",
        term: tk,
        per: { per: 1, value: Number(m[1]), source: "ownLevel" },
      });
    text = del(/当前宿舍每级提供[+-]?\d+[层个][^，。；;]+/, text);
  }
  //    7c) 爱丽丝·梦境呓语/车尔尼·琴键漫步："每N层 term 转化为 M 点 term2" → basePointConvert
  if (
    (m = text.match(/每([+-]?\d+)[层个](.+?)转化为([+-]?\d+)点(.+?)(?:，|$)/))
  ) {
    const from = groupKey(m[2], groups, warn),
      to = groupKey(m[4], groups, warn);
    if (from && to)
      push({
        target: "dormitory",
        stat: "basePointConvert",
        from,
        to,
        rate: Number(m[3]) / Number(m[1]),
      });
    text = del(/每[+-]?\d+[层个][^，。；;]+?转化为[+-]?\d+点[^，。；;]+/, text);
  }

  // 8) 未记录部分（特殊规则）：净化修饰语后仍有内容 → 警告（人工校对/后续批次）
  const residue = delMaxNote(text)
    .replace(/[，,。；;、\s]+/g, "")
    .replace(/^(使|同时|并且)+/, "")
    .replace(/的加成$/, "");
  if (residue) warn("宿舍效果未记录（仅记录心情恢复模块）：" + residue);
  return effects;
}

// ===== 制造站效果解析（target 基值为 'manufacture'） =====
// 制造站主效率 stat 为 manuProd（生产力 %）；新增：
//   recipe（配方分类：作战记录/贵金属/源石碎片）、storageCap（仓库容量上限，基础值按等级 24/36/54）、
//   zeroOpMood（消除技能心情效果）、per.source={skillTagCount, stat, opCount, facilityCount,
//       trainLevel, dormLevel, dormOccupants, facilityLevelTotal, basePoint, opGroupInBase, opGroupInFacility}、
//   condition={workHours, moodDrop}、curve（描述未写首小时 → 从 0% 开始）。
// 各模式命中后从文本移除（防误配），最后固定值兜底（生产力/仓库容量/心情消耗）。
function parseManuEffects(text, target, groups, cond, warn) {
  const effects = [];
  const push = (eff) => {
    if (cond) eff.condition = cond;
    effects.push(eff);
  };
  const del = (re, src) => src.replace(re, "");
  let m;
  // 配方标签 → recipe 取值（"贵金属类配方"→"贵金属"）
  const recipeValue = (label) =>
    String(label || "")
      .replace(/类配方$/, "")
      .replace(/类$/, "")
      .replace(/^源石(?:材料)?$/, "源石碎片");

  // -1) 配方限定的固定效果（须在固定心情/容量之前）：
  //     "生产XX类配方时，仓库容量上限+Y"（稀音·剪辑/圣约送葬人·合理利用）
  while ((m = text.match(/生产(.+?类配方)时，仓库容量(?:上限)?([+-]?\d+)/))) {
    push({
      target: "manufacture",
      stat: "storageCap",
      value: Number(m[2]),
      recipe: recipeValue(m[1]),
    });
    text = text.replace(/生产.+?类配方时，仓库容量(?:上限)?[+-]?\d+/, "");
  }
  //     "生产XX类配方时，心情每小时消耗±Y"（卡达·Vlog）
  while (
    (m = text.match(/生产(.+?类配方)时，心情每小时消耗([+-]?\d+(?:\.\d+)?)/))
  ) {
    push({
      target: "manufacture",
      stat: "moodCost",
      value: Number(m[2]),
      recipe: recipeValue(m[1]),
    });
    text = text.replace(
      /生产.+?类配方时，心情每小时消耗[+-]?\d+(?:\.\d+)?/,
      "",
    );
  }

  // 0) 心情消耗（固定）："当前制造站内所有干员心情每小时消耗-X" = scope room（黍）
  if (
    (m = text.match(/当前制造站内所有干员心情每小时消耗([+-]?\d+(?:\.\d+)?)/))
  ) {
    push({
      target: "manufacture",
      stat: "moodCost",
      value: Number(m[1]),
      scope: "room",
    });
    text = del(/当前制造站内所有干员心情每小时消耗[+-]?\d+(?:\.\d+)?/, text);
  }
  if ((m = text.match(/心情每小时消耗([+-]?\d+(?:\.\d+)?)/))) {
    push({ target: "manufacture", stat: "moodCost", value: Number(m[1]) });
    text = del(/心情每小时消耗[+-]?\d+(?:\.\d+)?/, text);
  }
  // 0.5) 消除心情消耗（槐琥·团队精神）→ zeroOpMood
  if (text.match(/消除当前制造站内所有干员自身心情消耗的影响/)) {
    push({ target: "manufacture", stat: "zeroOpMood", scope: "room" });
    text = del(/消除当前制造站内所有干员自身心情消耗的影响/, text);
  }

  // 1) 时间曲线（拥有"首小时"）；未写首小时 → 从 0% 开始（阿罗玛·例行清扫）
  if (
    (m = text.match(
      /首小时([+-]?\d+)%，此后每小时([+-]?\d+)%，最终达到([+-]?\d+)%/,
    ))
  ) {
    push({
      target: "manufacture",
      stat: "manuProd",
      curve: {
        type: "ramp",
        startValue: Number(m[1]),
        startHours: 1,
        step: Number(m[2]),
        cap: Number(m[3]),
      },
    });
    text = del(/首小时[+-]?\d+%，此后每小时[+-]?\d+%，最终达到[+-]?\d+%/, text);
  } else if ((m = text.match(/每小时([+-]?\d+)%，最终达到([+-]?\d+)%/))) {
    push({
      target: "manufacture",
      stat: "manuProd",
      curve: {
        type: "ramp",
        startValue: 0,
        startHours: 1,
        step: Number(m[1]),
        cap: Number(m[2]),
      },
    });
    text = del(/每小时[+-]?\d+%，最终达到[+-]?\d+%/, text);
  }

  // 2) 自身心情落差 per（铅踝·模糊视线）：自身每有N点心情落差，生产力-X%
  if (
    (m = text.match(
      /自身每有([+-]?\d+)点心情落差，生产力([+-]?\d+(?:\.\d+)?)%/,
    ))
  ) {
    push({
      target: "manufacture",
      stat: "manuProd",
      per: { per: Number(m[1]), value: Number(m[2]), source: "moodDrop" },
    });
    text = del(/自身每有[+-]?\d+点心情落差，生产力[+-]?\d+(?:\.\d+)?%/, text);
  }

  // 3) 基地点数转化 basePointConvert（截云·古老巫术：每5点人间烟火转化为1点巫术结晶；迷迭香·超感）
  while (
    (m = text.match(
      /每([+-]?\d+)[点个瓶](.+?)转化为([+-]?\d+)[点个瓶](.+?)(?:[，,。]|$)/,
    ))
  ) {
    push({
      target: "manufacture",
      stat: "basePointConvert",
      from: groupKey(m[2], groups, warn),
      to: groupKey(m[4], groups, warn),
      rate: Number(m[3]) / Number(m[1]),
    });
    text = text.replace(
      /每[+-]?\d+[点个瓶].+?转化为[+-]?\d+[点个瓶].+?(?:[，,。]|$)/,
      "",
    );
  }

  // 3.5) 宿舍干员数产出（迷迭香·超感）：宿舍内每有N名干员则X+N
  if ((m = text.match(/宿舍内每有([+-]?\d+)名干员则(.+?)([+-]?\d+)/))) {
    push({
      target: "manufacture",
      stat: "basePointGain",
      term: groupKey(m[2], groups, warn),
      per: { per: 1, value: Number(m[3]), source: "dormOccupants" },
    });
    text = del(/宿舍内每有[+-]?\d+名干员则.+?[+-]?\d+/, text);
  }

  // 3.6) 设施等级总和产出（至简·绘图设计）：基建内除活动室外每间设施每级+1个X，上限N个
  if (
    (m = text.match(
      /基建内除活动室外每间设施每级([+-]?\d+)个(.+?)，上限([+-]?\d+)个/,
    ))
  ) {
    push({
      target: "manufacture",
      stat: "basePointGain",
      term: groupKey(m[2], groups, warn),
      per: {
        per: 1,
        value: Number(m[1]),
        cap: Number(m[3]),
        source: "facilityLevelTotal",
      },
    });
    text = del(
      /基建内除活动室外每间设施每级[+-]?\d+个.+?，上限[+-]?\d+个/,
      text,
    );
  }

  // 4) 术语计数 per（basePoint）：每N点/个/瓶 X → +Y%生产力 或 仓库容量+Y
  //    玛露西尔（魔物料理）/黍（人间烟火）/截云（巫术结晶）/迷迭香（思维链环）/至简（工程机器人）
  while ((m = text.match(/每([+-]?\d+)点(.+?)([+-]?\d+(?:\.\d+)?)%生产力/))) {
    push({
      target: "manufacture",
      stat: "manuProd",
      per: {
        per: Number(m[1]),
        value: Number(m[3]),
        source: "basePoint",
        term: groupKey(m[2], groups, warn),
      },
    });
    text = text.replace(/每[+-]?\d+点.+?[+-]?\d+(?:\.\d+)?%生产力/, "");
  }
  while ((m = text.match(/每([+-]?\d+)个(.+?)([+-]?\d+(?:\.\d+)?)%生产力/))) {
    push({
      target: "manufacture",
      stat: "manuProd",
      per: {
        per: Number(m[1]),
        value: Number(m[3]),
        source: "basePoint",
        term: groupKey(m[2], groups, warn),
      },
    });
    text = text.replace(/每[+-]?\d+个.+?[+-]?\d+(?:\.\d+)?%生产力/, "");
  }
  while (
    (m = text.match(/每有([+-]?\d+)个(.+?)，则生产力([+-]?\d+(?:\.\d+)?)%/))
  ) {
    push({
      target: "manufacture",
      stat: "manuProd",
      per: {
        per: Number(m[1]),
        value: Number(m[3]),
        source: "basePoint",
        term: groupKey(m[2], groups, warn),
      },
    });
    text = text.replace(/每有[+-]?\d+个.+?，则生产力[+-]?\d+(?:\.\d+)?%/, "");
  }
  while (
    (m = text.match(/每有([+-]?\d+)瓶(.+?)，则仓库容量(?:上限)?([+-]?\d+)/))
  ) {
    push({
      target: "manufacture",
      stat: "storageCap",
      per: {
        per: Number(m[1]),
        value: Number(m[3]),
        source: "basePoint",
        term: groupKey(m[2], groups, warn),
      },
    });
    text = text.replace(/每有[+-]?\d+瓶.+?，则仓库容量(?:上限)?[+-]?\d+/, "");
  }

  // 5) 技能类别按技能数（skillTagCount）：当前制造站内每个XX为自身+Y%的生产力（多萝西/苍苔/水月）
  if (
    (m = text.match(
      /当前制造站内每个(.+?类技能)为自身([+-]?\d+(?:\.\d+)?)%的生产力/,
    ))
  ) {
    push({
      target: "manufacture",
      stat: "manuProd",
      per: {
        per: 1,
        value: Number(m[2]),
        source: "skillTagCount",
        tag: groupKey(m[1], groups, warn),
      },
    });
    text = del(
      /当前制造站内每个.+?类技能为自身[+-]?\d+(?:\.\d+)?%的生产力/,
      text,
    );
  }
  //     当前制造站内每个XX为自身+Y的仓库上限容量（溯光星源·勘探背包）
  if (
    (m = text.match(
      /当前制造站内每个(.+?类技能)为自身([+-]?\d+(?:\.\d+)?)的仓库上限容量/,
    ))
  ) {
    push({
      target: "manufacture",
      stat: "storageCap",
      per: {
        per: 1,
        value: Number(m[2]),
        source: "skillTagCount",
        tag: groupKey(m[1], groups, warn),
      },
    });
    text = del(
      /当前制造站内每个.+?类技能为自身[+-]?\d+(?:\.\d+)?的仓库上限容量/,
      text,
    );
  }

  // 5.5) 站内干员「提升的仓库容量」折算（红云·回收利用：每格 +X% 生产力，**含自身**）
  if (
    (m = text.match(
      /当前制造站内(.+?)提升的每格仓库容量，提供([+-]?\d+(?:\.\d+)?)%生产力/,
    ))
  ) {
    push({
      target: "manufacture",
      stat: "manuProd",
      per: {
        per: 1,
        value: Number(m[2]),
        source: "facCap",
        stat: "storageCap",
      },
    });
    text = del(
      /当前制造站内.+?提升的每格仓库容量，提供[+-]?\d+(?:\.\d+)?%生产力/,
      text,
    );
  }

  // 5.6) 干员按**自身**提升量分档折算（泡泡·大就是好：≤N 格每格 X%、>N 格每格 Y%；
  //      互斥注释「（无法与XX叠加，且优先生效）」→ suppresses 被压制技能名）
  if (
    (m = text.match(
      /当前制造站内(.+?)根据自身提升的仓库容量提供一定的生产力。提升([+-]?\d+)格以下的，每格仓库容量提供([+-]?\d+(?:\.\d+)?)%生产力；提升大于([+-]?\d+)格的，每格仓库容量提供([+-]?\d+(?:\.\d+)?)%生产力/,
    ))
  ) {
    const eff = {
      target: "manufacture",
      stat: "manuProd",
      per: {
        per: 1,
        value: Number(m[3]),
        source: "capTier",
        stat: "storageCap",
        tiers: [
          { cap: Number(m[2]), value: Number(m[3]) },
          { cap: null, value: Number(m[5]) },
        ],
      },
    };
    text = del(
      /当前制造站内.+?提升大于[+-]?\d+格的，每格仓库容量提供[+-]?\d+(?:\.\d+)?%生产力/,
      text,
    );
    if ((m = text.match(/（?无法与(.+?)叠加，且优先生效）?/))) {
      eff.suppresses = [m[1].trim()];
      text = del(/（?无法与.+?叠加，且优先生效）?/, text);
    }
    push(eff);
  }

  // 5.7) 技能类别「视作」（海沫·意识兼容：莱茵科技类/红松骑士团类 → 视作标准化类；标签叠加）
  if ((m = text.match(/当前制造站内所有(.+?)技能也全都视作(.+?)技能/))) {
    const froms = m[1]
      .split(/[、，,]/)
      .map((s) => termKeyOf(s.trim(), groups, warn))
      .filter(Boolean);
    const to = termKeyOf(m[2].trim(), groups, warn);
    if (froms.length && to) {
      push({
        target: "manufacture",
        stat: "skillTagConvert",
        tagFrom: froms,
        tagTo: to,
      });
      text = del(/当前制造站内所有.+?技能也全都视作.+?技能/, text);
    }
  }

  // 6) 属性折算（槐琥·配合意识）：其他干员提供的每N%生产力 → 额外 M%（最多K%）
  if (
    (m = text.match(
      /当前制造站内其他干员提供的每([+-]?\d+)%生产力（不包含根据设施数量提供加成的生产力），额外提供([+-]?\d+)%生产力，最多提供([+-]?\d+)%生产力/,
    ))
  ) {
    push({
      target: "manufacture",
      stat: "manuProd",
      per: {
        per: Number(m[1]),
        value: Number(m[2]),
        cap: Number(m[3]),
        capUnit: "value",
        source: "stat",
        stat: "manuProd",
        statScope: "sameFacility",
        except: ["facilityCount"],
      },
    });
    text = del(
      /当前制造站内其他干员提供的每[+-]?\d+%生产力（不包含根据设施数量提供加成的生产力），额外提供[+-]?\d+%生产力，最多提供[+-]?\d+%生产力/,
      text,
    );
  }

  // 7) 进驻干员数（冬时）：每个当前制造站内干员为当前制造站 ±X（生产力/仓库上限）
  while (
    (m = text.match(
      /每个当前制造站内干员为当前制造站([+-]?\d+(?:\.\d+)?)%生产力/,
    ))
  ) {
    push({
      target: "manufacture",
      stat: "manuProd",
      per: { per: 1, value: Number(m[1]), source: "opCount" },
    });
    text = text.replace(
      /每个当前制造站内干员为当前制造站[+-]?\d+(?:\.\d+)?%生产力/,
      "",
    );
  }
  while (
    (m = text.match(
      /每个当前制造站内干员为当前制造站仓库容量(?:上限)?([+-]?\d+)/,
    ))
  ) {
    push({
      target: "manufacture",
      stat: "storageCap",
      per: { per: 1, value: Number(m[1]), source: "opCount" },
    });
    text = text.replace(
      /每个当前制造站内干员为当前制造站仓库容量(?:上限)?[+-]?\d+/,
      "",
    );
  }

  // 8) 每间宿舍每级（娜仁图亚·齐心沙盗）：每间宿舍每级为XX类配方的生产力+Y%
  if (
    (m = text.match(/每间宿舍每级为(.+?类配方)?的?生产力([+-]?\d+(?:\.\d+)?)%/))
  ) {
    const eff = {
      target: "manufacture",
      stat: "manuProd",
      per: { per: 1, value: Number(m[2]), source: "dormLevel" },
    };
    if (m[1]) eff.recipe = recipeValue(m[1]);
    push(eff);
    text = del(/每间宿舍每级为.+?类配方?的?生产力[+-]?\d+(?:\.\d+)?%/, text);
  }

  // 9) 训练室等级（维伊·手艺人）：训练室每级为当前制造站+X%生产力，最多Y%
  if (
    (m = text.match(
      /训练室每级为当前制造站([+-]?\d+(?:\.\d+)?)%生产力，最多([+-]?\d+)%/,
    ))
  ) {
    push({
      target: "manufacture",
      stat: "manuProd",
      per: {
        per: 1,
        value: Number(m[1]),
        cap: Number(m[2]) / Number(m[1]),
        source: "trainLevel",
      },
    });
    text = del(
      /训练室每级为当前制造站[+-]?\d+(?:\.\d+)?%生产力，最多[+-]?\d+%/,
      text,
    );
  }

  // 10) 某类设施数量（引星棘刺/清流：每个贸易站为当前制造站XX类配方的生产力+Y%；
  //     温蒂/森蚺/异客/掠风：每个发电站为当前制造站+Y%的生产力）
  while (
    (m = text.match(
      /每个(贸易站|发电站|制造站|宿舍)为当前制造站(.+?类配方)?的?(?:生产力)?([+-]?\d+(?:\.\d+)?)%/,
    ))
  ) {
    const eff = {
      target: "manufacture",
      stat: "manuProd",
      per: {
        per: 1,
        value: Number(m[3]),
        source: "facilityCount",
        facility: ROOM_MAP[m[1]],
      },
    };
    if (m[2]) eff.recipe = recipeValue(m[2]);
    push(eff);
    text = text.replace(
      /每个(贸易站|发电站|制造站|宿舍)为当前制造站.+?[+-]?\d+(?:\.\d+)?%/,
      "",
    );
  }

  // 11) 基建内阵营干员数（杏仁·挑大梁/娜斯提·造价高昂/结城理·社群的意义）：
  //     每有N名XX干员（最多M名），XX类配方的生产力额外+Y%；括号中的活动室使用者说明可省略。
  const opGroupInBaseRe =
    /基建内（不包含副手(?:及活动室使用者)?）每有([+-]?\d+)名(.+?)干员（最多([+-]?\d+)名），(.+?类配方)?的?生产力(?:额外)?([+-]?\d+(?:\.\d+)?)%/;
  if ((m = text.match(opGroupInBaseRe))) {
    const eff = {
      target: "manufacture",
      stat: "manuProd",
      per: {
        per: Number(m[1]),
        value: Number(m[5]),
        cap: Number(m[3]),
        source: "opGroupInBase",
        group: groupKey(m[2], groups, warn),
      },
    };
    if (m[4]) eff.recipe = recipeValue(m[4]);
    push(eff);
    text = del(opGroupInBaseRe, text);
  }

  // 12) 某设施阵营干员数（阿兰娜·机械精通）：每有N台XX进驻发电站，XX类配方+Y%
  if (
    (m = text.match(
      /每有([+-]?\d+)台(.+?)进驻发电站，(.+?类配方)?的?生产力([+-]?\d+(?:\.\d+)?)%/,
    ))
  ) {
    const eff = {
      target: "manufacture",
      stat: "manuProd",
      per: {
        per: Number(m[1]),
        value: Number(m[4]),
        source: "opGroupInFacility",
        group: groupKey(m[2], groups, warn),
        facility: "power",
      },
    };
    if (m[3]) eff.recipe = recipeValue(m[3]);
    push(eff);
    text = del(
      /每有[+-]?\d+台.+?进驻发电站，.+?生产力[+-]?\d+(?:\.\d+)?%/,
      text,
    );
  }

  // 13) 同站干员数（历阵锐枪芬·重聚时光）：当前制造站内每个XX干员为自身+Y%的生产力
  if (
    (m = text.match(
      /当前制造站内每个(.+?)干员为自身([+-]?\d+(?:\.\d+)?)%的生产力/,
    ))
  ) {
    push({
      target: "manufacture",
      stat: "manuProd",
      per: {
        per: 1,
        value: Number(m[2]),
        source: "opGroupInFacility",
        group: groupKey(m[1], groups, warn),
        facility: "same",
        other: true,
      },
    });
    text = del(
      /当前制造站内每个.+?干员为自身[+-]?\d+(?:\.\d+)?%的生产力/,
      text,
    );
  }

  // 14) 其他干员加成归零（温蒂/森蚺/异客/掠风/冬时）：当前制造站内其他干员提供的生产力全部归零
  if (text.match(/当前制造站内其他干员提供的生产力全部归零/)) {
    push({
      target: "manufacture",
      stat: "zeroOpBonus",
      except: ["facilityCount"],
    });
    text = del(
      /当前制造站内其他干员提供的生产力全部归零（不包含根据设施数量提供加成的生产力）/,
      text,
    );
  }

  // 15) 固定：仓库容量（上限）±X —— 描述有/无"上限"两说（铅踝·窗外雪啸"仓库容量+6"）
  while ((m = text.match(/仓库容量(?:上限)?([+-]?\d+)/))) {
    push({ target: "manufacture", stat: "storageCap", value: Number(m[1]) });
    text = text.replace(/仓库容量(?:上限)?[+-]?\d+/, "");
  }
  if ((m = text.match(/(.+?类配方)的?生产力(?:额外)?([+-]?\d+(?:\.\d+)?)%/))) {
    push({
      target: "manufacture",
      stat: "manuProd",
      value: Number(m[2]),
      recipe: recipeValue(m[1]),
    });
    text = del(/.+?类配方?的?生产力(?:额外)?[+-]?\d+(?:\.\d+)?%/, text);
  }
  if ((m = text.match(/生产力(?:额外)?([+-]?\d+(?:\.\d+)?)%/))) {
    push({ target: "manufacture", stat: "manuProd", value: Number(m[1]) });
    text = del(/生产力(?:额外)?[+-]?\d+(?:\.\d+)?%/, text);
  }

  // 含数字却仍未识别才算异常（"进驻制造站时，"这类纯前缀不警告）
  if (!effects.length && /\d/.test(text))
    warn("未识别的制造站效果文本：" + text);
  return effects;
}

// ===== 贸易站效果解析（target 基值为 'trading'） =====
// 主效率 stat 为 tradeSpd（订单获取效率 %）；并新增：
//   tradeOrder（订单规则：fixed/fixValues/breach/invest/tailor，按技能名特判 + 移除对应描述片段）、
//   orderLimit（订单上限，基础值按等级 6/8/10；每级+1 → per.source='ownLevel'）。
// 心情消耗（-0.25 等）由 parseSkillDesc 通用提取（参与心情计算，moodCostOf）。
function parseTradeEffects(text, target, groups, cond, warn, name) {
  const effects = [];
  const push = (eff) => {
    if (cond) eff.condition = cond;
    effects.push(eff);
  };
  const del = (re, src) => src.replace(re, "");
  let m;
  // 0.1) 心情消耗（贸易站在此处统一提取；含 scope:'room' 的"全体心情"版）
  if ((m = text.match(/全体心情每小时消耗([+-]?\d+(?:\.\d+)?)/))) {
    push({
      target: "trading",
      stat: "moodCost",
      value: Number(m[1]),
      scope: "room",
    });
    text = del(/全体心情每小时消耗[+-]?\d+(?:\.\d+)?/, text);
  }
  if ((m = text.match(/贸易站内全体干员每小时心情消耗([+-]?\d+(?:\.\d+)?)/))) {
    push({
      target: "trading",
      stat: "moodCost",
      value: Number(m[1]),
      scope: "room",
    });
    text = del(/贸易站内全体干员每小时心情消耗[+-]?\d+(?:\.\d+)?/, text);
  }
  if ((m = text.match(/贸易站内干员心情每小时消耗([+-]?\d+(?:\.\d+)?)/))) {
    push({
      target: "trading",
      stat: "moodCost",
      value: Number(m[1]),
      scope: "room",
    });
    text = del(/贸易站内干员心情每小时消耗[+-]?\d+(?:\.\d+)?/, text);
  }
  if ((m = text.match(/心情每小时消耗([+-]?\d+(?:\.\d+)?)/))) {
    push({ target: "trading", stat: "moodCost", value: Number(m[1]) });
    text = del(/心情每小时消耗[+-]?\d+(?:\.\d+)?/, text);
  }
  // 0.1b) per 心情（铎铃·跋山涉水/万里传书：每有10点人间烟火，则额外-0.01）→ per basePoint + scope room
  if ((m = text.match(/每有([+-]?\d+)点(.+?)，则额外([+-]?\d+(?:\.\d+)?)/))) {
    push({
      target: "trading",
      stat: "moodCost",
      scope: "room",
      per: {
        per: Number(m[1]),
        value: Number(m[3]),
        source: "basePoint",
        term: termKeyOf(m[2], groups, warn),
      },
    });
    text = del(/每有[+-]?\d+点.+?，则额外[+-]?\d+(?:\.\d+)?/, text);
  }
  // 0.2) 其他干员加成归零（巫恋·低语）：当前贸易站内其他干员提供的订单获取效率全部归零
  if (text.match(/当前贸易站内其他干员提供的订单获取效率全部归零/)) {
    push({ target: "trading", stat: "zeroOpBonus", except: ["facilityCount"] });
    text = del(/当前贸易站内其他干员提供的订单获取效率全部归零/, text);
  }
  // 0.3) 每人为自身+X%订单获取效率（巫恋·低语）→ per opCount（other:true）
  if ((m = text.match(/每人为自身([+-]?\d+(?:\.\d+)?)%订单获取效率/))) {
    push({
      target: "trading",
      stat: "tradeSpd",
      per: { per: 1, value: Number(m[1]), source: "opCount", other: true },
    });
    text = del(/每人为自身[+-]?\d+(?:\.\d+)?%订单获取效率/, text);
  }
  // 0.4) 订单规则特判（按技能名 → tradeOrder 效果；命中后移除对应描述片段）
  const TAILOR_LEVELS = {
    "裁缝·α": "α",
    "裁缝·β": "β",
    "手工艺品·α": "α",
    "手工艺品·β": "β",
    鉴定师的眼光: "α",
    鉴定师的手段: "β",
    懂行: "α",
    千金的眼光: "α",
  };
  if (TAILOR_LEVELS[name]) {
    push({
      target: "trading",
      stat: "tradeOrder",
      order: { type: "tailor", level: TAILOR_LEVELS[name] },
    });
    text = del(
      /[^，]*?(?:小幅)?提升当前贸易站高品质贵金属订单的出现概率（工作时长影响概率）/,
      text,
    );
  } else if (name === "慧眼独到") {
    push({
      target: "trading",
      stat: "tradeOrder",
      order: {
        type: "fixed",
        orderName: "特别独占订单",
        qty: 1000,
        material: null,
        amount: 0,
        time: 4.5,
        priority: 1,
        ignoreEff: true,
      },
    });
    text = del(
      /固定获取特别独占订单（不视作违约订单），且该类订单不受任何订单获取效率的影响|固定获取特别独占订单[^，]*/,
      text,
    );
  } else if (name === "特别订单") {
    push({
      target: "trading",
      stat: "tradeOrder",
      order: {
        type: "fixed",
        orderName: "可露希尔特别订单",
        qty: 1200,
        material: "赤金",
        amount: 2,
        time: 2.4,
        priority: 2,
      },
    });
    text = del(
      /固定获取可露希尔特别订单（不视作违约订单）|固定获取可露希尔特别订单/,
      text,
    );
  } else if (name === "天真的谈判者") {
    push({
      target: "trading",
      stat: "tradeOrder",
      order: { type: "fixValues", qty: 1000, amount: 2 },
    });
    text = del(/当前贸易站赤金订单的赤金交付数必定为2（不视作违约订单）/, text);
  } else if (name === "合同法") {
    push({ target: "trading", stat: "tradeOrder", order: { type: "breach" } });
    text = del(/如果下笔赤金订单交付数小于4，则视为违约订单/, text);
  } else if (name === "违约索赔·α") {
    push({
      target: "trading",
      stat: "tradeOrder",
      order: { type: "breach", amount: 1, qty: 500 },
    });
    text = del(
      /如果下笔赤金订单是违约订单，则赤金交付数额外\+1|则赤金交付数额外\+1/,
      text,
    );
  } else if (name === "违约索赔·β") {
    push({
      target: "trading",
      stat: "tradeOrder",
      order: { type: "breach", amount: 2, qty: 1000 },
    });
    text = del(
      /如果下笔赤金订单是违约订单，则赤金交付数额外\+2|则赤金交付数额外\+2/,
      text,
    );
  } else if (name === "投资·α") {
    push({
      target: "trading",
      stat: "tradeOrder",
      order: { type: "invest", qty: 250 },
    });
    text = del(
      /如果下笔赤金订单交付数大于3（违约订单不视作赤金订单），则其龙门币收益\+250|则其龙门币收益\+250/,
      text,
    );
  } else if (name === "投资·β") {
    push({
      target: "trading",
      stat: "tradeOrder",
      order: { type: "invest", qty: 500 },
    });
    text = del(
      /如果下笔赤金订单交付数大于3（违约订单不视作赤金订单），则其龙门币收益\+500|则其龙门币收益\+500/,
      text,
    );
  }
  // 0.5) 基地点数相关（新顺序：产出/转化须先于 per 消费与固定值；均带 term 引用）
  //   a) 产出：宿舍内每有N名干员则XX+Y（乌有·人间烟火 / 黑键·感知信息）
  if ((m = text.match(/宿舍内每有([+-]?\d+)名干员则(.+?)([+-]?\d+)/))) {
    push({
      target: "trading",
      stat: "basePointGain",
      term: termKeyOf(m[2], groups, warn),
      per: { per: 1, value: Number(m[3]), source: "dormOccupants" },
    });
    text = del(/宿舍内每有[+-]?\d+名干员则.+?[+-]?\d+/, text);
  }
  //   b) 产出：基建内每N名XX干员（最多M名）为当前贸易站提供K条xx（鸿雪·际崖居民）
  if (
    (m = text.match(
      /基建内（不包含副手及活动室使用者）每([+-]?\d+)名(.+?)干员（最多([+-]?\d+)名）为当前贸易站提供([+-]?\d+)条(.+?)(?:[，,。]|$)/,
    ))
  ) {
    push({
      target: "trading",
      stat: "basePointGain",
      term: termKeyOf(m[5], groups, warn),
      per: {
        per: Number(m[1]),
        value: Number(m[4]),
        cap: Number(m[3]),
        source: "opGroupInBase",
        group: groupKey(m[2], groups, warn),
      },
    });
    text = del(
      /基建内（不包含副手及活动室使用者）每[+-]?\d+名.+?干员（最多[+-]?\d+名）为当前贸易站提供[+-]?\d+条.+?(?:[，,。]|$)/,
      text,
    );
  }
  //   c) 放大：每有N条xx，则为当前贸易站额外提供M条xx（绮良·订单流可视化；自引用 → 计算层放大遍）
  if (
    (m = text.match(
      /每有([+-]?\d+)条(.+?)，则为当前贸易站额外提供([+-]?\d+)条(.+?)(?:[，,。]|$)/,
    ))
  ) {
    push({
      target: "trading",
      stat: "basePointGain",
      term: termKeyOf(m[4], groups, warn),
      per: {
        per: Number(m[1]),
        value: Number(m[3]),
        source: "basePoint",
        term: termKeyOf(m[2], groups, warn),
      },
    });
    text = del(
      /每有[+-]?\d+条.+?，则为当前贸易站额外提供[+-]?\d+条.+?(?:[，,。]|$)/,
      text,
    );
  }
  //   d) 转化：每N点A转化为M点B（黑键·乐感 感知信息→无声共鸣）
  while (
    (m = text.match(
      /每\s*([+-]?\d+)\s*点(.+?)转化为\s*([+-]?\d+)\s*点(.+?)(?:[，,。]|$)/,
    ))
  ) {
    push({
      target: "trading",
      stat: "basePointConvert",
      from: termKeyOf(m[2], groups, warn),
      to: termKeyOf(m[4], groups, warn),
      rate: Number(m[3]) / Number(m[1]),
    });
    text = text.replace(
      /每\s*[+-]?\d+\s*点.+?转化为\s*[+-]?\d+\s*点.+?(?:[，,。]|$)/,
      "",
    );
  }
  // 0.6) per 型效率（按计数 × 值；须在固定值之前，del 防止固定值误配）
  //   a) 每N点XX +Y%订单效率（齐尔查克·魔物料理 / 黑键·无声共鸣）
  if ((m = text.match(/每([+-]?\d+)点(.+?)([+-]?\d+(?:\.\d+)?)%订单效率/))) {
    push({
      target: "trading",
      stat: "tradeSpd",
      per: {
        per: Number(m[1]),
        value: Number(m[3]),
        source: "basePoint",
        term: termKeyOf(m[2], groups, warn),
      },
    });
    text = del(/每[+-]?\d+点.+?[+-]?\d+(?:\.\d+)?%订单效率/, text);
  }
  //   b) 每有N点/个XX，则订单获取效率+Y%（乌有·人间烟火 / 泰拉大陆调查团·木天蓼）
  if (
    (m = text.match(
      /每有([+-]?\d+)[点个](.+?)，则订单获取效率([+-]?\d+(?:\.\d+)?)%/,
    ))
  ) {
    push({
      target: "trading",
      stat: "tradeSpd",
      per: {
        per: Number(m[1]),
        value: Number(m[3]),
        source: "basePoint",
        term: termKeyOf(m[2], groups, warn),
      },
    });
    text = del(
      /每有[+-]?\d+[点个].+?，则订单获取效率[+-]?\d+(?:\.\d+)?%/,
      text,
    );
  }
  //   c) 每有N条XX，则当前贸易站订单获取效率(额外)+Y%（鸿雪·销路宣发 / 图耶·物流规划）
  if (
    (m = text.match(
      /每有([+-]?\d+)条(.+?)，则当前贸易站订单获取效率(?:额外)?([+-]?\d+(?:\.\d+)?)%/,
    ))
  ) {
    push({
      target: "trading",
      stat: "tradeSpd",
      per: {
        per: Number(m[1]),
        value: Number(m[3]),
        source: "basePoint",
        term: termKeyOf(m[2], groups, warn),
      },
    });
    text = del(
      /每有[+-]?\d+条.+?，则当前贸易站订单获取效率(?:额外)?[+-]?\d+(?:\.\d+)?%/,
      text,
    );
  }
  //   d) 同个贸易站中每有N名XX干员，当前贸易站订单获取效率+Y%（新约能天使·拉特兰 / 摩根·格拉斯哥帮）
  if (
    (m = text.match(
      /同个贸易站中每有([+-]?\d+)名(.+?)干员，当前贸易站订单获取效率([+-]?\d+(?:\.\d+)?)%/,
    ))
  ) {
    push({
      target: "trading",
      stat: "tradeSpd",
      per: {
        per: Number(m[1]),
        value: Number(m[3]),
        source: "opGroupInFacility",
        group: groupKey(m[2], groups, warn),
        facility: "same",
      },
    });
    text = del(
      /同个贸易站中每有[+-]?\d+名.+?干员，当前贸易站订单获取效率[+-]?\d+(?:\.\d+)?%/,
      text,
    );
  }
  if (
    (m = text.match(
      /每有一个(.+?)干员进驻贸易站，订单获取效率([+-]?\d+(?:\.\d+)?)%/,
    ))
  ) {
    push({
      target: "trading",
      stat: "tradeSpd",
      per: {
        per: 1,
        value: Number(m[2]),
        source: "opGroupInFacility",
        group: groupKey(m[1], groups, warn),
        facility: "trading",
      },
    });
    text = del(
      /每有一个.+?干员进驻贸易站，订单获取效率[+-]?\d+(?:\.\d+)?%/,
      text,
    );
  }
  //   e) 贸易站内除自身以外每名处于工作状态的干员+Y%（吉星·勤俭经营 / 火哨·代为说项；工作状态 → moodCheck）
  if (
    (m = text.match(
      /贸易站内除自身以外每名处于工作状态的干员([+-]?\d+(?:\.\d+)?)%订单获取效率/,
    ))
  ) {
    push({
      target: "trading",
      stat: "tradeSpd",
      per: {
        per: 1,
        value: Number(m[1]),
        source: "opCount",
        other: true,
        moodCheck: true,
      },
    });
    text = del(
      /贸易站内除自身以外每名处于工作状态的干员[+-]?\d+(?:\.\d+)?%订单获取效率/,
      text,
    );
  }
  //   f) 当前贸易站内干员提供的每N%订单获取效率，额外提供M%效率，最多提供K%效率（雪雉·天道酬勤）
  if (
    (m = text.match(
      /当前贸易站内干员提供的每([+-]?\d+)%订单获取效率，额外提供([+-]?\d+)%效率，最多提供([+-]?\d+)%效率/,
    ))
  ) {
    push({
      target: "trading",
      stat: "tradeSpd",
      per: {
        per: Number(m[1]),
        value: Number(m[2]),
        cap: Number(m[3]),
        capUnit: "value",
        source: "stat",
        stat: "tradeSpd",
        statScope: "targetFacility",
      },
    });
    text = del(
      /当前贸易站内干员提供的每[+-]?\d+%订单获取效率，额外提供[+-]?\d+%效率，最多提供[+-]?\d+%效率/,
      text,
    );
  }
  //   g) 当前贸易站内干员提升的每N个订单上限，提供M%订单获取效率（最多K%）（锏·冠军风采）→ facCap orderLimit
  //      「每N个一档，不足不加」→ per.floor=true（整数档；否则按连续比例）
  if (
    (m = text.match(
      /当前贸易站内(.+?)提升的每([+-]?\d+)个订单上限，提供([+-]?\d+(?:\.\d+)?)%订单获取效率，最多提供([+-]?\d+)%效率/,
    ))
  ) {
    push({
      target: "trading",
      stat: "tradeSpd",
      per: {
        per: Number(m[2]),
        value: Number(m[3]),
        cap: Number(m[4]),
        capUnit: "value",
        source: "facCap",
        stat: "orderLimit",
        floor: true,
      },
    });
    text = del(
      /当前贸易站内.+?提升的每[+-]?\d+个订单上限，提供[+-]?\d+(?:\.\d+)?%订单获取效率，最多提供[+-]?\d+%效率/,
      text,
    );
  }
  //   h) 当前贸易站内干员提升的每个订单上限，提供M%订单获取效率（琳琅诗怀雅·招商引资）→ tradeNetEff
  //      （按"额外订单上限"（干员提供净额-孑精1扣除）计价，见 计算规则 16）
  if (
    (m = text.match(
      /当前贸易站内(.+?)提升的每个订单上限，提供([+-]?\d+(?:\.\d+)?)%订单获取效率/,
    ))
  ) {
    push({
      target: "trading",
      stat: "tradeNetEff",
      per: { per: 1, value: Number(m[2]), source: "orderLimitNet" },
    });
    text = del(
      /当前贸易站内.+?提升的每个订单上限，提供[+-]?\d+(?:\.\d+)?%订单获取效率/,
      text,
    );
  }
  //   i) 制造站每有N类配方进行加工，则当前贸易站订单获取效率额外+Y%（石英·精准排期）→ manuRecipes
  if (
    (m = text.match(
      /制造站每有([+-]?\d+)类配方进行加工，则当前贸易站订单获取效率额外([+-]?\d+)%/,
    ))
  ) {
    push({
      target: "trading",
      stat: "tradeSpd",
      per: { per: Number(m[1]), value: Number(m[2]), source: "manuRecipes" },
    });
    text = del(
      /制造站每有[+-]?\d+类配方进行加工，则当前贸易站订单获取效率额外[+-]?\d+%/,
      text,
    );
  }
  //   j) 基建内（不包含副手及活动室）每有一间进驻XX的设施，订单获取效率+Y%（最多N间）（风絮·孺子可教 / 真言·精英小队）
  if (
    (m = text.match(
      /基建内（不包含副手及活动室）每有一间进驻(.+?)的设施，订单获取效率(?:额外)?([+-]?\d+(?:\.\d+)?)%（最多([+-]?\d+)间）/,
    ))
  ) {
    push({
      target: "trading",
      stat: "tradeSpd",
      per: {
        per: 1,
        value: Number(m[2]),
        cap: Number(m[3]),
        source: "baseFacilityWithGroup",
        group: groupKey(m[1], groups, warn),
      },
    });
    text = del(
      /基建内（不包含副手及活动室）每有一间进驻.+?的设施，订单获取效率(?:额外)?[+-]?\d+(?:\.\d+)?%（最多[+-]?\d+间）/,
      text,
    );
  }
  //   k) 每间宿舍每级+Y%获取效率（空弦·虔诚筹款）→ dormLevel
  if ((m = text.match(/每间宿舍每级([+-]?\d+(?:\.\d+)?)%获取效率/))) {
    push({
      target: "trading",
      stat: "tradeSpd",
      per: { per: 1, value: Number(m[1]), source: "dormLevel" },
    });
    text = del(/每间宿舍每级[+-]?\d+(?:\.\d+)?%获取效率/, text);
  }
  // 1) 固定：订单获取效率（额外/分别额外/提升）X%（赫德雷·β"分别额外+5%"等）
  if (
    (m = text.match(
      /订单获取效率(?:分别)?(?:额外)?(?:提升)?([+-]?\d+(?:\.\d+)?)%/,
    ))
  ) {
    push({ target: "trading", stat: "tradeSpd", value: Number(m[1]) });
    text = del(
      /订单获取效率(?:分别)?(?:额外)?(?:提升)?[+-]?\d+(?:\.\d+)?%/,
      text,
    );
  }
  // 1.5) 每级额外（渡桥·天生的顾问）：XX每级额外提供X%获取效率，最多提供Y%效率 → per facilityLevel（cap=value）
  if (
    (m = text.match(
      /([^，]+?)每级额外提供([+-]?\d+(?:\.\d+)?)%获取效率，最多提供([+-]?\d+)%效率/,
    ))
  ) {
    push({
      target: "trading",
      stat: "tradeSpd",
      per: {
        per: 1,
        value: Number(m[2]),
        cap: Number(m[3]),
        capUnit: "value",
        source: "facilityLevel",
        facility: ROOM_MAP[String(m[1]).trim()],
      },
    });
    text = del(
      /[^，]*?每级额外提供[+-]?\d+(?:\.\d+)?%获取效率，最多提供[+-]?\d+%效率/,
      text,
    );
  }
  // 2) 每级订单上限（佩佩·多面逢源/瑰盐·钱不我待）：当前贸易站每级+X个订单上限 → per ownLevel
  if ((m = text.match(/当前贸易站每级([+-]?\d+)个订单上限/))) {
    push({
      target: "trading",
      stat: "orderLimit",
      per: { per: 1, value: Number(m[1]), source: "ownLevel" },
    });
    text = del(/当前贸易站每级[+-]?\d+个订单上限/, text);
  }
  // 3) 固定：订单上限±X
  if ((m = text.match(/订单上限([+-]?\d+)/))) {
    push({ target: "trading", stat: "orderLimit", value: Number(m[1]) });
    text = del(/订单上限[+-]?\d+/, text);
  }
  // 含数字却仍未识别才算异常（"进驻贸易站时，"这类纯前缀不警告）
  if (!effects.length && /\d/.test(text))
    warn("未识别的贸易站效果文本：" + text);
  return effects;
}

// 条件文本 → condition 对象（覆盖发电站与会客室全部条件句式）
function condFromText(cText, groups, warn) {
  let m;
  if (cText.match(/会客室内只有自身处于工作状态/)) return { type: "onlySelf" }; // 会客室：只有自身工作
  if ((m = cText.match(/其他(.+?)进驻在发电站$/))) {
    // 阵营进驻发电站
    return {
      type: "opGroupInFacility",
      group: groupKey(m[1].replace(/干员$/, ""), groups, warn),
      facility: "same",
      other: true,
    };
  }
  if ((m = cText.match(/其他发电站内没有进驻(.+?)$/))) {
    // 阵营未进驻发电站（晨曦）
    return {
      type: "opGroupNotInFacility",
      group: groupKey(m[1].replace(/干员$/, ""), groups, warn),
      facility: "power",
      other: true,
    };
  }
  if ((m = cText.match(/(.+?)进驻(?:在)?训练室协助位$/)))
    return {
      type: "opAtFacility",
      op: m[1],
      facility: "training",
      assist: true,
    };
  if ((m = cText.match(/(.+?)进驻(?:在)?控制中枢$/)))
    return { type: "opAtFacility", op: m[1], facility: "control" };
  if ((m = cText.match(/(.+?)进驻(?:在)?发电站$/)))
    return { type: "opAtFacility", op: m[1], facility: "power" };
  if ((m = cText.match(/(.+?)进驻(?:在)?宿舍$/)))
    return { type: "opAtFacility", op: m[1], facility: "dormitory" };
  if ((m = cText.match(/(.+?)进驻(?:在)?会客室$/)))
    return { type: "opAtFacility", op: m[1], facility: "meeting" };
  if ((m = cText.match(/(.+?)进驻(?:在)?制造站$/)))
    return { type: "opAtFacility", op: m[1], facility: "manufacture" };
  // 制造站/贸易站条件
  if ((m = cText.match(/自身心情落差大于([+-]?\d+)/)))
    return { type: "moodDrop", value: Number(m[1]) }; // 铅踝·窗外雪啸
  if ((m = cText.match(/单次工作时长(?:达到|为)([+-]?\d+)小时/)))
    return { type: "workHours", value: Number(m[1]) }; // 机械师·"我睡过了"
  if ((m = cText.match(/与(.+?)干员在同一个(.+?)$/)))
    return {
      type: "opGroupInFacility",
      group: groupKey(m[1], groups, warn),
      facility: "same",
      other: true,
    }; // 与XX干员同站（怒潮凛冬）
  if ((m = cText.match(/与(.+?)在同一个(.+?)$/)))
    return { type: "opAtFacility", op: m[1], facility: "same" }; // 与XX同站（Miss.Christine/阿兰娜）
  if (
    (m = cText.match(
      /(.+?)在(贸易站|制造站|发电站|会客室|办公室|加工站|训练室|宿舍|控制中枢)$/,
    ))
  )
    // 烈夏·患难拍档
    return { type: "opAtFacility", op: m[1], facility: ROOM_MAP[m[2]] };
  warn("未识别的条件文本：" + cText);
  return null;
}

// ===== 控制中枢效果解析 =====
// 控制中枢描述中的“部分设施/其他设施/工作场所”本身就是术语引用。
// 这些数组在 main() 中从 gamedata_const.termDescriptionDict 动态展开，下面的值只用于
// 快照缺少对应术语时的降级，避免把旧项目映射表变成新的数据源。
let CONTROL_ROOM1 = ["power", "hire", "meeting"];
let CONTROL_ROOM2 = ["power", "manufacture", "trading", "hire", "meeting"];
let WORKSPACE_FACS = [
  "power",
  "manufacture",
  "trading",
  "hire",
  "meeting",
  "control",
  "processing",
  "training",
];

function facilitiesFromTerm(termDescriptions, termKey, fallback) {
  const description = String(termDescriptions[termKey]?.description ?? "");
  const line =
    description.split(/\r?\n/).find((part) => part.includes("、")) ?? "";
  const facilities = line
    .split("、")
    .map((label) => ROOM_MAP[label.trim()])
    .filter(Boolean);
  return facilities.length > 0 ? facilities : fallback;
}

function configureFacilityTerms(termDescriptions) {
  CONTROL_ROOM1 = facilitiesFromTerm(
    termDescriptions,
    "cc.c.room1",
    CONTROL_ROOM1,
  );
  CONTROL_ROOM2 = facilitiesFromTerm(
    termDescriptions,
    "cc.c.room2",
    CONTROL_ROOM2,
  );
  WORKSPACE_FACS = facilitiesFromTerm(
    termDescriptions,
    "cc.c.room3",
    WORKSPACE_FACS,
  );
  if (!WORKSPACE_FACS.includes("processing")) {
    WORKSPACE_FACS.push("processing");
  }
}

function cloneEffect(effect) {
  return JSON.parse(JSON.stringify(effect));
}

function pushControlEffect(effects, effect, condition) {
  const next = cloneEffect(effect);
  if (condition && !next.condition) next.condition = condition;
  effects.push(next);
}

function controlTermKey(label, groups, warn) {
  return groups[label] || termKeyOf(label, groups, warn);
}

function controlCondition(text, groups, warn) {
  let match = text.match(/当自身心情(?:处于)?([+-]?\d+)以下时?/);
  if (match) return { type: "moodCmp", value: Number(match[1]), op: "le" };
  match = text.match(/当自身心情大于([+-]?\d+)时?/);
  if (match) return { type: "moodCmp", value: Number(match[1]), op: "gt" };
  match = text.match(/热情值处于([+-]?\d+)点及以上时?/);
  if (match)
    return {
      type: "termCmp",
      a: "cc.bd_mujica",
      b: Number(match[1]),
      op: "ge",
    };
  match = text.match(/若(.+?)大于等于(.+?)[，,]/);
  if (match)
    return {
      type: "termCmp",
      a: controlTermKey(match[1], groups, warn),
      b: controlTermKey(match[2], groups, warn),
      op: "ge",
    };
  match = text.match(/若(.+?)大于(.+?)[，,]/);
  if (match)
    return {
      type: "termCmp",
      a: controlTermKey(match[1], groups, warn),
      b: controlTermKey(match[2], groups, warn),
      op: "gt",
    };
  match = text.match(/若(.+?)小于(.+?)[，,]/);
  if (match)
    return {
      type: "termCmp",
      a: controlTermKey(match[1], groups, warn),
      b: controlTermKey(match[2], groups, warn),
      op: "lt",
    };
  return null;
}

function parseControlPart(text, groups, effects, warn, condition = null) {
  let rest = text.trim().replace(/^同时/, "").trim();
  let match;

  // 线索倾向/未拥有线索属于可展示的概率效果。必须在“某干员心情”通用规则前提取，
  // 否则“提升会客室内干员所属派系……”会被误识别成干员名。
  const cluePatterns = [
    /(?:小幅)?提升会客室内干员所属派系的线索倾向效果/,
    /会客室更容易获得[^，。；]*线索(?:（工作时长影响概率）)?/,
    /更容易获得线索板上尚未拥有的线索/,
  ];
  cluePatterns.forEach((pattern) => {
    const clue = rest.match(pattern);
    if (!clue) return;
    pushControlEffect(effects, clueChanceEffect("meeting", clue[0]), condition);
    rest = rest.replace(clue[0], "");
  });

  // 先提取“当/若条件，结果”结构，避免条件中的数字被当成效果数值。
  if (
    (match = rest.match(
      /^每有(\d+)点(.+?)，自身心情每小时消耗([+-]?\d+(?:\.\d+)?)，所有贸易站订单效率([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    const term = controlTermKey(match[2], groups, warn);
    pushControlEffect(
      effects,
      {
        target: "control",
        stat: "moodCost",
        per: {
          per: Number(match[1]),
          value: Number(match[3]),
          source: "basePoint",
          term,
        },
      },
      condition,
    );
    pushControlEffect(
      effects,
      {
        target: "trading",
        stat: "tradeSpd",
        per: {
          per: Number(match[1]),
          value: Number(match[4]),
          source: "basePoint",
          term,
        },
        stack: "max",
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(
      /^如果有(\d+)台以上(.+?)进驻在(发电站|制造站|贸易站|会客室|办公室|宿舍)，则(.+)$/,
    ))
  ) {
    parseControlPart(match[4], groups, effects, warn, {
      type: "opGroupCountInFacility",
      group: controlTermKey(match[2], groups, warn),
      facility: ROOM_MAP[match[3]],
      min: Number(match[1]),
    });
    return;
  }
  if (
    (match = rest.match(
      /^如果(.+?)进驻在(发电站|制造站|贸易站|会客室|办公室|宿舍)，(?:则)?(.+)$/,
    ))
  ) {
    parseControlPart(match[3], groups, effects, warn, {
      type: "opAtFacility",
      op: match[1],
      facility: ROOM_MAP[match[2]],
    });
    return;
  }
  if ((match = rest.match(/^当(.+?)进驻中枢时(.+)$/))) {
    const value = rest.match(/额外([+-]?\d+(?:\.\d+)?)/);
    if (value) {
      pushControlEffect(
        effects,
        {
          target: "any",
          stat: "moodRecover",
          value: Number(value[1]),
          facilities: CONTROL_ROOM2,
          stack: "max",
          maxGroup: "otherFacRec",
        },
        { type: "opAtFacility", op: match[1], facility: "control" },
      );
      rest = rest.replace(match[0], "");
    }
  }
  if (
    (match = rest.match(
      /^当(.+?)(?:进驻|入驻)(会客室|贸易站|制造站|发电站|办公室|宿舍)时，(.+)$/,
    ))
  ) {
    parseControlPart(match[3], groups, effects, warn, {
      type: "opAtFacility",
      op: match[1],
      facility: ROOM_MAP[match[2]],
    });
    return;
  }
  if (
    (match = rest.match(
      /^当(.+?)(?:进驻|入驻)(会客室|贸易站|制造站|发电站|办公室|宿舍)时(.+)$/,
    ))
  ) {
    parseControlPart(match[3], groups, effects, warn, {
      type: "opAtFacility",
      op: match[1],
      facility: ROOM_MAP[match[2]],
    });
    return;
  }
  if ((match = rest.match(/^当自身心情(?:处于)?([+-]?\d+)以下时，(.+)$/))) {
    parseControlPart(match[2], groups, effects, warn, {
      type: "moodCmp",
      value: Number(match[1]),
      op: "le",
    });
    return;
  }
  if ((match = rest.match(/^热情值处于([+-]?\d+)点及以上时，(.+)$/))) {
    parseControlPart(match[2], groups, effects, warn, {
      type: "termCmp",
      a: "cc.bd_mujica",
      b: Number(match[1]),
      op: "ge",
    });
    return;
  }
  if ((match = rest.match(/^当自身心情大于([+-]?\d+)时，(.+)$/))) {
    parseControlPart(match[2], groups, effects, warn, {
      type: "moodCmp",
      value: Number(match[1]),
      op: "gt",
    });
    return;
  }
  if ((match = rest.match(/^当热情值处于([+-]?\d+)点及以上时，(.+)$/))) {
    parseControlPart(match[2], groups, effects, warn, {
      type: "termCmp",
      a: "cc.bd_mujica",
      b: Number(match[1]),
      op: "ge",
    });
    return;
  }
  if ((match = rest.match(/^若(.+?)[，,](.+)$/))) {
    const cond = controlCondition(match[1] + "，", groups, warn);
    if (cond) {
      parseControlPart(match[2], groups, effects, warn, cond);
      return;
    }
  }

  if (
    (match = rest.match(
      /控制中枢内每个(.+?)干员可使控制中枢内所有干员(?:的)?心情每小时恢复([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "control",
        stat: "moodRecover",
        scope: "room",
        per: {
          per: 1,
          value: Number(match[2]),
          source: "opGroupInFacility",
          group: controlTermKey(match[1], groups, warn),
          facility: "same",
        },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }

  // 中枢自身与中枢全员的心情。
  if (
    (match = rest.match(
      /控制中枢内所有干员(?:的)?心情每小时恢复([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "control",
        stat: "moodRecover",
        value: Number(match[1]),
        scope: "room",
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(/控制中枢内每个(.+?)干员可使该派系干员额外恢复心情/))
  ) {
    pushControlEffect(
      effects,
      {
        target: "any",
        stat: "moodRecover",
        scopeGroup: controlTermKey(match[1], groups, warn),
        per: {
          per: 1,
          value: 0.2,
          source: "opGroupInFacility",
          group: controlTermKey(match[1], groups, warn),
          facility: "same",
        },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(
      /控制中枢内部分技能可以为其他设施内处于工作状态的干员额外提供心情恢复/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "any",
        stat: "moodRecover",
        facilities: CONTROL_ROOM2,
        stack: "max",
        maxGroup: "otherFacRec",
        per: { per: 1, value: 0.05, source: "skillOwners", term: "cc.c.skill" },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }

  // 设施集合必须先于“某某干员心情”通用模式处理，否则会把集合名称误当成干员名。
  if (
    (match = rest.match(
      /部分设施内处于工作状态的干员心情每小时恢复([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "any",
        stat: "moodRecover",
        value: Number(match[1]),
        facilities: CONTROL_ROOM1,
        stack: "max",
        maxGroup: "otherFacRec",
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(
      /其他设施内处于工作状态的干员心情每小时恢复([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "any",
        stat: "moodRecover",
        value: Number(match[1]),
        facilities: CONTROL_ROOM2,
        stack: "max",
        maxGroup: "otherFacRec",
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(
      /所有宿舍内所有干员的心情每小时恢复([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "dormitory",
        stat: "moodRecover",
        value: Number(match[1]),
        scope: "room",
        stack: "max",
        maxGroup: "dormRec-overall",
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(/所有宿舍内(.+?)的心情每小时恢复([+-]?\d+(?:\.\d+)?)/))
  ) {
    pushControlEffect(
      effects,
      {
        target: "dormitory",
        stat: "moodRecover",
        value: Number(match[2]),
        scope: "room",
        scopeGroup: controlTermKey(match[1], groups, warn),
        stack: "max",
        maxGroup: "dormRec-overall",
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }

  if ((match = rest.match(/自身心情每小时消耗([+-]?\d+(?:\.\d+)?)/))) {
    pushControlEffect(
      effects,
      { target: "control", stat: "moodCost", value: Number(match[1]) },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if ((match = rest.match(/自身心情每小时恢复([+-]?\d+(?:\.\d+)?)/))) {
    pushControlEffect(
      effects,
      {
        target: "control",
        stat: "moodRecover",
        value: Number(match[1]),
        scope: "self",
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if ((match = rest.match(/自身和(.+?)心情每小时恢复([+-]?\d+(?:\.\d+)?)/))) {
    pushControlEffect(
      effects,
      {
        target: "control",
        stat: "moodRecover",
        value: Number(match[2]),
        scope: "self",
      },
      condition,
    );
    pushControlEffect(
      effects,
      {
        target: "control",
        stat: "moodRecover",
        value: Number(match[2]),
        scope: "op",
        op: match[1],
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }

  // 先处理控制中枢全员/除自身以外的心情消耗，再处理“某干员心情……”通用句式。
  if (
    (match = rest.match(
      /控制中枢内所有干员(?:的)?心情每小时消耗([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "control",
        stat: "moodCost",
        value: Number(match[1]),
        scope: "room",
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(
      /控制中枢内除自身以外的其余干员心情每小时消耗([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "control",
        stat: "moodCost",
        value: Number(match[1]),
        scope: "room",
        other: true,
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if ((match = rest.match(/(.+?)心情每小时恢复([+-]?\d+(?:\.\d+)?)/))) {
    pushControlEffect(
      effects,
      {
        target: "control",
        stat: "moodRecover",
        value: Number(match[2]),
        scope: "op",
        op: match[1].replace(/的$/, ""),
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if ((match = rest.match(/(.+?)心情每小时消耗([+-]?\d+(?:\.\d+)?)/))) {
    pushControlEffect(
      effects,
      {
        target: "control",
        stat: "moodCost",
        value: Number(match[2]),
        scope: "op",
        op: match[1].replace(/的$/, ""),
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if ((match = rest.match(/心情每小时消耗([+-]?\d+(?:\.\d+)?)/))) {
    pushControlEffect(
      effects,
      { target: "control", stat: "moodCost", value: Number(match[1]) },
      condition,
    );
    rest = rest.replace(match[0], "");
  }

  if (
    (match = rest.match(
      /每有(\d+)点(.+?)，自身心情每小时消耗([+-]?\d+(?:\.\d+)?)，所有贸易站订单效率([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    const term = controlTermKey(match[2], groups, warn);
    pushControlEffect(
      effects,
      {
        target: "control",
        stat: "moodCost",
        per: {
          per: Number(match[1]),
          value: Number(match[3]),
          source: "basePoint",
          term,
        },
      },
      condition,
    );
    pushControlEffect(
      effects,
      {
        target: "trading",
        stat: "tradeSpd",
        per: {
          per: Number(match[1]),
          value: Number(match[4]),
          source: "basePoint",
          term,
        },
        stack: "max",
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }

  if (
    (match = rest.match(
      /每有(\d+)点(.+?)，所有生产(.+?)类配方的制造站生产力([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "manufacture",
        stat: "manuProd",
        recipe: match[3],
        per: {
          per: Number(match[1]),
          value: Number(match[4]),
          source: "basePoint",
          term: controlTermKey(match[2], groups, warn),
        },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }

  if (
    (match = rest.match(
      /基建内（不包含副手及活动室使用者）每有(\d+)名(.+?)干员，会客室线索搜集速度([+-]?\d+)%（最多\+(\d+)%/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "meeting",
        stat: "clueSpeed",
        stack: "max",
        per: {
          per: Number(match[1]),
          value: Number(match[3]),
          cap: Number(match[4]),
          capUnit: "value",
          source: "opGroupInBase",
          group: controlTermKey(match[2], groups, warn),
        },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }

  // 跨设施固定效率。
  const fixedRules = [
    [/所有贸易站订单效率([+-]?\d+(?:\.\d+)?)/, "trading", "tradeSpd"],
    [/所有制造站生产力([+-]?\d+(?:\.\d+)?)/, "manufacture", "manuProd"],
    [
      /会客室线索搜集速度(?:额外)?(?:提升)?([+-]?\d+(?:\.\d+)?)/,
      "meeting",
      "clueSpeed",
    ],
    [
      /(?:人力办公室联络速度|人脉资源的联络速度)(?:额外)?([+-]?\d+(?:\.\d+)?)/,
      "hire",
      "hireSpd",
    ],
  ];
  fixedRules.forEach(([pattern, target, stat]) => {
    const found = rest.match(pattern);
    if (!found) return;
    const effect = { target, stat, value: Number(found[1]) };
    if (/同种效果取最高/.test(text)) effect.stack = "max";
    pushControlEffect(effects, effect, condition);
    rest = rest.replace(found[0], "");
  });
  if (
    (match = rest.match(
      /所有生产(.+?)类配方的制造站生产力([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    const effect = {
      target: "manufacture",
      stat: "manuProd",
      recipe: match[1],
      value: Number(match[2]),
    };
    if (/同种效果取最高/.test(text)) effect.stack = "max";
    pushControlEffect(effects, effect, condition);
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(
      /所有宿舍内所有干员的心情每小时恢复([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "dormitory",
        stat: "moodRecover",
        value: Number(match[1]),
        scope: "room",
        stack: "max",
        maxGroup: "dormRec-overall",
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(/所有宿舍内(.+?)的心情每小时恢复([+-]?\d+(?:\.\d+)?)/))
  ) {
    pushControlEffect(
      effects,
      {
        target: "dormitory",
        stat: "moodRecover",
        value: Number(match[2]),
        scope: "room",
        scopeGroup: controlTermKey(match[1], groups, warn),
        stack: "max",
        maxGroup: "dormRec-overall",
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }

  if (
    (match = rest.match(
      /每个进驻在制造站的(.+?)干员，(.+?)类配方的生产力([+-]?\d+(?:\.\d+)?)[%，]，?(.+?)类配方的生产力([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    const group = controlTermKey(match[1], groups, warn);
    pushControlEffect(
      effects,
      {
        target: "manufacture",
        stat: "manuProd",
        recipe: match[2],
        per: {
          per: 1,
          value: Number(match[3]),
          source: "opGroupInFacility",
          group,
          facility: "same",
        },
      },
      condition,
    );
    pushControlEffect(
      effects,
      {
        target: "manufacture",
        stat: "manuProd",
        recipe: match[4],
        per: {
          per: 1,
          value: Number(match[5]),
          source: "opGroupInFacility",
          group,
          facility: "same",
        },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(
      /每个进驻在制造站的(.+?)干员，(.+?)类配方的生产力([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    const group = controlTermKey(match[1], groups, warn);
    pushControlEffect(
      effects,
      {
        target: "manufacture",
        stat: "manuProd",
        recipe: match[2],
        per: {
          per: 1,
          value: Number(match[3]),
          source: "opGroupInFacility",
          group,
          facility: "same",
        },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(
      /每个进驻在制造站的(.+?)干员(?:，)?生产力([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    const group = controlTermKey(match[1], groups, warn);
    pushControlEffect(
      effects,
      {
        target: "manufacture",
        stat: "manuProd",
        per: {
          per: 1,
          value: Number(match[2]),
          source: "opGroupInFacility",
          group,
          facility: "same",
        },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if ((match = rest.match(/(.+?)所在贸易站订单上限([+-]?\d+)/))) {
    pushControlEffect(
      effects,
      {
        target: "trading",
        stat: "orderLimit",
        value: Number(match[2]),
        condition: {
          type: "opInFacilityAndTarget",
          op: match[1],
          facility: "trading",
        },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(
      /基建内（不包含副手及活动室使用者）每有(\d+)名(.+?)干员，会客室线索搜集速度([+-]?\d+)%（最多\+(\d+)%/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "meeting",
        stat: "clueSpeed",
        stack: "max",
        per: {
          per: Number(match[1]),
          value: Number(match[3]),
          cap: Number(match[4]),
          capUnit: "value",
          source: "opGroupInBase",
          group: controlTermKey(match[2], groups, warn),
        },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if ((match = rest.match(/<not-used>/))) {
    rest = rest.replace(match[0], "");
  }

  // 设施集合术语：玛恩纳/重岳/维什戴尔的“部分设施/其他设施”规则。
  if (
    (match = rest.match(
      /部分设施内处于工作状态的干员心情每小时恢复([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "any",
        stat: "moodRecover",
        value: Number(match[1]),
        facilities: CONTROL_ROOM1,
        stack: "max",
        maxGroup: "otherFacRec",
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(
      /其他设施内处于工作状态的干员心情每小时恢复([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "any",
        stat: "moodRecover",
        value: Number(match[1]),
        facilities: CONTROL_ROOM2,
        stack: "max",
        maxGroup: "otherFacRec",
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (rest.includes("其他设施内处于工作状态的干员心情每小时恢复")) {
    rest = rest.replace(/其他设施内处于工作状态的干员心情每小时恢复/g, "");
  }

  // “每个/每有 N 名某术语干员进驻某设施”型效果。
  const groupRules = [
    [
      /每个进驻在贸易站的(.+?)干员，订单获取效率([+-]?\d+(?:\.\d+)?)(?![%，]，?订单上限)[%，]/,
      "trading",
      "tradeSpd",
    ],
    [
      /同一贸易站中，每有(\d+)名(.+?)干员，订单获取效率([+-]?\d+(?:\.\d+)?)/,
      "trading",
      "tradeSpd",
    ],
    [
      /每个进驻在制造站的(.+?)干员，生产力([+-]?\d+(?:\.\d+)?)/,
      "manufacture",
      "manuProd",
    ],
    [
      /每个进驻在会客室的(.+?)干员，线索搜集速度([+-]?\d+(?:\.\d+)?)/,
      "meeting",
      "clueSpeed",
    ],
  ];
  groupRules.forEach(([pattern, target, stat]) => {
    const found = rest.match(pattern);
    if (!found) return;
    const hasCount = found.length === 4;
    const group = controlTermKey(hasCount ? found[2] : found[1], groups, warn);
    const value = Number(found[hasCount ? 3 : 2]);
    pushControlEffect(
      effects,
      {
        target,
        stat,
        per: {
          per: hasCount ? Number(found[1]) : 1,
          value,
          source: "opGroupInFacility",
          group,
          facility: "same",
        },
      },
      condition,
    );
    rest = rest.replace(found[0], "");
  });
  if (
    (match = rest.match(
      /每个存在(\d+)名(.+?)干员的贸易站，订单获取效率([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "trading",
        stat: "tradeSpd",
        value: Number(match[3]),
        condition: {
          type: "opGroupCountInFacility",
          group: controlTermKey(match[2], groups, warn),
          facility: "trading",
          min: Number(match[1]),
        },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(
      /每个进驻在贸易站的(.+?)干员，订单获取效率([+-]?\d+(?:\.\d+)?)[%，]，?订单上限([+-]?\d+)/,
    ))
  ) {
    const group = controlTermKey(match[1], groups, warn);
    pushControlEffect(
      effects,
      {
        target: "trading",
        stat: "tradeSpd",
        per: {
          per: 1,
          value: Number(match[2]),
          source: "opGroupInFacility",
          group,
          facility: "same",
        },
      },
      condition,
    );
    pushControlEffect(
      effects,
      {
        target: "trading",
        stat: "orderLimit",
        per: {
          per: 1,
          value: Number(match[3]),
          source: "opGroupInFacility",
          group,
          facility: "same",
        },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }

  if (
    (match = rest.match(
      /每个(.+?)干员进驻在宿舍和活动室以外的设施则(.+?)([+-]?\d+)(?:（最多(\d+)名）)?/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "any",
        stat: "basePointGain",
        term: controlTermKey(match[2], groups, warn),
        per: {
          per: 1,
          value: Number(match[3]),
          cap: match[4] ? Number(match[4]) : undefined,
          source: "opGroupInBase",
          group: controlTermKey(match[1], groups, warn),
          exclude: ["dormitory"],
        },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }

  // 基地点数、仓库数量和设施数量。
  if (
    (match = rest.match(/每有(\d+)名(.+?)干员，则?(.+?)([+-]?\d+)(?:，|$)/))
  ) {
    const termMatch = [...(groups ? Object.keys(groups) : [])].find((label) =>
      match[3].includes(label),
    );
    const term = termMatch ? controlTermKey(termMatch, groups, warn) : null;
    if (term) {
      pushControlEffect(
        effects,
        {
          target: "any",
          stat: "basePointGain",
          term,
          per: {
            per: Number(match[1]),
            value: Number(match[4]),
            source: "opGroupInFacility",
            group: controlTermKey(match[2], groups, warn),
            facility: "same",
          },
        },
        condition,
      );
      rest = rest.replace(match[0], "");
    }
  }
  if ((match = rest.match(/每有(\d+)点(.+?)，则额外([+-]?\d+(?:\.\d+)?)/))) {
    const effect = {
      target: "any",
      stat: "moodRecover",
      per: {
        per: Number(match[1]),
        value: Number(match[3]),
        source: "basePoint",
        term: controlTermKey(match[2], groups, warn),
      },
    };
    if (/特殊比较规则|同种效果取最高/.test(text)) {
      effect.stack = "max";
      effect.maxGroup = "otherFacRec";
    }
    pushControlEffect(effects, effect, condition);
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(
      /每有(\d+)点(.+?)，所有贸易站订单效率([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "trading",
        stat: "tradeSpd",
        per: {
          per: Number(match[1]),
          value: Number(match[3]),
          source: "basePoint",
          term: controlTermKey(match[2], groups, warn),
        },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if ((match = rest.match(/宿舍内每有([+-]?\d+)名干员，(.+?)([+-]?\d+)/))) {
    pushControlEffect(
      effects,
      {
        target: "any",
        stat: "basePointGain",
        term: controlTermKey(match[2], groups, warn),
        per: {
          per: Number(match[1]),
          value: Number(match[3]),
          source: "dormOccupants",
        },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(
      /如果有([+-]?\d+)台以上(.+?)进驻在发电站，则所有制造站生产力([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "manufacture",
        stat: "facBase",
        value: Number(match[3]),
        stack: "max",
        condition: {
          type: "opGroupCountInFacility",
          group: controlTermKey(match[2], groups, warn),
          facility: "power",
          min: Number(match[1]),
        },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if (
    (match = rest.match(
      /如训练室有干员在进行技能专精，则该干员的专精技能训练速度([+-]?\d+(?:\.\d+)?)/,
    ))
  ) {
    pushControlEffect(
      effects,
      {
        target: "training",
        stat: "facBase",
        value: Number(match[1]),
        stack: "max",
        condition: { type: "opCountInFacility", facility: "training", min: 1 },
      },
      condition,
    );
    rest = rest.replace(match[0], "");
  }
  if ((match = rest.match(/发电站额外([+-]?\d+)/))) {
    pushControlEffect(
      effects,
      { target: "power", stat: "facilityCount", value: Number(match[1]) },
      condition,
    );
    rest = rest.replace(match[0], "");
  }

  if (
    rest.includes("消除当前控制中枢内所有") ||
    rest.includes("消除自身心情消耗")
  ) {
    const groupMatch = rest.match(/所有(.+?)干员/);
    pushControlEffect(
      effects,
      {
        target: "control",
        stat: "zeroOpMood",
        ...(groupMatch
          ? {
              group: controlTermKey(groupMatch[1], groups, warn),
              scope: "room",
            }
          : { self: true }),
      },
      condition,
    );
    rest = rest.replace(/消除[^；，。]+/, "");
  }

  const termEntries = Object.entries(groups).filter(([, key]) =>
    key.startsWith("cc.bd"),
  );
  termEntries.forEach(([label, key]) => {
    const termValue = rest.match(
      new RegExp(
        `${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([+-]?[0-9]+(?:\\.[0-9]+)?)`,
      ),
    );
    if (!termValue) return;
    pushControlEffect(
      effects,
      {
        target: "any",
        stat: "basePointGain",
        term: key,
        value: Number(termValue[1]),
      },
      condition,
    );
    rest = rest.replace(termValue[0], "");
  });

  const tail = rest.replace(/^[，,、\s]+/, "").trim();
  if (tail && tail !== rest && /^(?:当|如果|若)/.test(tail)) {
    parseControlPart(tail, groups, effects, warn, condition);
    return;
  }

  if (rest && /\d/.test(rest)) warn("未识别的控制中枢效果文本：" + rest);
}

function parseCtrlEffects(id, name, description, warn) {
  const override = OPERATOR_SKILL_OVERRIDES[overrideKey(id, name)];
  if (override) return JSON.parse(JSON.stringify(override));

  const { text, groups } = cleanDesc(description);
  const effects = [];
  const normalized = text.replace(/^进驻控制中枢时，?/, "").trim();
  normalized
    .split(/；/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      let match = part.match(/^当与(.+?)一起进驻控制中枢时，(.+)$/);
      if (match) {
        const condition = {
          type: groups[match[1]] ? "opGroupInFacility" : "opAtFacility",
          ...(groups[match[1]]
            ? { group: groups[match[1]], facility: "same" }
            : { op: match[1], facility: "same" }),
        };
        parseControlPart(match[2], groups, effects, warn, condition);
        return;
      }
      match = part.match(/^当与(.+?)进驻控制中枢一起工作时，(.+)$/);
      if (match) {
        const subject = match[1].replace(/干员$/, "");
        const condition = groups[subject]
          ? {
              type: "opGroupInFacility",
              group: groups[subject],
              facility: "same",
              other: true,
            }
          : { type: "opAtFacility", op: subject, facility: "same" };
        parseControlPart(match[2], groups, effects, warn, condition);
        return;
      }
      match = part.match(/^当与(.+?)干员进驻控制中枢一起工作时，(.+)$/);
      if (match) {
        parseControlPart(match[2], groups, effects, warn, {
          type: "opGroupInFacility",
          group: controlTermKey(match[1], groups, warn),
          facility: "same",
          other: true,
        });
        return;
      }
      match = part.match(/^当与(.+?)一起进驻控制中枢时，(.+)$/);
      if (match) {
        parseControlPart(match[2], groups, effects, warn, {
          type: "opAtFacility",
          op: match[1],
          facility: "same",
        });
        return;
      }
      parseControlPart(part, groups, effects, warn);
    });
  return effects;
}

// 解析单个技能描述 → effects 数组
function parseSkillDesc(desc, room, warn, name, id) {
  const target = ROOM_MAP[room] || "any";
  const override = OPERATOR_SKILL_OVERRIDES[overrideKey(id, name)];
  if (override) return JSON.parse(JSON.stringify(override));
  if (room === "控制中枢") return parseCtrlEffects(id, name, desc, warn);
  let { text, groups } = cleanDesc(desc);
  const effects = [];
  let m;

  // 办公室技能用专用解析器（hireSpd / basePointGain / basePointConvert / baseFacilityWithGroup）；
  // 制造站技能用专用解析器（recipe / storageCap / zeroOpMood / skillTagCount 等）；
  // 贸易站技能用专用解析器（tradeSpd / orderLimit / tradeOrder 订单规则特判）；其余走通用 value 解析
  const valueParser = (pt, cond) => {
    if (room === "办公室")
      return parseOfficeEffects(pt, target, groups, cond, warn);
    if (room === "制造站")
      return parseManuEffects(pt, target, groups, cond, warn);
    if (room === "贸易站")
      return parseTradeEffects(pt, target, groups, cond, warn, name);
    if (room === "宿舍")
      return parseDormEffects(pt, target, groups, cond, warn);
    return parseValueEffects(pt, target, groups, cond, warn);
  };

  // 剥离"进驻发电站时/进驻制造站后，"这类引导语（所有技能描述共有的前缀，避免干扰后续正则）
  text = text.replace(/^进驻[^，]*?[时后]，/, "");

  // 各段分别解析（主效果段无条件；条件段带 condition）。
  // 心情消耗（moodCost）在**各段内部**提取：若描述为"如果…时，…心情每小时消耗+X"，
  // 则该消耗属于条件内（如复奏/奥达/霍尔海雅/和弦/予愿安洁莉娜 onlySelf 时 +1/+2）；
  // 无条件段（如空构"自身心情每小时消耗-0.3"）则无条件生效。
  const parsePart = (partText, cond) => {
    let pt = partText;
    let mm;
    // 办公室/制造站/贸易站/宿舍：心情消耗统一由各自专用解析器处理；
    //        此处不提取（贸易站含"全体心情"scope:room 与专用特判顺序，不可被固定值误配）
    if (
      room !== "办公室" &&
      room !== "制造站" &&
      room !== "贸易站" &&
      room !== "宿舍"
    ) {
      if ((mm = pt.match(/心情每小时消耗([+-]?\d+(?:\.\d+)?)/))) {
        const eff = { target, stat: "moodCost", value: Number(mm[1]) };
        if (cond) eff.condition = cond;
        effects.push(eff);
        pt = pt.replace(/心情每小时消耗[+-]?\d+(?:\.\d+)?/, "");
      }
    }
    const sub = valueParser(pt, cond);
    effects.push.apply(effects, sub);
  };
  // 订单规则类技能（慧眼独到/特别订单/天真的谈判者/合同法/违约索赔/投资）：
  //   描述中的"如果…则…"是规则语境而非条件（由计算层按订单类型判定），整段直接入解析器（不拆条件）
  const TRADE_RAW_NAMES = [
    "慧眼独到",
    "特别订单",
    "天真的谈判者",
    "合同法",
    "违约索赔·α",
    "违约索赔·β",
    "投资·α",
    "投资·β",
  ];
  if (room === "贸易站" && TRADE_RAW_NAMES.indexOf(name || "") >= 0) {
    parsePart(text, null);
    return effects;
  }

  // 贸易站：分号拆段（「主；当XX在基建内时（不包含副手及活动室使用者），额外+Y%」等；
  //   主段递归解析（无分号走下方句式拆分），副段各自提取条件句。须在句式拆分之前执行。
  if (room === "贸易站" && String(text).indexOf("；") >= 0) {
    const segs = String(text)
      .split(/；/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (segs.length > 1) {
      effects.push.apply(
        effects,
        parseSkillDesc(segs.shift(), room, warn, name),
      );
      segs.forEach((seg) => {
        let m2;
        if (
          (m2 = seg.match(
            /^当([^，]+?)(?:入驻工作场所|在基建内)时(?:（([^）]*)）)?，(.*)$/,
          ))
        ) {
          // 「伊内丝、W入驻工作场所时（不包含副手）」→ 每名各一个效果（各自 +Y%）；
          //   opInBase = 基建内任意设施（用户口径：赫德雷描述有误，加工站也算工作场所）；
          //   （"不包含副手及活动室使用者"：副手=控制中枢副手位（模拟器未建模）→ 无对应词条，括号文本忽略）
          const names = m2[1]
            .split(/、/)
            .map((s) => s.trim())
            .filter(Boolean);
          const isWorkspace = seg.indexOf("入驻工作场所") >= 0;
          names.forEach((nm) => {
            const cond = { type: "opInBase", op: nm };
            if (isWorkspace) cond.facilities = WORKSPACE_FACS;
            parsePart(m2[3], cond);
          });
        } else if ((m2 = seg.match(/^当与([^，]+?)在同一个(.+?)时，(.*)$/))) {
          parsePart(m2[3], {
            type: "opAtFacility",
            op: m2[1],
            facility: "same",
          });
        } else if ((m2 = seg.match(/^当前贸易站内存在(.+?)干员时，(.*)$/))) {
          parsePart(m2[2], {
            type: "opGroupInFacility",
            group: groupKey(m2[1], groups, warn),
            facility: "same",
          });
        } else if ((m2 = seg.match(/^(?:如果|若)([^，]+?)[，则](.*)$/))) {
          parsePart(m2[2], condFromText(m2[1], groups, warn));
        } else {
          parsePart(seg, null);
        }
      });
      return effects;
    }
  }

  // 1) 条件结构拆分（按句式优先级，主效果在前）
  //    宿舍技能："如果目标是XX，则恢复效果额外+Y"（目标限定）与"如果该宿舍内有其他干员，则…"（线性）
  //    是效果内部语义而非条件句，整段交给 parseDormEffects（不拆分）；
  //    "如果自身为满心情，则与当前宿舍前一位进驻的干员互换心情"（菲亚梅塔·患难之交）同属规则句。
  if (
    room === "宿舍" &&
    (text.indexOf("如果目标") >= 0 ||
      text.indexOf("如果该宿舍内有其他干员") >= 0 ||
      text.indexOf("互换心情") >= 0)
  ) {
    parsePart(text, null);
    return effects;
  }
  if ((m = text.match(/^(.+?)，若(.+?)，则(.+)$/))) {
    // 主，若条件，则结果（罗德岛隐秘队）
    parsePart(m[1], null);
    parsePart(m[3], condFromText(m[2], groups, warn));
  } else if ((m = text.match(/^(.+?)，如果(.+?)，则(.+)$/))) {
    // 主，如果条件，则结果
    parsePart(m[1], null);
    parsePart(m[3], condFromText(m[2], groups, warn));
  } else if ((m = text.match(/^如果(.+?)，则(.+)$/))) {
    // 如果条件，则结果（信仰搅拌机）
    parsePart(m[2], condFromText(m[1], groups, warn));
  } else if ((m = text.match(/^如果(.+?)，(.+)$/))) {
    // 如果条件时，结果（复奏/奥达/霍尔海雅/和弦/风丸/予愿安洁莉娜）
    parsePart(m[2], condFromText(m[1], groups, warn));
  } else if ((m = text.match(/^(.+?)，当与(.+?)在同一个(.+?)时，(.+)$/))) {
    // 主，当与XX在同一设施时，结果（怒潮凛冬·情同手足）
    parsePart(m[1], null);
    parsePart(
      m[4],
      condFromText("与" + m[2] + "在同一个" + m[3], groups, warn),
    );
  } else if ((m = text.match(/^当与(.+?)在同一个(.+?)时，(.+)$/))) {
    // 当与XX在同一设施时，结果（Miss.Christine/阿兰娜）
    parsePart(
      m[3],
      condFromText("与" + m[1] + "在同一个" + m[2], groups, warn),
    );
  } else if ((m = text.match(/^若(.+?)，则(.+)$/))) {
    // 若条件，则结果（机械师·"我睡过了"）
    parsePart(m[2], condFromText(m[1], groups, warn));
  } else if ((m = text.match(/^若(.+?)，(.+)$/))) {
    // 若条件，结果（无"则"）
    parsePart(m[2], condFromText(m[1], groups, warn));
  } else if ((m = text.match(/^处于线索交流时(.+)$/))) {
    // 处于线索交流时…（响石/跃跃/骋风）
    parsePart(m[1], { type: "clueExchanging" });
  } else if ((m = text.match(/^(.+?)，当与(.+?)进驻会客室一起工作时，(.+)$/))) {
    // 主，当与XX一起工作时，结果（凛视）
    parsePart(m[1], null);
    parsePart(m[3], { type: "opAtFacility", op: m[2], facility: "meeting" });
  } else if ((m = text.match(/^当与(.+?)进驻会客室一起工作时，(.+)$/))) {
    // 当与XX一起工作时，结果（忍冬）
    parsePart(m[2], { type: "opAtFacility", op: m[1], facility: "meeting" });
  } else if (
    (m = text.match(/^(.+?)，与其他(.+?)干员进驻会客室一起工作时，(.+)$/))
  ) {
    // 主，与其他阵营一起工作时，结果（寻澜/提丰）
    parsePart(m[1], null);
    parsePart(m[3], {
      type: "opGroupInFacility",
      group: groupKey(m[2], groups, warn),
      facility: "same",
      other: true,
    });
  } else if ((m = text.match(/^与其他(.+?)干员进驻会客室一起工作时，(.+)$/))) {
    // 与其他阵营一起工作时，结果
    parsePart(m[2], {
      type: "opGroupInFacility",
      group: groupKey(m[1], groups, warn),
      facility: "same",
      other: true,
    });
  } else if ((m = text.match(/^当(.+?时)，(.+)$/))) {
    // 当条件时，结果（铅踝·窗外雪啸；须在会客室"当与XX一起工作"句式之后）
    parsePart(m[2], condFromText(m[1].replace(/时$/, ""), groups, warn));
  } else {
    parsePart(text, null);
  }
  return effects;
}

// ===== 主流程 =====
function main() {
  const characterTable = JSON.parse(
    fs.readFileSync(CHARACTER_TABLE_PATH, "utf8"),
  );
  const buildingData = JSON.parse(fs.readFileSync(BUILDING_DATA_PATH, "utf8"));
  const gamedataConst = JSON.parse(
    fs.readFileSync(GAMEDATA_CONST_PATH, "utf8"),
  );
  const buffs = buildingData.buffs ?? {};
  const termDescriptions = gamedataConst.termDescriptionDict ?? {};
  configureFacilityTerms(termDescriptions);

  TERM_BY_NAME = new Map();
  Object.entries(termDescriptions).forEach(([key, term]) => {
    if (term?.termName) TERM_BY_NAME.set(String(term.termName), key);
  });

  let moodCheck = null;
  if (fs.existsSync(MOOD_CHECK_PATH)) {
    const source = JSON.parse(fs.readFileSync(MOOD_CHECK_PATH, "utf8"));
    moodCheck = source?.skills ?? null;
  }

  const byOperator = new Map();
  let skippedFacilitySkillCount = 0;
  let missingBuffCount = 0;
  for (const [id, character] of Object.entries(characterTable)) {
    if (!id.startsWith("char_") || !character?.name) continue;
    const records = [];
    for (const [slotIndex, slotData] of (character.buffChar ?? []).entries()) {
      for (const buffData of slotData.buffData ?? []) {
        const buff = buffs[buffData.buffId ?? ""];
        if (!buff) {
          missingBuffCount += 1;
          continue;
        }
        const room = ROOM_TYPE_MAP[buff.roomType ?? ""];
        if (!room) continue;
        if (room === "recycle") continue;
        if (!OUTPUT_ROOMS.has(room)) {
          skippedFacilitySkillCount += 1;
          continue;
        }
        records.push({
          id,
          name: character.name,
          slot: slotIndex + 1,
          room,
          roomLabel: ROOM_LABELS[room],
          condition: buffData.cond,
          skillName: buff.buffName ?? buffData.buffId ?? "未命名技能",
          description: buff.description ?? "",
        });
      }
    }
    byOperator.set(id, {
      name: character.name,
      rarity: rarityValue(character.rarity),
      records,
    });
  }

  for (const [id, recycleOperator] of Object.entries(
    buildingData.recycleOperators ?? {},
  )) {
    const character = characterTable[id];
    const operator = byOperator.get(id) ?? {
      name: character?.name ?? recycleOperator.name,
      rarity: rarityValue(character?.rarity),
      records: [],
    };
    for (const buffData of recycleOperator.buffData ?? []) {
      const buff = buildingData.recycleBuffs?.[buffData.buffId ?? ""];
      if (!buff) {
        missingBuffCount += 1;
        continue;
      }
      operator.records.push({
        id,
        name: character?.name ?? recycleOperator.name,
        slot: 1,
        room: "recycle",
        roomLabel: ROOM_LABELS.recycle,
        condition: buffData.cond,
        skillName: buff.buffName ?? buffData.buffId ?? "未命名技能",
        description: buff.description ?? "",
        efficiency: buff.efficiency,
      });
    }
    byOperator.set(id, operator);
  }

  if (!fs.existsSync(PACKAGE_OPERATOR_DIR)) {
    fs.mkdirSync(PACKAGE_OPERATOR_DIR, { recursive: true });
  }
  for (const fileName of fs.readdirSync(PACKAGE_OPERATOR_DIR)) {
    if (fileName.endsWith(".json")) {
      fs.unlinkSync(path.join(PACKAGE_OPERATOR_DIR, fileName));
    }
  }

  let warnCount = 0;
  let skillCount = 0;
  const warn = (message) => {
    console.warn("  ⚠ " + message);
    warnCount += 1;
  };

  for (const [id, operator] of byOperator) {
    const { name, rarity, records } = operator;
    const slotMap = new Map();
    records.forEach((record) => {
      const key = `${record.room}#${record.slot}`;
      if (!slotMap.has(key))
        slotMap.set(key, { room: record.room, slot: record.slot, records: [] });
      slotMap.get(key).records.push(record);
    });

    const chains = [...slotMap.values()]
      .sort(
        (left, right) =>
          left.slot - right.slot ||
          ROOM_ORDER.indexOf(left.room) - ROOM_ORDER.indexOf(right.room),
      )
      .map(({ room, slot, records: chainRecords }) => {
        const stages = chainRecords.map((record) => {
          const unlock = parseUnlock(record.condition) ?? {
            type: "elite",
            value: 0,
          };
          const effects =
            record.room === "recycle" && Number.isFinite(record.efficiency)
              ? [
                  {
                    target: "recycle",
                    stat: "recycleSpd",
                    value: record.efficiency,
                    text: record.description,
                  },
                ]
              : parseSkillDesc(
                  record.description,
                  record.roomLabel,
                  (message) => warn(`[${id}] ${record.skillName}：${message}`),
                  record.skillName,
                  id,
                );
          if (moodCheck?.[record.name]?.[record.skillName] === true) {
            effects.forEach((effect) => {
              if (effect.condition) effect.condition.moodCheck = true;
              if (effect.per) effect.per.moodCheck = true;
            });
          }
          skillCount += 1;
          return { unlock, name: record.skillName, effects };
        });
        stages.sort((left, right) => {
          const rank = (unlock) =>
            unlock.type === "elite" ? unlock.value : unlock.value / 1000;
          return rank(left.unlock) - rank(right.unlock);
        });
        return { slot, room, stages };
      });

    const output = {
      schemaVersion: SCHEMA_VERSION,
      id,
      name,
      rarity,
      chains,
    };
    fs.writeFileSync(
      path.join(PACKAGE_OPERATOR_DIR, `${id}.json`),
      `${JSON.stringify(output, null, 2)}\n`,
      "utf8",
    );
    console.log(
      `✓ ${name} (${id})：${chains.map((chain) => `槽${chain.slot}@${chain.room}×${chain.stages.length}阶段`).join("、")}`,
    );
  }

  fs.mkdirSync(PACKAGE_DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(PACKAGE_DATA_DIR, "terms.json"),
    `${JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        terms: sharedTerms(termDescriptions, characterTable),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const rulesetData = ruleset();
  fs.writeFileSync(
    path.join(PACKAGE_DATA_DIR, "ruleset.json"),
    `${JSON.stringify(rulesetData, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(PACKAGE_DATA_DIR, "manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        rulesetVersion: rulesetData.version,
        gameDataVersion: "torappu-latest",
        generatedAt: new Date().toISOString(),
        operators: "operators",
        terms: "terms.json",
        ruleset: "ruleset.json",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log("----");
  console.log(`生成完成：${byOperator.size} 名干员 / ${skillCount} 条技能`);
  console.log(`输出目录：${PACKAGE_OPERATOR_DIR}`);
  console.log(
    `跳过暂缓设施技能：${skippedFacilitySkillCount} 条（加工站/训练室）`,
  );
  if (missingBuffCount > 0) console.log(`缺失技能定义：${missingBuffCount} 条`);
  console.log(
    `警告：${warnCount} 条${warnCount ? "（需人工校对或增加覆盖规则）" : ""}`,
  );
  if (warnCount > 0) process.exitCode = 2;
}

main();
