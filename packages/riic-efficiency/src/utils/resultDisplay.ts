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
  CalculationStepsDisplay,
  DailyOutputDisplay,
  DisplayCard,
  DisplayEntry,
  DisplayLine,
  DisplayNumberFormat,
  DisplayPane,
  DisplayRow,
  DisplaySection,
  DisplayTile,
  DisplayValue,
  DisplayValuePart,
  DroneScenarioView,
  DroneStrategyDisplay,
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
  formatEfficiencyNumber,
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
  buildCalculationStepGroups,
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

function displayFormat(value: number, format: DisplayNumberFormat): string {
  if (format === "signed") {
    return signedNumber(value);
  }
  if (format === "efficiency") {
    return formatEfficiencyNumber(value);
  }
  return formatNumber(value);
}

function displayPartText(part: DisplayValuePart): string {
  if (typeof part === "string") {
    return part;
  }
  if ("text" in part) {
    return part.text;
  }
  return displayFormat(part.value, part.format ?? "number");
}

function displayValue(...parts: DisplayValuePart[]): DisplayValue {
  return { text: parts.map(displayPartText).join(""), parts };
}

function displayText(text: string): DisplayValue {
  return { text, parts: [text] };
}

function displayNumber(
  value: number,
  format: DisplayNumberFormat = "number",
  unit?: string,
): DisplayValue {
  return displayValue(
    unit === undefined ? { value, format } : { value, format, unit },
  );
}

function displayUnit(
  value: number,
  format: DisplayNumberFormat,
  unit: string,
): DisplayValue {
  return displayValue({ value, format, unit }, unit);
}

function numberPart(
  value: number,
  format: DisplayNumberFormat = "number",
  unit?: string,
): DisplayValuePart {
  return unit === undefined ? { value, format } : { value, format, unit };
}

function mutedText(text: string): DisplayValuePart {
  return { text, muted: true };
}

function mutedNumber(
  value: number,
  format: DisplayNumberFormat = "number",
  unit?: string,
): DisplayValuePart {
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
  emphasis = true,
): DisplayRow {
  return {
    key,
    ...(label === undefined ? {} : { label }),
    value,
    ...(emphasis ? {} : { emphasis: false }),
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
    kind: "grid",
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
  step: EfficiencyCalculationStepView,
  result: EfficiencyResult,
): DisplayValue {
  const inherited = inheritedStepLabel(step, result);
  return displayValue(
    " · ",
    numberPart(step.plan.durationHours, "number", "小时"),
    " 小时",
    ...(inherited ? ["· ", inherited] : []),
  );
}

function queueStepSubtitle(
  step: EfficiencyCalculationStepView,
  result: EfficiencyResult,
): DisplayValue | undefined {
  const inherited = inheritedStepLabel(step, result);
  return inherited ? displayValue(" · ", inherited) : undefined;
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
    icon: card.product,
    ...(card.sourceFacility === undefined
      ? {}
      : { sourceFacility: card.sourceFacility }),
    ...(gross === undefined ? { netOnly: true } : {}),
    main: displayNumber(
      gross ?? card.netAmount,
      gross === undefined ? "signed" : "production",
      card.netUnit,
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
    eyebrow: "DAILY OUTPUT",
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
            icon: "理智",
            main: displayNumber(sanity.total, "signed", "理智"),
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
    eyebrow: "DRONE ACCELERATION",
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
      displayNumber(
        detail.extraAmount,
        "production",
        resourceLabel(detail.product),
      ),
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
        kind: "candidate-list",
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
      displayNumber(
        product.queueTotal,
        "production",
        resourceLabel(product.product),
      ),
    ),
  ];
  const sections: DisplaySection[] = [];
  if (product.materials.length) {
    sections.push({
      key: `${product.product}-materials`,
      label: "材料消耗合计",
      kind: "grid",
      rows: materialRows(`${product.product}-material`, "", product.materials),
    });
  }
  if (product.facilities.length) {
    sections.push({
      key: `${product.product}-facilities`,
      label: "设施明细",
      kind: "grid",
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
    kind: "grid",
    rows,
    ...(sections.length ? { sections } : {}),
  };
}

function queueSanitySection(queue: DailyOutputQueueDetail): DisplaySection {
  const rows: DisplayRow[] = queue.sanity.items.map((item) => ({
    key: `sanity-${item.resource}`,
    icon: item.resource,
    label: displayValue(
      item.label,
      " · ",
      numberPart(item.amount, "signed", item.amountUnit),
      " ",
      item.amountUnit,
      "/日",
    ),
    ...(item.contribution === undefined
      ? { value: displayText("未计入"), muted: true }
      : {
          value: displayValue(
            numberPart(item.contribution, "signed", "理智"),
            " 理智",
          ),
        }),
  }));
  rows.push({
    key: "sanity-total",
    icon: "理智",
    label: displayText(
      queue.sanity.complete ? "队列等效理智合计" : "队列等效理智合计（部分）",
    ),
    value: displayValue(
      numberPart(queue.sanity.total, "signed", "理智"),
      "理智/日",
    ),
  });
  return { key: "queue-sanity", label: "队列等效理智", kind: "grid", rows };
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
        text: displayText(
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
    kind: "skill-list",
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
    kind: "mood-list",
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
          false,
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
      kind: "grid",
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
      kind: "grid",
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

function stepCard(
  step: EfficiencyCalculationStepView,
  result: EfficiencyResult,
  options: ResultDisplayOptions,
  title: DisplayValue,
  subtitle?: DisplayValue,
  badge?: DisplayValue,
): DisplayCard {
  const facility = step.facility;
  const emptyNote =
    facility &&
    !facility.details.length &&
    !step.moods.length &&
    !step.droneAccelerations?.length
      ? "当前设施没有可展开的技能明细"
      : undefined;
  return {
    key: `step-${step.planIndex}-${facility?.facility.id ?? "control"}`,
    title,
    ...(subtitle === undefined ? {} : { subtitle }),
    ...(badge === undefined ? {} : { badge }),
    sections: facilityStepSections(step, result, options),
    ...(emptyNote === undefined ? {} : { emptyNote }),
  };
}

function buildFacilitySteps(
  result: EfficiencyResult,
  options: ResultDisplayOptions,
): CalculationStepsDisplay["facilitySteps"] {
  const steps = buildCalculationSteps(result);
  if (!steps.length) {
    return { byFacility: [], byQueue: [] };
  }
  const groups = buildCalculationStepGroups(
    result,
    steps,
    options.facilityLabel ? { facilityLabel: options.facilityLabel } : {},
  );
  const byFacility: DisplayPane[] = groups.map((group) => ({
    key: `facility-${group.key}`,
    label: group.label,
    badge: displayText(
      `${group.activeColumnCount} / ${group.columns.length} 个队列`,
    ),
    cards: group.columns.map((column) =>
      column.step
        ? stepCard(
            column.step,
            result,
            options,
            displayText(column.plan.name),
            facilityStepSubtitle(column.step, result),
            column.step.facility
              ? displayUnit(column.step.facility.efficiency, "number", "%")
              : undefined,
          )
        : {
            key: `empty-${group.key}-${column.planIndex}`,
            title: displayText(column.plan.name),
            subtitle: durationSubtitle(column.plan.durationHours),
            sections: [],
            empty: "当前队列无此设施计算数据",
          },
    ),
  }));
  const byQueue: DisplayCard[] = steps.map((step) => {
    const facility = step.facility;
    const label = facility
      ? (options.facilityLabel?.(facility) ??
        formatFacilityResultLabel(facility, result.document.layout))
      : ROOM_LABELS.control;
    return stepCard(
      step,
      result,
      options,
      displayText(`${step.plan.name} · ${label}`),
      queueStepSubtitle(step, result),
      facility ? displayUnit(facility.efficiency, "number", "%") : undefined,
    );
  });
  return { byFacility, byQueue };
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
      eyebrow: "CALCULATION STEPS",
      label: "计算步骤",
      hint: "展开分区查看详细计算过程",
      ...(maaDrone === undefined ? {} : { maaDrone }),
      ...(dailyOutput === undefined ? {} : { dailyOutput }),
      ...(basePoints === undefined ? {} : { basePoints }),
      facilitySteps: buildFacilitySteps(result, options),
    },
  };
}
