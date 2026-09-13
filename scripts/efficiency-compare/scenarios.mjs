const operator = (name, elite = 0, level = 1, mood = 24) => ({
  name,
  elite,
  level,
  mood,
});

export const scenarios = [
  {
    id: "all-facilities",
    title: "全设施基础产出",
    durationHours: 12,
    layout: [
      ["control", 5],
      ["trading", 3],
      ["manufacture", 3],
      ["power", 3],
      ["meeting", 3],
      ["hire", 3],
      ["dormitory", 5],
    ],
    assignments: {
      control: [[operator("阿米娅")]],
      trading: [[operator("德克萨斯")]],
      manufacture: [[operator("夜烟")]],
      power: [[operator("Lancet-2")]],
      meeting: [[operator("陈", 2, 30)]],
      hire: [[operator("琴柳", 2, 30)]],
      dormitory: [[]],
    },
  },
  {
    id: "trade-basic",
    title: "贸易站基础与中枢加成",
    durationHours: 12,
    layout: [
      ["control", 5],
      ["trading", 3],
    ],
    assignments: {
      control: [[operator("阿米娅")]],
      trading: [[operator("德克萨斯")]],
    },
  },
  {
    id: "trade-zi",
    title: "孑的订单上限与效率",
    durationHours: 12,
    settings: {
      tradeZiMax: false,
      tradeZiProgress: 0,
    },
    layout: [
      ["control", 5],
      ["trading", 3],
    ],
    assignments: {
      control: [[operator("阿米娅")]],
      trading: [[operator("孑")]],
    },
  },
  {
    id: "trade-zi-rotation",
    title: "孑的订单递减与空队列轮换",
    durationHours: 12,
    settings: {
      tradeZiMax: false,
      tradeZiProgress: 0,
    },
    layout: [
      ["control", 5],
      ["trading", 3],
    ],
    assignments: {
      control: [[[operator("阿米娅")], []]],
      trading: [[[operator("孑")], []]],
    },
    repeat: 2,
  },
  {
    id: "trade-pepe",
    title: "佩佩固定订单",
    durationHours: 12,
    layout: [
      ["control", 5],
      ["trading", 3],
    ],
    assignments: {
      control: [[operator("阿米娅")]],
      trading: [[operator("佩佩", 2, 1)]],
    },
  },
  {
    id: "trade-pepe-rotation",
    title: "佩佩固定订单与空队列轮换",
    durationHours: 12,
    repeat: 2,
    layout: [
      ["control", 5],
      ["trading", 3],
    ],
    assignments: {
      control: [[[operator("阿米娅")], []]],
      trading: [[[operator("佩佩", 2, 1)], []]],
    },
  },
  {
    id: "trade-kexi",
    title: "可露希尔固定订单",
    durationHours: 12,
    layout: [
      ["control", 5],
      ["trading", 3],
    ],
    assignments: {
      control: [[operator("阿米娅")]],
      trading: [[operator("可露希尔", 2, 1)]],
    },
  },
  {
    id: "trade-kexi-rotation",
    title: "可露希尔固定订单与空队列轮换",
    durationHours: 12,
    repeat: 2,
    layout: [
      ["control", 5],
      ["trading", 3],
    ],
    assignments: {
      control: [[[operator("阿米娅")], []]],
      trading: [[[operator("可露希尔", 2, 1)], []]],
    },
  },
  {
    id: "trade-danshu",
    title: "但书违约索赔",
    durationHours: 12,
    layout: [
      ["control", 5],
      ["trading", 3],
    ],
    assignments: {
      control: [[operator("阿米娅")]],
      trading: [[operator("但书")]],
    },
  },
  {
    id: "trade-danshu-rotation",
    title: "但书违约索赔与空队列轮换",
    durationHours: 12,
    repeat: 2,
    layout: [
      ["control", 5],
      ["trading", 3],
    ],
    assignments: {
      control: [[[operator("阿米娅")], []]],
      trading: [[[operator("但书", 2, 1)], []]],
    },
  },
  {
    id: "trade-longshegan",
    title: "龙舌兰投资",
    durationHours: 12,
    layout: [
      ["control", 5],
      ["trading", 3],
    ],
    assignments: {
      control: [[operator("阿米娅")]],
      trading: [[operator("龙舌兰")]],
    },
  },
  {
    id: "trade-longshegan-rotation",
    title: "龙舌兰投资与空队列轮换",
    durationHours: 12,
    repeat: 2,
    layout: [
      ["control", 5],
      ["trading", 3],
    ],
    assignments: {
      control: [[[operator("阿米娅")], []]],
      trading: [[[operator("龙舌兰", 2, 1)], []]],
    },
  },
  {
    id: "trade-uofficial",
    title: "U-Official金额替换",
    durationHours: 12,
    layout: [
      ["control", 5],
      ["trading", 3],
    ],
    assignments: {
      control: [[operator("阿米娅")]],
      trading: [[operator("U-Official")]],
    },
  },
  {
    id: "trade-uofficial-rotation",
    title: "U-Official金额替换与空队列轮换",
    durationHours: 12,
    repeat: 2,
    layout: [
      ["control", 5],
      ["trading", 3],
    ],
    assignments: {
      control: [[[operator("阿米娅")], []]],
      trading: [[[operator("U-Official")], []]],
    },
  },
  {
    id: "manufacture-capacity",
    title: "制造站仓库与配方",
    durationHours: 12,
    layout: [
      ["control", 5],
      ["manufacture", 3],
      ["manufacture", 3],
      ["manufacture", 3],
    ],
    assignments: {
      control: [[operator("凯尔希")]],
      manufacture: [
        [operator("红云"), operator("泡泡"), operator("槐琥")],
        [operator("斯卡蒂"), operator("幽灵鲨"), operator("歌蕾蒂娅")],
        [operator("Mon3tr")],
      ],
    },
    products: ["Pure Gold", "Battle Record", "Originium Shard"],
    sourceMaterials: [undefined, undefined, "固源岩"],
  },
  {
    id: "manufacture-huaihu-stat-cross-facility",
    title: "槐琥属性折算不计跨设施加成",
    durationHours: 12,
    layout: [
      ["power", 3],
      ["manufacture", 3],
    ],
    assignments: {
      power: [[operator("正义骑士号", 0, 30)]],
      manufacture: [[operator("野鬃", 2, 30), operator("槐琥", 2, 30)]],
    },
    products: ["Pure Gold"],
  },
  {
    id: "manufacture-facility-skill-scope",
    title: "制造站设施级技能不计入干员效率",
    durationHours: 12,
    layout: [
      ["control", 5],
      ["manufacture", 3],
    ],
    assignments: {
      control: [
        [
          operator("斩业星熊", 2),
          operator("诗怀雅"),
          operator("焰尾", 2),
          operator("薇薇安娜", 2),
        ],
      ],
      manufacture: [
        [operator("远牙", 2), operator("野鬃", 2), operator("灰毫", 2)],
      ],
    },
    products: ["Battle Record"],
  },
  {
    id: "manufacture-overflow-zero",
    title: "制造站爆仓后效率归零",
    durationHours: 48,
    settings: {
      firstItemProgress: 0.5,
      overflowMode: "zero",
    },
    layout: [
      ["control", 5],
      ["manufacture", 3],
    ],
    assignments: {
      control: [[]],
      manufacture: [[operator("红云"), operator("泡泡"), operator("槐琥")]],
    },
    products: ["Pure Gold"],
  },
  {
    id: "meeting-and-office",
    title: "会客室与办公室基础加成",
    durationHours: 12,
    layout: [
      ["control", 5],
      ["meeting", 3],
      ["hire", 3],
      ["dormitory", 5],
      ["dormitory", 5],
      ["dormitory", 5],
      ["dormitory", 5],
    ],
    assignments: {
      control: [[operator("老鲤"), operator("魔王"), operator("祐天寺若麦")]],
      meeting: [[operator("陈", 2, 30)]],
      hire: [[operator("琴柳", 2, 30)]],
      dormitory: [[], [], [], []],
    },
  },
  {
    id: "base-points",
    title: "基地点数与术语条件",
    durationHours: 12,
    layout: [
      ["control", 5],
      ["manufacture", 3],
      ["manufacture", 3],
      ["trading", 3],
      ["dormitory", 5],
    ],
    assignments: {
      control: [
        [
          operator("望"),
          operator("若叶睦"),
          operator("八幡海铃"),
          operator("迷迭香"),
        ],
      ],
      manufacture: [[operator("塑心")], [operator("爱丽丝")]],
      trading: [[operator("车尔尼")]],
      dormitory: [[operator("森西")]],
    },
  },
  {
    id: "mood-feather-swap",
    title: "菲亚梅塔心情互换",
    durationHours: 12,
    settings: {
      featherFixedOps: ["德克萨斯"],
    },
    layout: [
      ["control", 5],
      ["trading", 3],
      ["dormitory", 5],
    ],
    assignments: {
      control: [[]],
      trading: [[operator("德克萨斯")]],
      dormitory: [[operator("菲亚梅塔", 2, 30)]],
    },
    repeat: 2,
  },
  {
    id: "mood-rate",
    title: "控制中枢与技能心情消耗",
    durationHours: 12,
    layout: [
      ["control", 5],
      ["trading", 3],
      ["manufacture", 3],
    ],
    assignments: {
      control: [[operator("巫恋"), operator("临光"), operator("杜宾")]],
      trading: [[operator("灵知")], [operator("玛恩纳", 2, 90)]],
      manufacture: [[operator("重岳", 2, 90)]],
    },
  },
  {
    id: "mood-operators",
    title: "心情消耗与跨设施恢复",
    durationHours: 12,
    layout: [
      ["control", 5],
      ["trading", 3],
      ["manufacture", 3],
      ["power", 3],
      ["dormitory", 5],
    ],
    assignments: {
      control: [[operator("维什戴尔", 2, 90), operator("拉普兰德", 2, 90)]],
      trading: [[operator("德克萨斯")]],
      manufacture: [[operator("幽灵鲨")]],
      power: [[operator("Lancet-2")]],
      dormitory: [[operator("菲亚梅塔", 2, 90)]],
    },
  },
];

export function scenarioOperatorNames(scenario) {
  return [
    ...new Set(
      Object.values(scenario.assignments ?? {})
        .flat(Infinity)
        .filter(Boolean)
        .map((entry) => entry.name),
    ),
  ];
}

export function scenarioProducts(scenario, type, index) {
  if (type === "trading") {
    return scenario.products?.[index] ?? "LMD";
  }
  if (type !== "manufacture") {
    return undefined;
  }
  return scenario.products?.[index] ?? "Pure Gold";
}

export function scenarioSourceMaterial(scenario, type, index) {
  if (type !== "manufacture") {
    return undefined;
  }
  return scenario.sourceMaterials?.[index];
}
