import type {
  BasePointSource,
  DroneAccelerationDetail,
  EfficiencyPlanResult,
  EfficiencyResult,
  FacilityEfficiencyResult,
  MoodSnapshot,
  OperatorEfficiencyDetail,
} from "../types/efficiency";
import type {
  BasePointColumn,
  BasePointDisplay,
  BasePointView,
  DailyOutputDisplay,
  DisplayCard,
  DisplayEntry,
  DisplayFlatLine,
  DisplayLine,
  DisplayPane,
  DisplayPlanView,
  DisplayRawNumber,
  DisplayRow,
  DisplaySection,
  DisplayTile,
  DisplayValue,
  DroneScenarioView,
  DroneStrategyDisplay,
  FacilityStepsDisplay,
  FacilityStepView,
  ResultDisplay,
  ResultDisplayOptions,
} from "../types/resultDisplay";
import type {
  DailyOutputCard,
  DailyOutputFacilityDetail,
  DailyOutputOrderDetail,
  DailyOutputProductDetail,
  DailyOutputQueueDetail,
  EfficiencyCalculationStepView,
} from "../types/resultPresentation";
import {
  cluePreferenceText,
  convertedProductionAmount,
  efficiencyStatLabel,
  efficiencyStatUnit,
  facilityOverflowLabel,
  formatNumber,
  moodRateDetailLabel,
  moodRateFormula,
  operatorCalculationRows,
  productionLabel,
  productionMaterialsForDisplay,
  resourceLabel,
  signedNumber,
} from "./presentation";
import {
  buildBasePointQueueDetails,
  buildCalculationSteps,
  buildDailyOutputCards,
  buildDailyOutputQueueDetails,
  buildDailySanityAmounts,
  buildDroneScenarioDisplays,
  buildMaaDroneQueueDetails,
  formatBasePointLabel,
  formatBasePointSource,
  formatFacilityResultLabel,
  formatInheritedSourceLabel,
} from "./resultPresentation";
import { ROOM_LABELS } from "./schedule";
import { calculateSanityResult } from "./sanity";

const GROSS_POINTS_KEY = "gross-points";
const NET_KEY = "net";
const NET_RESOURCE_KEY = "net-resource";
const SANITY_KEY = "sanity";
const SANITY_MISSING_KEY = "sanity-missing";

type BuildNumberFormat = "number" | "production" | "efficiency" | "signed";

type BuildPart =
  | string
  | {
      value: number;
      format?: BuildNumberFormat;
      unit?: string;
      muted?: boolean;
    }
  | { text: string; muted?: boolean };

function composeParts(parts: readonly BuildPart[]): DisplayValue {
  let template = "";
  const raws: DisplayRawNumber[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      template += part;
      continue;
    }
    if ("text" in part) {
      template += part.text;
      continue;
    }
    template += `{${raws.length}}`;
    raws.push({
      value: part.value,
      ...(part.format === "signed" ? { signed: true } : {}),
    });
  }
  return raws.length === 0 ? { template } : { template, raws };
}

export function formatDisplayNumber(raw: DisplayRawNumber): string {
  return raw.signed === true
    ? signedNumber(raw.value)
    : formatNumber(raw.value);
}

export function formatDisplayValue(
  value: DisplayValue,
  format: (
    raw: DisplayRawNumber,
    index: number,
  ) => string = formatDisplayNumber,
): string {
  const raws = value.raws;
  if (raws === undefined || raws.length === 0) {
    return value.template;
  }
  return value.template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const raw = raws[Number(index)];
    return raw === undefined ? match : format(raw, Number(index));
  });
}

function displayValue(...parts: BuildPart[]): DisplayValue {
  return composeParts(parts);
}

function displayText(text: string): DisplayValue {
  return { template: text };
}

function displayNumber(
  value: number,
  format: BuildNumberFormat = "number",
): DisplayValue {
  return composeParts([{ value, format }]);
}

function displayUnit(
  value: number,
  format: BuildNumberFormat,
  unit: string,
): DisplayValue {
  return composeParts([{ value, format }, unit]);
}

function numberPart(
  value: number,
  format: BuildNumberFormat = "number",
  unit?: string,
): BuildPart {
  return unit === undefined ? { value, format } : { value, format, unit };
}

function mutedText(text: string): BuildPart {
  return { text, muted: true };
}

function mutedNumber(
  value: number,
  format: BuildNumberFormat = "number",
  unit?: string,
): BuildPart {
  return {
    value,
    format,
    ...(unit === undefined ? {} : { unit }),
    muted: true,
  };
}

function displayRow(
  key: string,
  label: DisplayValue | undefined,
  value: DisplayValue,
): DisplayRow {
  return {
    key,
    ...(label === undefined ? {} : { label }),
    value,
  };
}

function displaySection(
  key: string,
  label: string | undefined,
  rows: DisplayRow[],
  sections?: DisplaySection[],
): DisplaySection {
  return {
    key,
    ...(label === undefined ? {} : { label }),
    rows,
    ...(sections === undefined ? {} : { sections }),
  };
}

function planLabel(plan: EfficiencyPlanResult, planIndex: number): string {
  return plan.name || `队列${planIndex + 1}`;
}

function durationSubtitle(hours: number): DisplayValue {
  return displayValue(" · ", numberPart(hours, "number", "小时"), " 小时");
}

function inheritedStepLabel(
  step: EfficiencyCalculationStepView,
  result: EfficiencyResult,
): string {
  const facility = step.facility;
  return facility ? formatInheritedSourceLabel(facility, result.plans) : "";
}

function facilityStepSubtitle(
  step: FacilityStepView,
  plan: DisplayPlanView,
): DisplayValue {
  return displayValue(
    " · ",
    numberPart(plan.durationHours, "number", "小时"),
    " 小时",
    ...(step.inheritedLabel ? ["· ", step.inheritedLabel] : []),
  );
}

function outputTileLines(
  card: DailyOutputCard,
  extraLines: readonly DisplayLine[],
  includeSanity: boolean,
): DisplayLine[] {
  const lines: DisplayLine[] = [];
  if (card.grossPoints !== undefined && card.grossPointsLabel !== undefined) {
    lines.push({
      key: GROSS_POINTS_KEY,
      value: displayValue(
        numberPart(card.grossPoints, "production", card.grossPointsLabel),
        ` ${card.grossPointsLabel}`,
      ),
    });
  }
  if (card.showNet) {
    lines.push({
      key: NET_KEY,
      value: displayValue(
        "净收入 ",
        numberPart(card.netAmount, "signed", card.netUnit),
        ` ${card.netUnit}`,
      ),
    });
  }
  lines.push(...extraLines);
  if (includeSanity) {
    lines.push(
      card.netContribution === undefined
        ? { key: SANITY_MISSING_KEY, value: displayText("未计入") }
        : {
            key: SANITY_KEY,
            value: displayValue(
              numberPart(card.netContribution, "signed", "理智"),
              " 理智",
            ),
          },
    );
  }
  return lines;
}

function outputTile(
  key: string,
  card: DailyOutputCard,
  includeSanity: boolean,
  extraLines: readonly DisplayLine[] = [],
): DisplayTile {
  const gross = card.grossAmount;
  return {
    key,
    product: card.product,
    ...(card.sourceFacility === undefined
      ? {}
      : { sourceFacility: card.sourceFacility }),
    main: displayNumber(
      gross ?? card.netAmount,
      gross === undefined ? "signed" : "production",
    ),
    lines: outputTileLines(card, extraLines, includeSanity),
  };
}

export function buildDailyOutputDisplay(
  result: EfficiencyResult,
  options: ResultDisplayOptions,
): DailyOutputDisplay {
  const amounts =
    result.dailyHours > 0
      ? (options.dailyAmounts ?? buildDailySanityAmounts(result))
      : undefined;
  const sanity = amounts
    ? calculateSanityResult(amounts, options.sanityValues)
    : undefined;
  const cards =
    amounts && sanity
      ? buildDailyOutputCards(result, amounts, sanity, {
          sourceFacilityForProduct: options.sourceFacilityForProduct,
        })
      : [];
  return {
    key: "daily-output",
    label: "每日产出",
    cycleHours: displayValue(
      numberPart(result.dailyHours, "number", "小时"),
      " 小时",
    ),
    tiles: cards.map((card) => outputTile(`daily-${card.product}`, card, true)),
    ...(sanity
      ? {
          totalTile: {
            key: "daily-sanity-total",
            product: "理智",
            main: displayNumber(sanity.total, "signed"),
            lines: [],
          },
        }
      : {}),
    empty: "当前排班没有可统计的产出",
    ...(sanity && !sanity.complete
      ? { warning: `总理智不完整：未设置${sanity.missing.join("、")}价值` }
      : {}),
  };
}

export function buildDroneStrategyDisplay(
  options: ResultDisplayOptions,
): DroneStrategyDisplay {
  return {
    label: "无人机使用策略",
    inputLabel: "本排班表专用策略（可选）",
    placeholder: "留空时按通用设置自动选择",
    hint: "输入一行：贸易站等级，后接干员；干员名末尾的 0、1、2 表示精 0、精 1、精 2。留空时按通用设置中的最低贸易站等级自动选择。",
    empty: "未设置有效的龙门币贸易站策略",
    ...(options.droneAcceleration?.strategyError === undefined
      ? {}
      : { strategyError: options.droneAcceleration.strategyError }),
  };
}

export function buildDroneScenarioViews(
  result: EfficiencyResult,
  options: ResultDisplayOptions,
): DroneScenarioView[] {
  const acceleration = options.droneAcceleration;
  if (!acceleration) {
    return [];
  }
  const amounts = options.dailyAmounts ?? buildDailySanityAmounts(result);
  return buildDroneScenarioDisplays(result, acceleration, amounts, {
    sourceFacilityForProduct: options.sourceFacilityForProduct,
  }).map((entry) => {
    const scenario = entry.scenario;
    return {
      key: scenario.key,
      title: displayValue(
        resourceLabel(scenario.product),
        ...(scenario.sourceLabel ? [" · ", scenario.sourceLabel] : []),
      ),
      meta: displayValue(
        numberPart(scenario.droneAmount, "number", "架"),
        "架 · ",
        numberPart(scenario.acceleratedHours, "number", "小时"),
        "小时",
      ),
      baseRate: displayValue(
        "基础 ",
        numberPart(scenario.baseAmountPerHour, "production", "/小时"),
        "/小时",
      ),
      views: entry.views.map((view) => ({
        key: view.key,
        label: view.label,
        tiles: view.cards.map((card) =>
          outputTile(
            `${view.key}-${card.product}`,
            card,
            false,
            view.key === "accelerated" &&
              card.product === scenario.product &&
              card.showNet
              ? [
                  {
                    key: NET_RESOURCE_KEY,
                    value: displayValue(
                      `净${resourceLabel(card.product)} `,
                      numberPart(
                        card.netResourceAmount,
                        "signed",
                        resourceLabel(card.product),
                      ),
                    ),
                  },
                ]
              : [],
          ),
        ),
      })),
    };
  });
}

function droneMaterialRows(
  detail: DroneAccelerationDetail,
  keyPrefix: string,
): DisplayRow[] {
  return Object.entries(detail.extraMaterial).map(([material, amount]) =>
    displayRow(
      `${keyPrefix}-material-${material}`,
      displayText("无人机额外材料"),
      displayValue(
        resourceLabel(material),
        " ",
        numberPart(amount, "signed", resourceLabel(material)),
      ),
    ),
  );
}

function droneOverflowRow(
  detail: DroneAccelerationDetail,
  keyPrefix: string,
): DisplayRow[] {
  return detail.overflowed
    ? [
        displayRow(
          `${keyPrefix}-overflow`,
          displayText("无人机爆仓"),
          displayValue(
            "超出 ",
            numberPart(detail.overflowAmount, "number", "架"),
            "架",
          ),
        ),
      ]
    : [];
}

function droneCommonRows(
  detail: DroneAccelerationDetail,
  keyPrefix: string,
): DisplayRow[] {
  return [
    displayRow(
      `${keyPrefix}-base`,
      displayText("基础速率"),
      displayUnit(detail.baseAmountPerHour, "production", "/小时"),
    ),
    displayRow(
      `${keyPrefix}-amount`,
      displayText("消耗无人机"),
      displayValue(numberPart(detail.droneAmount, "number", "架"), "架"),
    ),
    displayRow(
      `${keyPrefix}-hours`,
      displayText("加速时长"),
      displayValue(
        numberPart(detail.acceleratedHours, "number", "小时"),
        "小时",
      ),
    ),
    displayRow(
      `${keyPrefix}-extra`,
      displayText("无人机额外产出"),
      displayNumber(detail.extraAmount, "production"),
    ),
    ...droneMaterialRows(detail, keyPrefix),
    ...droneOverflowRow(detail, keyPrefix),
  ];
}

function maaDroneRows(
  result: EfficiencyResult,
  details: readonly DroneAccelerationDetail[],
): DisplayRow[] {
  return details.flatMap((detail) => {
    const keyPrefix = `drone-${detail.facilityId}-${detail.order}`;
    const source = result.plans[detail.sourcePlanIndex];
    return [
      displayRow(
        `${keyPrefix}-room`,
        displayText("设施"),
        displayText(`${ROOM_LABELS[detail.room]}${detail.facilityIndex + 1}`),
      ),
      displayRow(
        `${keyPrefix}-order`,
        displayText("加速时机"),
        displayText(detail.order === "pre" ? "换班前" : "换班后"),
      ),
      displayRow(
        `${keyPrefix}-source`,
        displayText("来源队列"),
        displayText(
          source
            ? planLabel(source, detail.sourcePlanIndex)
            : `队列${detail.sourcePlanIndex + 1}`,
        ),
      ),
      displayRow(
        `${keyPrefix}-product`,
        displayText("产物"),
        displayText(resourceLabel(detail.product)),
      ),
      ...droneCommonRows(detail, keyPrefix),
    ];
  });
}

function facilityDroneRows(
  details: readonly DroneAccelerationDetail[],
): DisplayRow[] {
  return details.flatMap((detail) => {
    const keyPrefix = `facility-drone-${detail.facilityId}-${detail.order}`;
    return [
      displayRow(
        `${keyPrefix}-order`,
        displayText("加速时机"),
        displayText(detail.order === "pre" ? "换班前" : "换班后"),
      ),
      displayRow(
        `${keyPrefix}-product`,
        displayText("加速产物"),
        displayText(resourceLabel(detail.product)),
      ),
      ...droneCommonRows(detail, keyPrefix),
    ];
  });
}

function buildMaaDronePane(result: EfficiencyResult): DisplayPane | undefined {
  const acceleration = result.maaDroneAcceleration;
  if (!acceleration?.enabled) {
    return undefined;
  }
  const cards = buildMaaDroneQueueDetails(result).map((queue) => {
    const others = queue.candidates.filter(
      (candidate) => !candidate.accelerated,
    );
    const sections: DisplaySection[] = [];
    if (queue.details.length) {
      sections.push(
        displaySection(
          `maa-${queue.planIndex}-details`,
          undefined,
          maaDroneRows(result, queue.details),
        ),
      );
    }
    if (others.length) {
      sections.push({
        key: `maa-${queue.planIndex}-others`,
        label: "其他设施加速收益",
        rows: [],
        entries: others.map((candidate) => ({
          key: `candidate-${candidate.facilityId}`,
          rows: [],
          cells: [
            displayText(
              `${ROOM_LABELS[candidate.room]}${candidate.facilityIndex + 1}`,
            ),
            displayText(resourceLabel(candidate.product)),
            displayValue(
              "基础 ",
              numberPart(candidate.baseAmountPerHour, "production", "/小时"),
              "/小时",
            ),
            displayValue(
              "额外 ",
              numberPart(
                candidate.extraAmount,
                "production",
                resourceLabel(candidate.product),
              ),
              ...Object.entries(candidate.extraMaterial).flatMap(
                ([material, amount]) => [
                  "/ ",
                  resourceLabel(material),
                  " ",
                  numberPart(amount, "signed", resourceLabel(material)),
                ],
              ),
            ),
          ],
        })),
      });
    }
    return {
      key: `maa-${queue.planIndex}`,
      title: displayText(planLabel(queue.plan, queue.planIndex)),
      subtitle: durationSubtitle(queue.plan.durationHours),
      ...(queue.candidates.length
        ? { badge: displayText(`${queue.candidates.length} 项`) }
        : {}),
      sections,
      ...(queue.details.length ? {} : { empty: "当前队列未设置无人机加速" }),
    };
  });
  return {
    key: "maa-drone-acceleration",
    label: "MAA 换班式无人机加速",
    hint: displayValue(
      "消耗 ",
      numberPart(acceleration.usedDrones, "number", "架"),
      " 架",
    ),
    cards,
  };
}

function materialRows(
  keyPrefix: string,
  labelPrefix: string,
  materials: readonly {
    material: string;
    baseAmountPerHour: number;
    dailyAmount: number;
    queueTotal: number;
  }[],
): DisplayRow[] {
  return materials.flatMap((material) => {
    const label = resourceLabel(material.material);
    return [
      displayRow(
        `${keyPrefix}-${material.material}-base`,
        displayText(`${labelPrefix}基础材料消耗速率`),
        displayValue(
          label,
          " ",
          numberPart(material.baseAmountPerHour, "signed", "/小时"),
          "/小时",
        ),
      ),
      displayRow(
        `${keyPrefix}-${material.material}-daily`,
        displayText(`${labelPrefix}材料消耗 · 队列折算`),
        displayValue(
          label,
          " ",
          numberPart(material.dailyAmount, "signed", "/日"),
          "/日",
        ),
      ),
      displayRow(
        `${keyPrefix}-${material.material}-total`,
        displayText(`${labelPrefix}材料消耗 · 队列时长总消耗`),
        displayValue(
          label,
          " ",
          numberPart(material.queueTotal, "signed", label),
        ),
      ),
    ];
  });
}

function orderRows(facility: DailyOutputFacilityDetail): DisplayRow[] {
  return facility.orders.map((order: DailyOutputOrderDetail) =>
    displayRow(
      `${facility.label}-order-${order.name}-name`,
      displayValue(
        `${facility.label} · 订单产出 · ${order.name} · `,
        numberPart(order.probability * 100, "number", "%"),
        "%",
      ),
      displayValue(
        "基础 ",
        numberPart(order.baseRate, "production", "/小时"),
        "/小时 · 总 ",
        numberPart(order.totalRate, "production", "/小时"),
        "/小时",
        ...(order.ignoreEfficiency ? [" · 固定订单"] : []),
      ),
    ),
  );
}

function productSection(product: DailyOutputProductDetail): DisplaySection {
  const rows: DisplayRow[] = [
    displayRow(
      `${product.product}-efficiency`,
      displayText("总效率"),
      displayUnit(product.totalEfficiency, "efficiency", "%"),
    ),
    displayRow(
      `${product.product}-base-output`,
      displayText("基础效率产出"),
      displayUnit(product.baseOutputPerHour, "production", "/小时"),
    ),
    displayRow(
      `${product.product}-total-output`,
      displayText("总效率产出"),
      displayUnit(product.totalOutputPerHour, "production", "/小时"),
    ),
    displayRow(
      `${product.product}-daily`,
      displayText("队列折算"),
      displayValue(
        numberPart(product.dailyContribution, "production", "/日"),
        "/日",
      ),
    ),
    displayRow(
      `${product.product}-queue-total`,
      displayText("队列时长总产出"),
      displayNumber(product.queueTotal, "production"),
    ),
  ];
  const sections: DisplaySection[] = [];
  if (product.materials.length) {
    sections.push({
      key: `${product.product}-materials`,
      label: "材料消耗合计",
      rows: materialRows(`${product.product}-material`, "", product.materials),
    });
  }
  if (product.facilities.length) {
    sections.push({
      key: `${product.product}-facilities`,
      label: "设施明细",
      rows: product.facilities.flatMap((facility) => [
        displayRow(
          `${facility.label}-eff`,
          displayText(`${facility.label} · 总效率`),
          displayUnit(facility.totalEfficiency, "efficiency", "%"),
        ),
        displayRow(
          `${facility.label}-base`,
          displayText(`${facility.label} · 基础产出`),
          displayUnit(facility.baseOutputPerHour, "production", "/小时"),
        ),
        displayRow(
          `${facility.label}-total`,
          displayText(`${facility.label} · 总产出`),
          displayUnit(facility.totalOutputPerHour, "production", "/小时"),
        ),
        ...materialRows(
          `${facility.label}-material`,
          `${facility.label} · `,
          facility.materials,
        ),
        ...orderRows(facility),
      ]),
    });
  }
  return {
    key: `product-${product.product}`,
    label: resourceLabel(product.product),
    rows,
    ...(sections.length ? { sections } : {}),
  };
}

function queueSanitySection(queue: DailyOutputQueueDetail): DisplaySection {
  const rows: DisplayRow[] = queue.sanity.items.map((item) => ({
    key: `sanity-${item.resource}`,
    label: displayValue(
      item.label,
      " · ",
      numberPart(item.amount, "signed", item.amountUnit),
      " ",
      item.amountUnit,
      "/日",
    ),
    ...(item.contribution === undefined
      ? { value: displayText("未计入") }
      : {
          value: displayValue(
            numberPart(item.contribution, "signed", "理智"),
            " 理智",
          ),
        }),
  }));
  rows.push({
    key: "sanity-total",
    label: displayText(
      queue.sanity.complete ? "队列等效理智合计" : "队列等效理智合计（部分）",
    ),
    value: displayValue(
      numberPart(queue.sanity.total, "signed", "理智"),
      "理智/日",
    ),
  });
  return { key: "queue-sanity", label: "队列等效理智", rows };
}

function buildDailyOutputBreakdownPane(
  result: EfficiencyResult,
  options: ResultDisplayOptions,
): DisplayPane | undefined {
  const queues = buildDailyOutputQueueDetails(
    result,
    options.sanityValues,
    options.facilityLabel ? { facilityLabel: options.facilityLabel } : {},
  );
  if (!queues.length) {
    return undefined;
  }
  return {
    key: "daily-output-breakdown",
    label: "队列计算明细",
    hint: displayText("按队列时长折算到每日产出"),
    cards: queues.map((queue) => ({
      key: `daily-output-${queue.planIndex}`,
      title: displayText(planLabel(queue.plan, queue.planIndex)),
      subtitle: durationSubtitle(queue.plan.durationHours),
      badge: displayText(`${queue.products.length} 种产物`),
      sections: [
        ...queue.products.map(productSection),
        queueSanitySection(queue),
      ],
    })),
  };
}

function buildBasePointDisplay(
  result: EfficiencyResult,
  options: ResultDisplayOptions,
): BasePointDisplay | undefined {
  const details = buildBasePointQueueDetails(
    result,
    options.visibleBasePointTerms,
  );
  if (!details.length) {
    return undefined;
  }
  const columns: BasePointColumn[] = details.map((entry) => ({
    key: `base-points-${entry.planIndex}`,
    title: displayText(planLabel(entry.plan, entry.planIndex)),
    subtitle: durationSubtitle(entry.plan.durationHours),
    points: entry.points.map((point): BasePointView => ({
      key: point.term,
      name: displayText(
        options.basePointLabel?.(point.term) ??
          formatBasePointLabel(point.term, {}),
      ),
      value: displayNumber(point.value),
      sources: point.sources.map((source: BasePointSource, index) => ({
        key: `${point.term}-${source.operator}-${source.kind}-${index}`,
        label: displayText(
          options.basePointSource?.(source) ??
            formatBasePointSource(source, {}),
        ),
        value: displayNumber(source.value, "signed"),
      })),
    })),
    empty: "当前队列无基地点数",
  }));
  return { key: "base-points", label: "基地点数", columns };
}

function skillSection(
  details: readonly OperatorEfficiencyDetail[],
): DisplaySection {
  return {
    key: "skill-details",
    label: "生效技能明细",
    rows: [],
    entries: details.map((detail, index): DisplayEntry => {
      const unit = efficiencyStatUnit(detail.stat);
      return {
        key: `skill-${detail.operator}-${detail.skill ?? "skill"}-${detail.stat}-${index}`,
        title: displayValue(
          detail.operator,
          ...(detail.skill ? [" · ", detail.skill] : []),
        ),
        value: displayValue(
          `${efficiencyStatLabel(detail.stat)} `,
          numberPart(detail.value, "signed", unit),
          unit,
        ),
        rows: operatorCalculationRows(detail).map((line, lineIndex) => ({
          key: `calculation-${lineIndex}`,
          ...(line.label ? { label: displayText(line.label) } : {}),
          value: displayText(line.value),
        })),
      };
    }),
  };
}

function moodSection(
  moods: readonly MoodSnapshot[],
  plan: EfficiencyPlanResult,
): DisplaySection {
  return {
    key: "moods",
    label: "干员心情消耗步骤",
    rows: [],
    entries: moods.map((mood) => {
      const rows: DisplayRow[] = mood.rateDetails.map((detail, index) => ({
        key: `mood-rate-${detail.kind}-${index}`,
        label: displayText(moodRateDetailLabel(detail)),
        value: displayUnit(detail.value, "signed", "/小时"),
      }));
      rows.push(
        displayRow(
          "mood-cost-rate",
          displayText("消耗速度"),
          displayText(moodRateFormula(mood)),
        ),
        displayRow(
          "mood-calculation",
          displayText("计算过程"),
          displayValue(
            `${formatNumber(mood.start)} - ${formatNumber(mood.costRate)} × ${formatNumber(plan.durationHours)} = ${formatNumber(mood.end)}`,
          ),
        ),
        displayRow(
          "mood-end",
          displayText("剩余心情"),
          displayNumber(mood.end),
        ),
      );
      return {
        key: `mood-${mood.facilityId}-${mood.slotIndex}-${mood.operator}`,
        title: displayText(mood.operator),
        rows,
      };
    }),
  };
}

function productionSection(
  facility: FacilityEfficiencyResult,
  options: ResultDisplayOptions,
): DisplaySection {
  const production = facility.production;
  const rows: DisplayRow[] = [];
  if (production) {
    rows.push(
      displayRow(
        "production-product",
        displayText("产物"),
        displayText(productionLabel(production.product)),
      ),
    );
    if (production.cluePreferences?.length) {
      rows.push(
        displayRow(
          "production-clue",
          displayText("线索倾向"),
          displayText(cluePreferenceText(production.cluePreferences)),
        ),
      );
    }
    rows.push(
      displayRow(
        "production-base-rate",
        displayText("基础速率"),
        displayUnit(production.baseAmountPerHour, "production", "/小时"),
      ),
      displayRow(
        "production-rate",
        displayText("实际速率"),
        displayUnit(production.amountPerHour, "production", "/小时"),
      ),
      displayRow(
        "production-item-rate",
        displayText("容量消耗速率"),
        production.itemRate === undefined
          ? displayText("")
          : displayValue(
              numberPart(production.itemRate, "production", " / 小时"),
              " / 小时",
            ),
      ),
    );
    const materials = productionMaterialsForDisplay(
      production,
      options.simulateOverflow ?? false,
    );
    if (
      (facility.facility.type === "trading" ||
        facility.facility.type === "manufacture") &&
      materials.length
    ) {
      materials.forEach((material, index) => {
        rows.push(
          displayRow(
            `facility-material-${material.material}-${index}-base`,
            displayText("基础材料消耗速率"),
            displayValue(
              resourceLabel(material.material),
              " ",
              numberPart(material.baseAmount, "signed", "/小时"),
              "/小时",
            ),
          ),
          displayRow(
            `facility-material-${material.material}-${index}-rate`,
            displayText("材料消耗速率"),
            displayValue(
              resourceLabel(material.material),
              " ",
              numberPart(material.amount, "signed", "/小时"),
              "/小时",
            ),
          ),
        );
      });
    }
    if (production.conversion) {
      const conversion = production.conversion;
      rows.push(
        displayRow(
          "production-conversion",
          displayText("单位折算"),
          displayText(
            `${formatNumber(conversion.amountPerUnit)} ${conversion.label}/${conversion.sourceUnit}`,
          ),
        ),
        displayRow(
          "production-conversion-cycle",
          displayText("基础周期"),
          displayText(
            `${formatNumber(conversion.baseCycleHours)} 小时/${conversion.sourceUnit}`,
          ),
        ),
        displayRow(
          "production-conversion-rate",
          displayText("折算实际速率"),
          displayUnit(
            convertedProductionAmount(production, production.amountPerHour),
            "production",
            "/小时",
          ),
        ),
      );
    }
    if (production.orderRule) {
      rows.push(
        displayRow(
          "production-order-rule",
          displayText("订单规则"),
          displayText(production.orderRule),
        ),
      );
    }
  }
  const capacity = facility.capacity;
  if (capacity) {
    rows.push(
      displayRow(
        "capacity-total",
        displayText(capacity.label),
        displayValue(
          numberPart(capacity.total, "number", capacity.unit),
          " ",
          capacity.unit,
          mutedText(" （基础 "),
          mutedNumber(capacity.base, "number", capacity.unit),
          mutedText("，技能 "),
          mutedNumber(capacity.skill, "signed", capacity.unit),
          mutedText("）"),
        ),
      ),
    );
  }
  if (production?.breachTime !== undefined) {
    rows.push(
      displayRow(
        "production-breach",
        displayText("爆仓"),
        displayValue(
          `${facilityOverflowLabel(production)} · `,
          numberPart(production.breachTime, "number", "小时"),
          " 小时",
        ),
      ),
    );
  }
  const sections: DisplaySection[] = [];
  if (capacity && capacity.segments.length > 1) {
    sections.push({
      key: "capacity-segments",
      label: "动态容量时间段",
      rows: capacity.segments.map((segment) => ({
        key: `capacity-segment-${segment.startHours}-${segment.endHours}`,
        label: displayValue(
          numberPart(segment.startHours, "number", "小时"),
          " 小时 - ",
          numberPart(segment.endHours, "number", "小时"),
          " 小时",
        ),
        value: displayValue(
          numberPart(segment.total, "number", capacity.unit),
          " ",
          capacity.unit,
          mutedText(" （基础 "),
          mutedNumber(segment.base, "number", capacity.unit),
          mutedText("，技能 "),
          mutedNumber(segment.skill, "signed", capacity.unit),
          mutedText("）"),
        ),
      })),
    });
  }
  if (production?.orders?.length) {
    sections.push({
      key: "production-orders",
      label: "订单摘要",
      rows: production.orders.map((order, index) => ({
        key: `order-${order.name}-${order.time}-${order.quantity}-${index}`,
        label: displayValue(
          `${order.name} · `,
          numberPart(order.probability * 100, "number", "%"),
          "%",
        ),
        value: displayValue(
          numberPart(order.quantity),
          " / ",
          numberPart(order.time, "number", "小时"),
          " 小时",
          ...(order.material
            ? [
                " · ",
                resourceLabel(order.material),
                " × ",
                numberPart(order.amount ?? 0),
              ]
            : []),
        ),
      })),
    });
  }
  return displaySection("production-capacity", "产出与容量", rows, sections);
}

function facilityStepSections(
  step: EfficiencyCalculationStepView,
  result: EfficiencyResult,
  options: ResultDisplayOptions,
): DisplaySection[] {
  const sections: DisplaySection[] = [];
  const facility = step.facility;
  if (!facility) {
    if (step.moods.length) {
      sections.push(moodSection(step.moods, step.plan));
    }
    return sections;
  }
  if (facility.inherited) {
    sections.push(
      displaySection("inherited", "继承说明", [
        displayRow(
          "inherited-note",
          displayText("说明"),
          displayValue(
            "本队列为跳过队列，已继承 ",
            formatInheritedSourceLabel(facility, result.plans).replace(
              /^继承自 /,
              "",
            ),
            " 的干员与练度；心情按当前队列重新计算。",
          ),
        ),
      ]),
    );
  }
  sections.push(
    displaySection("efficiency-summary", "效率汇总", [
      displayRow(
        "facility-base-efficiency",
        displayText("设施效率"),
        displayUnit(facility.baseEfficiency, "number", "%"),
      ),
      displayRow(
        "facility-mood-efficiency",
        displayText("干员心情效率"),
        displayUnit(facility.moodEfficiency, "signed", "%"),
      ),
      displayRow(
        "facility-skill-efficiency",
        displayText("干员技能效率"),
        displayUnit(facility.operatorSkillEfficiency, "signed", "%"),
      ),
      displayRow(
        "facility-efficiency",
        displayText("整体效率"),
        displayUnit(facility.efficiency, "number", "%"),
      ),
    ]),
  );
  if (facility.capacity || facility.production) {
    sections.push(productionSection(facility, options));
  }
  if (facility.details.length) {
    sections.push(skillSection(facility.details));
  }
  if (step.droneAccelerations?.length) {
    sections.push(
      displaySection(
        "drone-acceleration",
        "无人机加速",
        facilityDroneRows(step.droneAccelerations),
      ),
    );
  }
  if (step.moods.length) {
    sections.push(moodSection(step.moods, step.plan));
  }
  return sections;
}

function facilityStepView(
  step: EfficiencyCalculationStepView,
  result: EfficiencyResult,
  options: ResultDisplayOptions,
): FacilityStepView {
  const facility = step.facility;
  const inherited = inheritedStepLabel(step, result);
  const emptyNote =
    facility &&
    !facility.details.length &&
    !step.moods.length &&
    !step.droneAccelerations?.length
      ? "当前设施没有可展开的技能明细"
      : undefined;
  return {
    key: `step-${step.planIndex}-${facility?.facility.id ?? "control"}`,
    planIndex: step.planIndex,
    ...(facility ? { facilityId: facility.facility.id } : {}),
    facilityLabel: facility
      ? (options.facilityLabel?.(facility) ??
        formatFacilityResultLabel(facility, result.document.layout))
      : ROOM_LABELS.control,
    ...(inherited ? { inheritedLabel: inherited } : {}),
    ...(facility ? { efficiency: facility.efficiency } : {}),
    sections: facilityStepSections(step, result, options),
    ...(emptyNote === undefined ? {} : { emptyNote }),
  };
}

function buildFacilitySteps(
  result: EfficiencyResult,
  options: ResultDisplayOptions,
): FacilityStepsDisplay {
  return {
    plans: result.plans.map((plan, planIndex) => ({
      planIndex,
      name: plan.name,
      durationHours: plan.durationHours,
    })),
    steps: buildCalculationSteps(result).map((step) =>
      facilityStepView(step, result, options),
    ),
  };
}

export function buildFacilityStepCards(
  facilitySteps: FacilityStepsDisplay,
): DisplayCard[] {
  return facilitySteps.steps.map((step) => {
    const plan = facilitySteps.plans[step.planIndex];
    return {
      key: step.key,
      title: displayText(`${plan?.name ?? ""} · ${step.facilityLabel}`),
      ...(step.inheritedLabel === undefined
        ? {}
        : { subtitle: displayValue(" · ", step.inheritedLabel) }),
      ...(step.efficiency === undefined
        ? {}
        : { badge: displayUnit(step.efficiency, "number", "%") }),
      sections: step.sections,
      ...(step.emptyNote === undefined ? {} : { emptyNote: step.emptyNote }),
    };
  });
}

export function buildFacilityStepPanes(
  facilitySteps: FacilityStepsDisplay,
): DisplayPane[] {
  const groups = new Map<string, FacilityStepView[]>();
  for (const step of facilitySteps.steps) {
    const key = step.facilityId ?? "control";
    const group = groups.get(key);
    if (group) {
      group.push(step);
    } else {
      groups.set(key, [step]);
    }
  }
  return [...groups.entries()].map(([key, steps]) => {
    const byPlan = new Map(steps.map((step) => [step.planIndex, step]));
    return {
      key: `facility-${key}`,
      label: steps[0]?.facilityLabel ?? ROOM_LABELS.control,
      badge: displayText(
        `${steps.length} / ${facilitySteps.plans.length} 个队列`,
      ),
      cards: facilitySteps.plans.map((plan): DisplayCard => {
        const step = byPlan.get(plan.planIndex);
        if (step === undefined) {
          return {
            key: `empty-${key}-${plan.planIndex}`,
            title: displayText(plan.name),
            subtitle: durationSubtitle(plan.durationHours),
            sections: [],
            empty: "当前队列无此设施计算数据",
          };
        }
        return {
          key: step.key,
          title: displayText(plan.name),
          subtitle: facilityStepSubtitle(step, plan),
          ...(step.efficiency === undefined
            ? {}
            : { badge: displayUnit(step.efficiency, "number", "%") }),
          sections: step.sections,
          ...(step.emptyNote === undefined
            ? {}
            : { emptyNote: step.emptyNote }),
        };
      }),
    };
  });
}

export function buildResultDisplay(
  result: EfficiencyResult,
  options: ResultDisplayOptions,
): ResultDisplay {
  const maaDrone = buildMaaDronePane(result);
  const dailyOutput = buildDailyOutputBreakdownPane(result, options);
  const basePoints = buildBasePointDisplay(result, options);
  return {
    dailyOutput: buildDailyOutputDisplay(result, options),
    droneStrategy: buildDroneStrategyDisplay(options),
    droneScenarios: buildDroneScenarioViews(result, options),
    calculationSteps: {
      label: "计算步骤",
      hint: "展开分区查看详细计算过程",
      ...(maaDrone === undefined ? {} : { maaDrone }),
      ...(dailyOutput === undefined ? {} : { dailyOutput }),
      ...(basePoints === undefined ? {} : { basePoints }),
      facilitySteps: buildFacilitySteps(result, options),
    },
  };
}

export function flattenResultDisplay(
  display: ResultDisplay,
  format: (
    raw: DisplayRawNumber,
    index: number,
  ) => string = formatDisplayNumber,
): DisplayFlatLine[] {
  const lines: DisplayFlatLine[] = [];
  const push = (
    level: number,
    key: string,
    value: DisplayValue | undefined,
    label?: string,
  ): void => {
    if (value === undefined) {
      return;
    }
    lines.push({
      level,
      key,
      ...(label === undefined ? {} : { label }),
      text: formatDisplayValue(value, format),
    });
  };
  const pushSections = (sections: readonly DisplaySection[], level: number) => {
    for (const section of sections) {
      lines.push({
        level,
        key: section.key,
        ...(section.label === undefined ? {} : { label: section.label }),
        text: section.label ?? "",
      });
      for (const row of section.rows) {
        push(
          level + 1,
          row.key,
          row.value,
          row.label === undefined
            ? undefined
            : formatDisplayValue(row.label, format),
        );
      }
      for (const entry of section.entries ?? []) {
        push(
          level + 1,
          entry.key,
          entry.title,
          entry.value === undefined
            ? undefined
            : formatDisplayValue(entry.value, format),
        );
        for (const cell of entry.cells ?? []) {
          push(level + 2, `${entry.key}-cell`, cell);
        }
        for (const row of entry.rows) {
          push(
            level + 2,
            row.key,
            row.value,
            row.label === undefined
              ? undefined
              : formatDisplayValue(row.label, format),
          );
        }
      }
      pushSections(section.sections ?? [], level + 1);
    }
  };
  const pushCards = (cards: readonly DisplayCard[], level: number) => {
    for (const card of cards) {
      lines.push({
        level,
        key: card.key,
        label: formatDisplayValue(card.title, format),
        text: [
          formatDisplayValue(card.title, format),
          card.subtitle === undefined
            ? ""
            : formatDisplayValue(card.subtitle, format),
          card.badge === undefined
            ? ""
            : formatDisplayValue(card.badge, format),
        ]
          .filter(Boolean)
          .join(" "),
      });
      pushSections(card.sections, level + 1);
    }
  };

  lines.push({
    level: 0,
    key: display.dailyOutput.key,
    text: display.dailyOutput.label,
  });
  push(1, "cycle", display.dailyOutput.cycleHours);
  for (const tile of display.dailyOutput.tiles) {
    push(1, tile.key, tile.main, tile.product);
    for (const line of tile.lines) {
      push(2, `${tile.key}-${line.key}`, line.value);
    }
  }
  if (display.dailyOutput.totalTile) {
    push(
      1,
      display.dailyOutput.totalTile.key,
      display.dailyOutput.totalTile.main,
      display.dailyOutput.totalTile.product,
    );
  }

  lines.push({
    level: 0,
    key: "drone-strategy",
    text: display.droneStrategy.label,
  });
  for (const scenario of display.droneScenarios) {
    lines.push({
      level: 1,
      key: scenario.key,
      label: formatDisplayValue(scenario.title, format),
      text: [
        formatDisplayValue(scenario.title, format),
        formatDisplayValue(scenario.meta, format),
        formatDisplayValue(scenario.baseRate, format),
      ].join(" "),
    });
    for (const view of scenario.views) {
      lines.push({
        level: 2,
        key: `${scenario.key}-${view.key}`,
        text: view.label,
      });
      for (const tile of view.tiles) {
        push(3, tile.key, tile.main, tile.product);
        for (const line of tile.lines) {
          push(4, `${tile.key}-${line.key}`, line.value);
        }
      }
    }
  }

  const steps = display.calculationSteps;
  lines.push({ level: 0, key: "calculation-steps", text: steps.label });
  if (steps.maaDrone) {
    lines.push({
      level: 1,
      key: steps.maaDrone.key,
      text: [
        steps.maaDrone.label,
        steps.maaDrone.hint === undefined
          ? ""
          : formatDisplayValue(steps.maaDrone.hint, format),
      ]
        .filter(Boolean)
        .join(" "),
    });
    pushCards(steps.maaDrone.cards, 2);
  }
  if (steps.dailyOutput) {
    lines.push({
      level: 1,
      key: steps.dailyOutput.key,
      text: steps.dailyOutput.label,
    });
    pushCards(steps.dailyOutput.cards, 2);
  }
  if (steps.basePoints) {
    lines.push({
      level: 1,
      key: steps.basePoints.key,
      text: steps.basePoints.label,
    });
    for (const column of steps.basePoints.columns) {
      push(2, column.key, column.title);
      push(3, `${column.key}-duration`, column.subtitle);
      for (const point of column.points) {
        push(3, point.key, point.value, formatDisplayValue(point.name, format));
        for (const source of point.sources) {
          push(
            4,
            source.key,
            source.value,
            formatDisplayValue(source.label, format),
          );
        }
      }
    }
  }
  for (const plan of steps.facilitySteps.plans) {
    lines.push({
      level: 1,
      key: `plan-${plan.planIndex}`,
      text: `${plan.name} ${plan.durationHours} 小时`,
    });
  }
  for (const step of steps.facilitySteps.steps) {
    lines.push({
      level: 1,
      key: step.key,
      text: [
        step.facilityLabel,
        step.inheritedLabel === undefined ? "" : step.inheritedLabel,
        step.efficiency === undefined ? "" : String(step.efficiency),
      ]
        .filter(Boolean)
        .join(" "),
    });
    pushSections(step.sections, 2);
  }
  return lines;
}
