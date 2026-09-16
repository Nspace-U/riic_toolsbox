import type {
  CluePreference,
  MoodRateDetail,
  MoodSnapshot,
  OperatorEfficiencyDetail,
  ProductionValue,
} from "@/types/efficiency";
import { canonicalResourceKey, PRODUCT_LABELS } from "@/utils/schedule";

export function planDurationHoursValue(plan: { duration?: number }): number {
  const minutes = Number(plan.duration ?? 720);
  return Math.round((minutes / 60) * 100) / 100;
}

export function formatNumber(value: number, maximumFractionDigits = 2): string {
  return value.toLocaleString("zh-CN", {
    maximumFractionDigits,
    useGrouping: false,
  });
}

export function formatEfficiencyNumber(value: number): string {
  return value < 0 ? `-${formatNumber(Math.abs(value))}` : formatNumber(value);
}

export function signedNumber(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
}

export function operatorCalculationLines(
  detail: OperatorEfficiencyDetail,
): string[] {
  const calculation = detail.calculation;
  if (!calculation) {
    return [];
  }
  if (calculation.type === "tradeGap") {
    const mode = calculation.mode === "max" ? "最大效率" : "积分平均";
    const lines = [
      `模式：${mode}`,
      `差值基数：${formatNumber(calculation.gapBase)} × ${formatNumber(
        calculation.gapValue / Math.max(calculation.gapBase, 1),
      )}% = ${formatNumber(calculation.gapValue)}%`,
    ];
    if (calculation.mode === "integral") {
      lines.push(
        `期望单耗时：${formatNumber(
          calculation.expectedOrderHours ?? 0,
        )} 小时，首件进度：${formatNumber(
          calculation.firstItemProgress * 100,
        )}%`,
        `完成订单：${formatNumber(calculation.completedOrders)}，每单衰减：-${formatNumber(
          calculation.decrement,
        )}%`,
        `整站效率平均：${formatNumber(
          calculation.averageEfficiency,
        )}%（初始 ${formatNumber(calculation.initialEfficiency)}%）`,
      );
    }
    if (calculation.fallbackReason) {
      lines.push(
        calculation.fallbackReason === "fixedOrder"
          ? "固定订单不参与逐单衰减，按最大效率计算"
          : "没有可用的订单分布，按最大效率计算",
      );
    }
    return lines;
  }
  if (calculation.type === "workHours") {
    const efficiencyLine =
      calculation.durationHours > 0
        ? `效率：${formatNumber(calculation.baseValue)}% × ${formatNumber(
            calculation.activeHours,
          )} ÷ ${formatNumber(calculation.durationHours)} = ${formatNumber(
            detail.value,
          )}%`
        : "效率：队列时长为 0，结果为 0%";
    return [
      `累计工作时长：${formatNumber(
        calculation.beforeHours,
      )} + ${formatNumber(calculation.durationHours)} = ${formatNumber(
        calculation.beforeHours + calculation.durationHours,
      )} 小时（阈值 ${formatNumber(calculation.threshold)} 小时）`,
      `生效时长：max(0, min(${formatNumber(
        calculation.durationHours,
      )}, ${formatNumber(calculation.beforeHours)} + ${formatNumber(
        calculation.durationHours,
      )} - ${formatNumber(calculation.threshold)})) = ${formatNumber(
        calculation.activeHours,
      )} 小时`,
      efficiencyLine,
    ];
  }
  const capIndex = calculation.steps.findIndex(
    (step) => step.value >= calculation.cap,
  );
  const uncappedSteps =
    capIndex >= 0 ? calculation.steps.slice(0, capIndex) : calculation.steps;
  const cappedWeight =
    capIndex >= 0
      ? calculation.steps
          .slice(capIndex)
          .reduce((total, step) => total + step.weight, 0)
      : 0;
  const weightedTerms = [
    ...uncappedSteps.map(
      (step) => `${formatNumber(step.value)} × ${formatNumber(step.weight)}`,
    ),
    ...(capIndex >= 0
      ? [`${formatNumber(calculation.cap)} × ${formatNumber(cappedWeight)}`]
      : []),
  ].join(" + ");
  const weightedTotal = calculation.steps.reduce(
    (total, step) => total + step.value * step.weight,
    0,
  );
  const weightedAverage =
    calculation.durationHours > 0
      ? weightedTotal / calculation.durationHours
      : 0;
  const lines = [
    `累计工作时长：${formatNumber(
      calculation.beforeHours,
    )} + ${formatNumber(calculation.durationHours)} = ${formatNumber(
      calculation.beforeHours + calculation.durationHours,
    )} 小时`,
    `档位公式：min(${formatNumber(
      calculation.startValue,
    )} + (累计时长 + h - ${formatNumber(
      calculation.startHours,
    )}) × ${formatNumber(calculation.step)}, ${formatNumber(calculation.cap)})`,
    calculation.durationHours > 0
      ? `加权平均：(${weightedTerms || "0"}) ÷ ${formatNumber(
          calculation.durationHours,
        )} = ${formatNumber(detail.value)}%`
      : "加权平均：队列时长为 0，结果为 0%",
  ];
  if (calculation.workHours) {
    const efficiencyLine =
      calculation.durationHours > 0
        ? `效率：${formatNumber(weightedAverage)}% × ${formatNumber(
            calculation.workHours.activeHours,
          )} ÷ ${formatNumber(calculation.durationHours)} = ${formatNumber(
            detail.value,
          )}%`
        : "效率：队列时长为 0，结果为 0%";
    lines.push(
      `工作时长条件：生效 ${formatNumber(
        calculation.workHours.activeHours,
      )} 小时 / ${formatNumber(calculation.durationHours)} 小时`,
      efficiencyLine,
    );
  }
  return lines;
}

export interface OperatorCalculationRow {
  label?: string;
  value: string;
}

export function operatorCalculationRows(
  detail: OperatorEfficiencyDetail,
): OperatorCalculationRow[] {
  return operatorCalculationLines(detail).map((line) => {
    const separatorIndex = line.indexOf("：");
    if (separatorIndex < 0) {
      return { value: line };
    }
    return {
      label: line.slice(0, separatorIndex + 1),
      value: line.slice(separatorIndex + 1).trimStart(),
    };
  });
}

export function formatProduction(value: number): string {
  return formatNumber(value, 3);
}

const RESOURCE_LABELS: Record<string, string> = {
  ...PRODUCT_LABELS,
  线索: "线索",
  无人机: "无人机",
  信用: "信用",
  公开招募标签刷新次数: "公开招募标签刷新次数",
  固源岩: "固源岩",
  装置: "装置",
};

export function resourceLabel(resource: string): string {
  const canonicalResource = canonicalResourceKey(resource);
  return RESOURCE_LABELS[canonicalResource] ?? canonicalResource;
}

export function productionLabel(product: string): string {
  return resourceLabel(product);
}

export function cluePreferenceText(
  preferences: CluePreference[] | undefined,
): string {
  if (!preferences?.length) {
    return "";
  }
  return `更容易获得${preferences
    .map((preference) => {
      if (typeof preference === "number") {
        return `线索${preference}`;
      }
      return preference === "unowned" ? "尚未拥有的线索" : "已经拥有的线索";
    })
    .join("、")}`;
}

export function convertedProductionAmount(
  value: ProductionValue,
  amount: number,
): number {
  return amount * (value.conversion?.amountPerUnit ?? 1);
}

export function moodRateDetailLabel(detail: MoodRateDetail): string {
  if (detail.kind === "base") {
    return "基础消耗速度";
  }
  if (detail.kind === "controlWorkers") {
    return `控制中枢干员减耗（${detail.count ?? 0}人）`;
  }
  if (detail.kind === "facilityWorkers") {
    return `同设施干员减耗（${detail.count ?? 0}人）`;
  }
  const source = [detail.operator, detail.skill].filter(Boolean).join(" · ");
  return `${source || "技能"}${detail.stat === "moodRecover" ? "恢复" : "消耗"}`;
}

export function moodRateFormula(mood: MoodSnapshot): string {
  const [first, ...rest] = mood.rateDetails;
  if (!first) {
    return `0 = ${formatNumber(mood.costRate)}/小时`;
  }
  return `${formatNumber(first.value)}${rest
    .map(
      (detail) =>
        ` ${detail.value >= 0 ? "+" : "-"} ${formatNumber(Math.abs(detail.value))}`,
    )
    .join("")} = ${formatNumber(mood.costRate)}/小时`;
}

const EFFICIENCY_STAT_LABELS: Record<string, string> = {
  tradeSpd: "贸易效率",
  tradeGapEff: "订单差值效率",
  tradeNetEff: "贸易净效率",
  manuProd: "制造效率",
  clueSpeed: "线索速度",
  clueChance: "线索概率",
  hireSpd: "公开招募效率",
  droneCharge: "无人机充能",
  orderLimit: "订单上限",
  storageCap: "仓库容量",
  facBase: "设施基础效率",
  abyssalBoost: "深海效果",
  moodRecover: "心情恢复",
  moodCost: "心情消耗",
  facilityCount: "设施数量",
  basePointGain: "基地点数产出",
  basePointConvert: "基地点数转化",
  tradeOrder: "订单规则",
  zeroOpMood: "干员心情清除",
  zeroOpBonus: "干员效率清除",
  moodSwap: "心情交换",
  skillTagConvert: "技能类别转换",
  operatorTraining: "干员练度效率",
};

const PERCENTAGE_EFFICIENCY_STATS = new Set([
  "tradeSpd",
  "tradeGapEff",
  "tradeNetEff",
  "manuProd",
  "clueSpeed",
  "clueChance",
  "hireSpd",
  "droneCharge",
  "facBase",
  "abyssalBoost",
  "operatorTraining",
]);

export function efficiencyStatLabel(stat: string): string {
  return EFFICIENCY_STAT_LABELS[stat] ?? "其他效果";
}

export function efficiencyStatValue(stat: string, value: number): string {
  return `${signedNumber(value)}${
    PERCENTAGE_EFFICIENCY_STATS.has(stat) ? "%" : ""
  }`;
}

export function productionMaterialsForDisplay(
  value: ProductionValue,
  effective = false,
): string[] {
  const materials = effective
    ? (value.effectiveMaterialPerHour ?? value.materialPerHour)
    : value.materialPerHour;
  return Object.entries(materials ?? {}).map(
    ([material, amount]) =>
      `${resourceLabel(material)} ${signedNumber(amount)}/小时`,
  );
}

export function formatDurationHours(value: number): string {
  return `${formatNumber(value)} 小时`;
}

export function productionRateLabel(value: ProductionValue): string {
  return value.itemRate === undefined
    ? ""
    : `${formatProduction(value.itemRate)} / 小时`;
}

export function facilityOverflowLabel(value: ProductionValue): string {
  if (value.overflowed === undefined) {
    return "未启用容量模拟";
  }
  return value.overflowed ? "计划内会爆仓" : "计划内不爆仓";
}
