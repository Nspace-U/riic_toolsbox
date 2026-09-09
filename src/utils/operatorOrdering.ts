const PROFESSION_ORDER = [
  "先锋",
  "近卫",
  "重装",
  "狙击",
  "术师",
  "医疗",
  "辅助",
  "特种",
] as const;

const BRANCH_ORDER_BY_PROFESSION: Record<string, readonly string[]> = {
  先锋: ["尖兵", "冲锋手", "执旗手", "战术家", "情报官", "策士"],
  近卫: [
    "无畏者",
    "领主",
    "强攻手",
    "教官",
    "斗士",
    "术战者",
    "剑豪",
    "武者",
    "收割者",
    "解放者",
    "重剑手",
    "撼地者",
    "本源近卫",
    "佣兵",
  ],
  重装: [
    "铁卫",
    "守护者",
    "哨戒铁卫",
    "不屈者",
    "驭法铁卫",
    "决战者",
    "要塞",
    "本源铁卫",
  ],
  狙击: [
    "速射手",
    "炮手",
    "重射手",
    "神射手",
    "散射手",
    "攻城手",
    "投掷手",
    "猎手",
    "回环射手",
    "裂空炮手",
  ],
  术师: [
    "扩散术师",
    "中坚术师",
    "轰击术师",
    "链术师",
    "驭械术师",
    "阵法术师",
    "秘术师",
    "本源术师",
    "塑灵术师",
  ],
  医疗: ["医师", "群愈师", "疗养师", "行医", "咒愈师", "链愈师", "守望者"],
  辅助: [
    "凝滞师",
    "召唤师",
    "吟游者",
    "削弱者",
    "护佑者",
    "工匠",
    "巫役",
    "游击手",
  ],
  特种: [
    "钩索师",
    "处决者",
    "推击手",
    "伏击客",
    "怪杰",
    "行商",
    "陷阱师",
    "傀儡师",
    "炼金师",
    "巡空者",
  ],
};

function sortValuesByOrder(
  values: string[],
  order: readonly string[],
): string[] {
  const orderIndexes = new Map(order.map((value, index) => [value, index]));
  return [...new Set(values)]
    .map((value, index) => ({ value, index }))
    .sort((left, right) => {
      const leftIndex = orderIndexes.get(left.value) ?? order.length;
      const rightIndex = orderIndexes.get(right.value) ?? order.length;
      return leftIndex - rightIndex || left.index - right.index;
    })
    .map(({ value }) => value);
}

export function sortProfessionValues(values: string[]): string[] {
  return sortValuesByOrder(values, PROFESSION_ORDER);
}

export function sortBranchValues(
  profession: string,
  values: string[],
): string[] {
  return sortValuesByOrder(
    values,
    BRANCH_ORDER_BY_PROFESSION[profession] ?? [],
  );
}
