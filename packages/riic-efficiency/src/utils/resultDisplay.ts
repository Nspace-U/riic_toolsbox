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
  ResourceAmountDisplayMode,
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
  DEFAULT_RULESET,
  type EfficiencyRuleset,
} from "./efficiency/baseRules";
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
  resourcePointInfo,
} from "./resultPresentation";
import { ROOM_LABELS } from "./schedule";
import { calculateSanityResult } from "./sanity";

const NET_KEY = "net";
const SANITY_KEY = "sanity";
const SANITY_MISSING_KEY = "sanity-missing";
const DEFAULT_RESOURCE_AMOUNT_DISPLAY_MODE: ResourceAmountDisplayMode =
  "points";

type BuildNumberFormat = "number" | "signed";

type BuildPart = string | { value: number; format?: BuildNumberFormat };

function composeParts(parts: readonly BuildPart[]): DisplayValue {
  let template = "";
  const raws: DisplayRawNumber[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      template += part;
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
): BuildPart {
  return { value, format };
}

interface ResourceAmountDisplayPartsOptions {
  unitSuffix?: string;
  prefix?: string;
  resourceFirst?: boolean;
}

function resourceOrderParts(
  amount: number,
  resource: string,
  mode: ResourceAmountDisplayMode = DEFAULT_RESOURCE_AMOUNT_DISPLAY_MODE,
): BuildPart[] | undefined {
  const pointInfo = resourcePointInfo(resource);
  if (pointInfo === undefined) {
    return undefined;
  }
  if (mode === "raw") {
    return [resource, " × ", numberPart(amount)];
  }
  if (mode === "points") {
    return [pointInfo.label, " × ", numberPart(amount * pointInfo.factor)];
  }
  return [
    resource,
    " × ",
    numberPart(amount),
    "（",
    numberPart(amount * pointInfo.factor),
    "）",
  ];
}

function resourceAmountParts(
  value: number,
  resource: string,
  mode: ResourceAmountDisplayMode | undefined,
  format: BuildNumberFormat,
  options: ResourceAmountDisplayPartsOptions = {},
): BuildPart[] | undefined {
  const pointInfo = resourcePointInfo(resource);
  if (pointInfo === undefined) {
    return undefined;
  }

  const displayMode = mode ?? DEFAULT_RESOURCE_AMOUNT_DISPLAY_MODE;
  const unitSuffix = options.unitSuffix ?? "";
  const prefix = options.prefix ?? "";
  if (displayMode === "raw") {
    if (options.resourceFirst) {
      return [
        prefix,
        resource,
        " ",
        numberPart(value, format),
        unitSuffix,
      ];
    }
    return [prefix, numberPart(value, format), unitSuffix];
  }
  if (displayMode === "points") {
    if (options.resourceFirst) {
      return [
        prefix,
        pointInfo.label,
        " ",
        numberPart(value * pointInfo.factor, format),
        unitSuffix,
      ];
    }
    return [
      prefix,
      numberPart(value * pointInfo.factor, format),
      unitSuffix,
    ];
  }
  if (options.resourceFirst) {
    return [
      prefix,
      resource,
      " ",
      numberPart(value, format),
      unitSuffix,
      "（",
      numberPart(value * pointInfo.factor, format),
      "）",
    ];
  }
  return [
    prefix,
    numberPart(value, format),
    unitSuffix,
    "（",
    numberPart(value * pointInfo.factor, format),
    "）",
  ];
}

function resourceAmountDisplay(
  value: number,
  resource: string,
  mode: ResourceAmountDisplayMode | undefined,
  format: BuildNumberFormat,
  fallbackValue: DisplayValue,
  options: ResourceAmountDisplayPartsOptions = {},
): DisplayValue {
  const parts = resourceAmountParts(value, resource, mode, format, options);
  return parts === undefined ? fallbackValue : displayValue(...parts);
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
  return displayValue(" · ", numberPart(hours, "number"), " 小时");
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
    numberPart(plan.durationHours, "number"),
    " 小时",
    ...(step.inheritedLabel ? ["· ", step.inheritedLabel] : []),
  );
}

function outputTileLines(
  card: DailyOutputCard,
  extraLines: readonly DisplayLine[],
  includeSanity: boolean,
  resourceAmountDisplayMode: ResourceAmountDisplayMode =
    DEFAULT_RESOURCE_AMOUNT_DISPLAY_MODE,
): DisplayLine[] {
  const lines: DisplayLine[] = [];
  const pointInfo = resourcePointInfo(card.product);
  if (card.showNet) {
    const mode = resourceAmountDisplayMode;
    if (pointInfo === undefined) {
      lines.push({
        key: NET_KEY,
        value: displayValue(
          "净收入 ",
          numberPart(card.netAmount, "signed"),
          ` ${card.netUnit}`,
        ),
      });
    } else if (mode === "both") {
      lines.push({
        key: NET_KEY,
        value: displayValue(
          "净收入 ",
          numberPart(card.netResourceAmount, "signed"),
          "（",
          numberPart(card.netAmount, "signed"),
          "）",
        ),
      });
    } else if (card.grossAmount !== undefined) {
      const isRaw = mode === "raw";
      const unit = isRaw ? resourceLabel(card.product) : pointInfo.label;
      lines.push({
        key: NET_KEY,
        value: displayValue(
          "净收入 ",
          numberPart(
            isRaw ? card.netResourceAmount : card.netAmount,
            "signed",
          ),
          ` ${unit}`,
        ),
      });
    }
  }
  lines.push(...extraLines);
  if (includeSanity) {
    lines.push(
      card.netContribution === undefined
        ? { key: SANITY_MISSING_KEY, value: displayText("未计入") }
        : {
            key: SANITY_KEY,
            value: displayValue(
              numberPart(card.netContribution, "signed"),
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
  resourceAmountDisplayMode: ResourceAmountDisplayMode =
    DEFAULT_RESOURCE_AMOUNT_DISPLAY_MODE,
): DisplayTile {
  const gross = card.grossAmount;
  const amount = gross ?? card.netResourceAmount;
  const pointInfo = resourcePointInfo(card.product);
  const format = gross === undefined ? "signed" : "number";
  const hasResourceUnit = pointInfo !== undefined;
  const unit =
    resourceAmountDisplayMode === "points"
      ? pointInfo?.label
      : resourceAmountDisplayMode === "raw" && hasResourceUnit
        ? card.product
        : undefined;
  const mainAmount =
    resourceAmountDisplayMode === "points" && pointInfo
      ? amount * pointInfo.factor
      : amount;
  const main =
    resourceAmountDisplayMode === "both" && pointInfo
      ? displayValue(
          numberPart(amount, format),
          "（",
          numberPart(amount * pointInfo.factor, format),
          "）",
        )
      : displayNumber(mainAmount, format);
  return {
    key,
    product: card.product,
    ...(card.sourceFacility === undefined
      ? {}
      : { sourceFacility: card.sourceFacility }),
    main,
    ...(unit === undefined ? {} : { mainUnit: unit }),
    lines: outputTileLines(
      card,
      extraLines,
      includeSanity,
      resourceAmountDisplayMode,
    ),
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
      numberPart(result.dailyHours, "number"),
      " 小时",
    ),
    tiles: cards.map((card) =>
      outputTile(
        `daily-${card.product}`,
        card,
        true,
        [],
        options.resourceAmountDisplayMode,
      ),
    ),
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
    const resourceAmountDisplayMode =
      options.resourceAmountDisplayMode ?? DEFAULT_RESOURCE_AMOUNT_DISPLAY_MODE;
    const pointInfo = resourcePointInfo(scenario.product);
    const baseRate =
      resourceAmountDisplayMode === "both" && pointInfo !== undefined
        ? displayValue(
            "基础 ",
            numberPart(scenario.baseAmountPerHour, "number"),
            "/小时（",
            numberPart(scenario.baseAmountPerHour * pointInfo.factor, "number"),
            "）",
          )
        : resourceAmountDisplay(
            scenario.baseAmountPerHour,
            scenario.product,
            resourceAmountDisplayMode,
            "number",
            displayValue(
              "基础 ",
              numberPart(scenario.baseAmountPerHour, "number"),
              "/小时",
            ),
            {
              unitSuffix: "/小时",
              prefix: "基础 ",
            },
          );
    return {
      key: scenario.key,
      title: displayText(resourceLabel(scenario.product)),
      meta: displayValue(
        numberPart(scenario.droneAmount, "number"),
        "架 · ",
        numberPart(scenario.acceleratedHours, "number"),
        "小时",
      ),
      baseRate,
      views: entry.views.map((view) => ({
        key: view.key,
        label: view.label,
        tiles: view.cards.map((card) =>
          outputTile(
            `${view.key}-${card.product}`,
            card,
            false,
            [],
            options.resourceAmountDisplayMode,
          ),
        ),
      })),
    };
  });
}

function droneMaterialRows(
  detail: DroneAccelerationDetail,
  keyPrefix: string,
  resourceAmountDisplayMode?: ResourceAmountDisplayMode,
): DisplayRow[] {
  return Object.entries(detail.extraMaterial).map(([material, amount]) =>
    displayRow(
      `${keyPrefix}-material-${material}`,
      displayText("无人机额外材料"),
      resourceAmountDisplay(
        amount,
        material,
        resourceAmountDisplayMode,
        "signed",
        displayValue(
          resourceLabel(material),
          " ",
          numberPart(amount, "signed"),
        ),
        { resourceFirst: true },
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
            numberPart(detail.overflowAmount, "number"),
            "架",
          ),
        ),
      ]
    : [];
}

function droneCommonRows(
  detail: DroneAccelerationDetail,
  keyPrefix: string,
  resourceAmountDisplayMode?: ResourceAmountDisplayMode,
): DisplayRow[] {
  return [
    displayRow(
      `${keyPrefix}-base`,
      displayText("基础速率"),
      resourceAmountDisplay(
        detail.baseAmountPerHour,
        detail.product,
        resourceAmountDisplayMode,
        "number",
        displayUnit(detail.baseAmountPerHour, "number", "/小时"),
        {
          unitSuffix: "/小时",
        },
      ),
    ),
    displayRow(
      `${keyPrefix}-amount`,
      displayText("消耗无人机"),
      displayValue(numberPart(detail.droneAmount, "number"), "架"),
    ),
    displayRow(
      `${keyPrefix}-hours`,
      displayText("加速时长"),
      displayValue(
        numberPart(detail.acceleratedHours, "number"),
        "小时",
      ),
    ),
    displayRow(
      `${keyPrefix}-extra`,
      displayText("无人机额外产出"),
      resourceAmountDisplay(
        detail.extraAmount,
        detail.product,
        resourceAmountDisplayMode,
        "number",
        displayNumber(detail.extraAmount, "number"),
      ),
    ),
    ...droneMaterialRows(detail, keyPrefix, resourceAmountDisplayMode),
    ...droneOverflowRow(detail, keyPrefix),
  ];
}

function maaDroneRows(
  result: EfficiencyResult,
  details: readonly DroneAccelerationDetail[],
  resourceAmountDisplayMode?: ResourceAmountDisplayMode,
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
      ...droneCommonRows(detail, keyPrefix, resourceAmountDisplayMode),
    ];
  });
}

function facilityDroneRows(
  details: readonly DroneAccelerationDetail[],
  resourceAmountDisplayMode?: ResourceAmountDisplayMode,
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
      ...droneCommonRows(detail, keyPrefix, resourceAmountDisplayMode),
    ];
  });
}

function buildMaaDronePane(
  result: EfficiencyResult,
  resourceAmountDisplayMode?: ResourceAmountDisplayMode,
): DisplayPane | undefined {
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
          maaDroneRows(result, queue.details, resourceAmountDisplayMode),
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
            resourceAmountDisplay(
              candidate.baseAmountPerHour,
              candidate.product,
              resourceAmountDisplayMode,
              "number",
              displayValue(
                "基础 ",
                numberPart(candidate.baseAmountPerHour, "number"),
                "/小时",
              ),
              {
                unitSuffix: "/小时",
                prefix: "基础 ",
              },
            ),
            displayValue(
              "额外 ",
              ...(resourceAmountParts(
                candidate.extraAmount,
                candidate.product,
                resourceAmountDisplayMode,
                "number",
              ) ?? [
                numberPart(
                  candidate.extraAmount,
                  "number",
                ),
              ]),
              ...Object.entries(candidate.extraMaterial).flatMap(
                ([material, amount]) => [
                  " · ",
                  ...(resourceAmountParts(
                    amount,
                    material,
                    resourceAmountDisplayMode,
                    "signed",
                    { resourceFirst: true },
                  ) ?? [
                    resourceLabel(material),
                    " ",
                    numberPart(amount, "signed"),
                  ]),
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
      numberPart(acceleration.usedDrones, "number"),
      " 架",
    ),
    cards,
  };
}

function materialRows(
  keyPrefix: string,
  materials: readonly {
    material: string;
    baseAmountPerHour: number;
    dailyAmount: number;
    queueTotal: number;
  }[],
  resourceAmountDisplayMode?: ResourceAmountDisplayMode,
  options: { includeBaseRate?: boolean; includeMaterialLabel?: boolean } = {},
): DisplayRow[] {
  const includeBaseRate = options.includeBaseRate ?? true;
  const labelPrefix =
    options.includeMaterialLabel === false ? "" : "材料消耗 · ";
  return materials.flatMap((material) => {
    const label = resourceLabel(material.material);
    return [
      ...(includeBaseRate
        ? [
            displayRow(
              `${keyPrefix}-${material.material}-base`,
              displayText(`${labelPrefix}基础速率`),
              resourceAmountDisplay(
                material.baseAmountPerHour,
                material.material,
                resourceAmountDisplayMode,
                "signed",
                displayValue(
                  label,
                  " ",
                  numberPart(material.baseAmountPerHour, "signed"),
                  "/小时",
                ),
                {
                  unitSuffix: "/小时",
                  resourceFirst: true,
                },
              ),
            ),
          ]
        : []),
      displayRow(
        `${keyPrefix}-${material.material}-daily`,
        displayText(`${labelPrefix}队列折算总消耗`),
        resourceAmountDisplay(
          material.dailyAmount,
          material.material,
          resourceAmountDisplayMode,
          "signed",
          displayValue(
            label,
            " ",
            numberPart(material.dailyAmount, "signed"),
            "/日",
          ),
          {
            unitSuffix: "/日",
            resourceFirst: true,
          },
        ),
      ),
      displayRow(
        `${keyPrefix}-${material.material}-total`,
        displayText(`${labelPrefix}队列时长总消耗`),
        resourceAmountDisplay(
          material.queueTotal,
          material.material,
          resourceAmountDisplayMode,
          "signed",
          displayValue(
            label,
            " ",
            numberPart(material.queueTotal, "signed"),
          ),
          {
            resourceFirst: true,
          },
        ),
      ),
    ];
  });
}

function orderRows(
  facility: DailyOutputFacilityDetail,
  resourceAmountDisplayMode?: ResourceAmountDisplayMode,
): DisplayRow[] {
  return facility.orders.map((order: DailyOutputOrderDetail) =>
    displayRow(
      `${facility.label}-order-${order.name}-name`,
      displayValue(
        `订单摘要 · ${order.name} · `,
        numberPart(order.probability * 100, "number"),
        "%",
      ),
      displayValue(
        numberPart(order.quantity),
        " / ",
        numberPart(order.time, "number"),
        " 小时",
        ...(order.material
          ? [
              " · ",
              ...(resourceOrderParts(
                order.amount ?? 0,
                order.material,
                resourceAmountDisplayMode,
              ) ?? [
                resourceLabel(order.material),
                " × ",
                numberPart(order.amount ?? 0),
              ]),
            ]
          : []),
      ),
    ),
  );
}

function productSection(
  product: DailyOutputProductDetail,
  resourceAmountDisplayMode?: ResourceAmountDisplayMode,
): DisplaySection {
  const rows: DisplayRow[] = [
    displayRow(
      `${product.product}-efficiency`,
      displayText("总效率"),
      displayUnit(product.totalEfficiency, "number", "%"),
    ),
    displayRow(
      `${product.product}-total-output`,
      displayText("总产出速率"),
      resourceAmountDisplay(
        product.totalOutputPerHour,
        product.product,
        resourceAmountDisplayMode,
        "number",
        displayUnit(product.totalOutputPerHour, "number", "/小时"),
        { unitSuffix: "/小时" },
      ),
    ),
    displayRow(
      `${product.product}-daily`,
      displayText("队列折算总产出"),
      resourceAmountDisplay(
        product.dailyContribution,
        product.product,
        resourceAmountDisplayMode,
        "number",
        displayValue(
          numberPart(product.dailyContribution, "number"),
          "/日",
        ),
        { unitSuffix: "/日" },
      ),
    ),
    displayRow(
      `${product.product}-queue-total`,
      displayText("队列时长总产出"),
      resourceAmountDisplay(
        product.queueTotal,
        product.product,
        resourceAmountDisplayMode,
        "number",
        displayNumber(product.queueTotal, "number"),
      ),
    ),
  ];
  const sections: DisplaySection[] = [];
  if (product.materials.length) {
    sections.push({
      key: `${product.product}-materials`,
      label: "材料消耗合计",
      rows: materialRows(
        `${product.product}-material`,
        product.materials,
        resourceAmountDisplayMode,
        { includeBaseRate: false, includeMaterialLabel: false },
      ),
    });
  }
  if (product.facilities.length) {
    sections.push({
      key: `${product.product}-facilities`,
      label: "设施明细",
      rows: [],
      entries: product.facilities.map((facility) => ({
        key: `${product.product}-${facility.label}`,
        title: displayText(facility.label),
        rows: [
          displayRow(
            `${facility.label}-eff`,
            displayText("整体效率"),
            displayUnit(facility.totalEfficiency, "number", "%"),
          ),
          displayRow(
            `${facility.label}-base`,
            displayText("基础产出速率"),
            resourceAmountDisplay(
              facility.baseOutputPerHour,
              product.product,
              resourceAmountDisplayMode,
              "number",
              displayUnit(facility.baseOutputPerHour, "number", "/小时"),
              { unitSuffix: "/小时" },
            ),
          ),
          displayRow(
            `${facility.label}-total`,
            displayText("实际产出速率"),
            resourceAmountDisplay(
              facility.totalOutputPerHour,
              product.product,
              resourceAmountDisplayMode,
              "number",
              displayUnit(facility.totalOutputPerHour, "number", "/小时"),
              { unitSuffix: "/小时" },
            ),
          ),
          ...materialRows(
            `${facility.label}-material`,
            facility.materials,
            resourceAmountDisplayMode,
          ),
          ...orderRows(facility, resourceAmountDisplayMode),
        ],
      })),
    });
  }
  return {
    key: `product-${product.product}`,
    label: resourceLabel(product.product),
    rows,
    ...(sections.length ? { sections } : {}),
  };
}

function queueSanitySection(
  queue: DailyOutputQueueDetail,
  resourceAmountDisplayMode?: ResourceAmountDisplayMode,
): DisplaySection {
  const rows: DisplayRow[] = queue.sanity.items.map((item) => ({
    key: `sanity-${item.resource}`,
    label: resourceAmountDisplay(
      item.amount / (resourcePointInfo(item.resource)?.factor ?? 1),
      item.resource,
      resourceAmountDisplayMode,
      "signed",
      displayValue(
        item.label,
        " · ",
        numberPart(item.amount, "signed"),
        " ",
        item.amountUnit,
        "/日",
      ),
      {
        unitSuffix: "/日",
        resourceFirst: true,
      },
    ),
    ...(item.contribution === undefined
      ? { value: displayText("未计入") }
      : {
          value: displayValue(
            numberPart(item.contribution, "signed"),
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
      numberPart(queue.sanity.total, "signed"),
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
        ...queue.products.map((product) =>
          productSection(product, options.resourceAmountDisplayMode),
        ),
        queueSanitySection(queue, options.resourceAmountDisplayMode),
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
          numberPart(detail.value, "signed"),
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
        resourceAmountDisplay(
          production.baseAmountPerHour,
          production.product,
          options.resourceAmountDisplayMode,
          "number",
          displayUnit(production.baseAmountPerHour, "number", "/小时"),
          { unitSuffix: "/小时" },
        ),
      ),
      displayRow(
        "production-rate",
        displayText("实际速率"),
        resourceAmountDisplay(
          production.amountPerHour,
          production.product,
          options.resourceAmountDisplayMode,
          "number",
          displayUnit(production.amountPerHour, "number", "/小时"),
          { unitSuffix: "/小时" },
        ),
      ),
      displayRow(
        "production-item-rate",
        displayText("容量消耗速率"),
        production.itemRate === undefined
          ? displayText("")
          : resourceAmountDisplay(
              production.itemRate,
              production.product,
              options.resourceAmountDisplayMode,
              "number",
              displayValue(
                numberPart(production.itemRate, "number"),
                "/小时",
              ),
              {
                unitSuffix: "/小时",
              },
            ),
      ),
    );
    const materials = productionMaterialsForDisplay(
      production,
      options.simulateOverflow ?? false,
    );
    if (
      (facility.facility.type === "trading" ||
        facility.facility.type === "manufacture" ||
        facility.facility.type === "recycle") &&
      materials.length
    ) {
      materials.forEach((material, index) => {
        rows.push(
          displayRow(
            `facility-material-${material.material}-${index}-base`,
            displayText("基础材料消耗速率"),
            resourceAmountDisplay(
              material.baseAmount,
              material.material,
              options.resourceAmountDisplayMode,
              "signed",
              displayValue(
                resourceLabel(material.material),
                " ",
                numberPart(material.baseAmount, "signed"),
                "/小时",
              ),
              {
                unitSuffix: "/小时",
                resourceFirst: true,
              },
            ),
          ),
          displayRow(
            `facility-material-${material.material}-${index}-rate`,
            displayText("材料消耗速率"),
            resourceAmountDisplay(
              material.amount,
              material.material,
              options.resourceAmountDisplayMode,
              "signed",
              displayValue(
                resourceLabel(material.material),
                " ",
                numberPart(material.amount, "signed"),
                "/小时",
              ),
              {
                unitSuffix: "/小时",
                resourceFirst: true,
              },
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
          resourceAmountDisplay(
            convertedProductionAmount(production, production.amountPerHour),
            production.product,
            options.resourceAmountDisplayMode,
            "number",
            displayUnit(
              convertedProductionAmount(production, production.amountPerHour),
              "number",
              "/小时",
            ),
            { unitSuffix: "/小时" },
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
          numberPart(capacity.total, "number"),
          " ",
          capacity.unit,
          " （基础 ",
          numberPart(capacity.base, "number"),
          "，技能 ",
          numberPart(capacity.skill, "signed"),
          "）",
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
          numberPart(production.breachTime, "number"),
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
          numberPart(segment.startHours, "number"),
          " 小时 - ",
          numberPart(segment.endHours, "number"),
          " 小时",
        ),
        value: displayValue(
          numberPart(segment.total, "number"),
          " ",
          capacity.unit,
          " （基础 ",
          numberPart(segment.base, "number"),
          "，技能 ",
          numberPart(segment.skill, "signed"),
          "）",
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
          numberPart(order.probability * 100, "number"),
          "%",
        ),
        value: displayValue(
          numberPart(order.quantity),
          " / ",
          numberPart(order.time, "number"),
          " 小时",
          ...(order.material
            ? [
                " · ",
                ...(resourceOrderParts(
                  order.amount ?? 0,
                  order.material,
                  options.resourceAmountDisplayMode,
                ) ?? [
                  resourceLabel(order.material),
                  " × ",
                  numberPart(order.amount ?? 0),
                ]),
              ]
            : []),
        ),
      })),
    });
  }
  return displaySection("production-capacity", "产出与容量", rows, sections);
}

function tradeBaseRates(
  ruleset: EfficiencyRuleset,
  level: number,
): { lmdPerHour: number; goldPerHour: number } | undefined {
  const orders =
    ruleset.tradeOrdersByLevel[level] ?? ruleset.tradeOrdersByLevel[1] ?? [];
  let lmd = 0;
  let gold = 0;
  let hours = 0;
  for (const order of orders) {
    lmd += order.probability * order.gold;
    gold += order.probability * order.amount;
    hours += order.probability * order.hours;
  }
  if (hours <= 0 || gold <= 0) {
    return undefined;
  }
  return { lmdPerHour: lmd / hours, goldPerHour: gold / hours };
}

function tradeEquivalentRows(
  facility: FacilityEfficiencyResult,
  ruleset: EfficiencyRuleset,
): DisplayRow[] {
  const production = facility.production;
  if (
    facility.facility.type !== "trading" ||
    production?.product !== "龙门币" ||
    production.orderRule === undefined ||
    production.orderRule === "龙门商法"
  ) {
    return [];
  }
  const currentBase = tradeBaseRates(ruleset, facility.facility.level);
  const levelThreeBase = tradeBaseRates(ruleset, 3);
  if (!currentBase || currentBase.lmdPerHour <= 0) {
    return [];
  }
  const rows = [
    displayRow(
      "equivalent-current-trade-efficiency",
      displayText("等效当前站贸易效率"),
      displayUnit(
        (production.amountPerHour / currentBase.lmdPerHour) * 100,
        "number",
        "%",
      ),
    ),
  ];
  if (
    facility.facility.level !== 3 &&
    levelThreeBase !== undefined &&
    levelThreeBase.lmdPerHour > 0
  ) {
    rows.push(
      displayRow(
        "equivalent-level-three-trade-efficiency",
        displayText("等效3级站贸易效率"),
        displayUnit(
          (production.amountPerHour / levelThreeBase.lmdPerHour) * 100,
          "number",
          "%",
        ),
      ),
    );
  }
  const goldRule = ruleset.manufactureRules["赤金"];
  if (!goldRule || goldRule.hours <= 0) {
    return rows;
  }
  const lmdPerGold = currentBase.lmdPerHour / currentBase.goldPerHour;
  const goldManufactureRate = goldRule.amount / goldRule.hours;
  const extraGoldPerHour =
    production.amountPerHour / lmdPerGold +
    (production.materialPerHour?.["赤金"] ?? 0);
  if (goldManufactureRate > 0 && extraGoldPerHour > 0.000001) {
    rows.push(
      displayRow(
        "equivalent-manufacture-efficiency",
        displayText("等效制造效率"),
        displayUnit(
          (extraGoldPerHour / goldManufactureRate) * 100,
          "number",
          "%",
        ),
      ),
    );
  }
  return rows;
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
      ...tradeEquivalentRows(facility, options.ruleset ?? DEFAULT_RULESET),
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
        facilityDroneRows(
          step.droneAccelerations,
          options.resourceAmountDisplayMode,
        ),
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
  const maaDrone = buildMaaDronePane(result, options.resourceAmountDisplayMode);
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
