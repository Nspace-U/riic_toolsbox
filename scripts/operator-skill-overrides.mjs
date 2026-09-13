// 当前数据源无法从技能描述稳定推导的效率语义。
// 普通固定值、术语引用、设施集合和阵营计数必须由生成器解析，不应继续堆在这里。

const CONTROL = "control";
const MANUFACTURE = "manufacture";
const TRADING = "trading";

export const OPERATOR_SKILL_OVERRIDES = {
  // “外势/实地”同时承担设施数量产出和二选一的控制中枢加成，描述文本不足以安全拆分。
  "char_2027_wang#权变": [
    {
      target: "any",
      stat: "basePointGain",
      term: "cc.bd_wang_1",
      per: { per: 1, value: 1, source: "facilityCount", facility: TRADING },
    },
    {
      target: "any",
      stat: "basePointGain",
      term: "cc.bd_wang_1",
      per: { per: 1, value: 1, source: "facilityCount", facility: "power" },
    },
    {
      target: "any",
      stat: "basePointGain",
      term: "cc.bd_wang_2",
      per: { per: 1, value: 1, source: "facilityCount", facility: MANUFACTURE },
    },
    {
      target: TRADING,
      stat: "tradeSpd",
      value: 7,
      stack: "max",
      condition: {
        type: "termCmp",
        a: "cc.bd_wang_1",
        b: "cc.bd_wang_2",
        op: "ge",
      },
    },
    {
      target: MANUFACTURE,
      stat: "manuProd",
      value: 2,
      stack: "max",
      condition: {
        type: "termCmp",
        a: "cc.bd_wang_1",
        b: "cc.bd_wang_2",
        op: "lt",
      },
    },
  ],
  "char_1044_hsgma2#共事情谊": [
    {
      target: MANUFACTURE,
      stat: "manuProd",
      value: 3,
      stack: "max",
      condition: {
        type: "opGroupInFacility",
        group: "cc.g.lgd",
        facility: "same",
        other: true,
        moodCheck: true,
      },
    },
  ],
  // “市井之道”同时读取其他干员提供的效率和当前订单数，无法归结为普通固定值。
  "char_272_strong#市井之道": [
    {
      target: TRADING,
      stat: "orderLimit",
      per: {
        per: 10,
        value: -1,
        source: "stat",
        stat: "tradeSpd",
        other: true,
      },
    },
    {
      target: TRADING,
      stat: "tradeSpd",
      per: { per: 1, value: 4, source: "orderCount" },
    },
  ],
  "char_226_hmau#坚毅随和": [
    {
      target: CONTROL,
      stat: "moodRecover",
      scope: "room",
      per: {
        per: 1,
        value: 0.05,
        source: "opGroupInFacility",
        group: "cc.g.lda",
        facility: "same",
      },
    },
    {
      target: "any",
      stat: "moodRecover",
      scopeGroup: "cc.g.lda",
      per: {
        per: 1,
        value: 0.2,
        source: "opGroupInFacility",
        group: "cc.g.lda",
        facility: "same",
      },
    },
  ],
  "char_474_glady#潮汐守望": [
    {
      target: CONTROL,
      stat: "moodCost",
      per: {
        per: 1,
        value: 0.5,
        source: "opGroupInBase",
        group: "cc.g.abyssal",
        exclude: ["dormitory"],
      },
    },
    {
      target: CONTROL,
      stat: "moodRecover",
      value: 0.5,
      condition: {
        type: "opGroupCountInBase",
        group: "cc.g.abyssal",
        exclude: ["dormitory"],
        other: true,
        min: 1,
        negate: true,
      },
    },
    {
      target: CONTROL,
      stat: "moodRecover",
      per: {
        per: 1,
        value: 0.5,
        source: "opGroupInFacility",
        group: "cc.g.abyssal",
        facility: "dormitory",
        fullMood: true,
      },
    },
  ],
  "char_474_glady#集群狩猎·α": [
    { target: CONTROL, stat: "moodRecover", value: 0.05, scope: "room" },
    {
      target: MANUFACTURE,
      stat: "abyssalBoost",
      per: {
        per: 1,
        value: 5,
        cap: 45,
        capUnit: "value",
        source: "abyssalBoost",
        group: "cc.g.abyssal",
      },
    },
  ],
  "char_474_glady#集群狩猎·β": [
    { target: CONTROL, stat: "moodRecover", value: 0.05, scope: "room" },
    {
      target: MANUFACTURE,
      stat: "abyssalBoost",
      per: {
        per: 1,
        value: 10,
        cap: 90,
        capUnit: "value",
        source: "abyssalBoost",
        group: "cc.g.abyssal",
      },
    },
  ],
  "char_479_sleach#感染力": [
    {
      target: "hire",
      stat: "hireSpd",
      value: 20,
      stack: "max",
      condition: { type: "statCmp", stat: "hireSpd", value: 30, op: "lt" },
    },
  ],
  "char_154_morgan#头号陪练": [
    {
      target: "dormitory",
      stat: "moodRecover",
      value: 0.3,
      scope: "room",
      scopeGroup: "cc.g.glasgow",
      subjects: "single",
      stack: "max",
      maxGroup: "dormRec-single",
      condition: { type: "opAtFacility", op: "推进之王", facility: "same" },
    },
  ],
};

export function overrideKey(id, skillName) {
  return `${id}#${skillName}`;
}
