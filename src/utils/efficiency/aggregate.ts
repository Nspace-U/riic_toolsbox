import type {
  CluePreference,
  DailyOutput,
  EfficiencyPlanResult,
  FacilityEfficiencyResult,
  ProductionValue,
} from "@/types/efficiency";
import type { ScheduleDocument } from "@/types/schedule";
import {
  CREDIT_BASE_DAILY,
  DAILY_OUTPUT_ORDER,
  EPSILON,
} from "@/utils/efficiency/model";
import { CREDIT_PER_CLUE } from "@/utils/efficiency/baseRules";
import { canonicalResourceKey } from "@/utils/schedule";

function cluePreferenceRank(preference: CluePreference): number {
  if (typeof preference === "number") return preference;
  return preference === "unowned" ? 8 : 9;
}

function sortedCluePreferences(
  preferences: Iterable<CluePreference>,
): CluePreference[] {
  return [...new Set(preferences)].sort(
    (left, right) => cluePreferenceRank(left) - cluePreferenceRank(right),
  );
}

export function aggregateDaily(
  plans: EfficiencyPlanResult[],
  totalHours: number,
): FacilityEfficiencyResult[] {
  const first = plans[0]?.facilities ?? [];
  return first.map((result) => {
    const amounts = plans
      .map(
        (plan) =>
          plan.facilities.find(
            (candidate) => candidate.facility.id === result.facility.id,
          )?.production,
      )
      .filter((production): production is ProductionValue => !!production);
    const cluePreferences = sortedCluePreferences(
      plans.flatMap(
        (plan) =>
          plan.facilities.find(
            (candidate) => candidate.facility.id === result.facility.id,
          )?.cluePreferences ?? [],
      ),
    );
    if (amounts.length === 0 || totalHours <= EPSILON) return result;
    const totals = plans.reduce(
      (sum, plan) => {
        const production = plan.facilities.find(
          (candidate) => candidate.facility.id === result.facility.id,
        )?.production;
        if (!production) return sum;
        sum.base += (production.baseAmountPerHour ?? 0) * plan.durationHours;
        sum.actual += production.amountPerHour * plan.durationHours;
        sum.effective +=
          (production.effectiveAmountPerHour ?? production.amountPerHour) *
          plan.durationHours;
        return sum;
      },
      { base: 0, actual: 0, effective: 0 },
    );
    const amountPerHour = totals.actual / totalHours;
    const effectiveAmountPerHour = totals.effective / totalHours;
    return {
      ...result,
      ...(cluePreferences.length > 0 ? { cluePreferences } : {}),
      production: {
        ...result.production,
        product: canonicalResourceKey(
          amounts[0]?.product ?? result.production?.product ?? "",
        ),
        ...(cluePreferences.length > 0 ? { cluePreferences } : {}),
        baseAmountPerHour: totals.base / totalHours,
        baseAmountPerDay: (totals.base / totalHours) * 24,
        amountPerHour,
        amountPerDay: amountPerHour * 24,
        ...(Math.abs(effectiveAmountPerHour - amountPerHour) > EPSILON
          ? {
              effectiveAmountPerHour,
              effectiveAmountPerDay: effectiveAmountPerHour * 24,
            }
          : {}),
      },
    };
  });
}

export function aggregateDailyProductions(
  plans: EfficiencyPlanResult[],
  totalHours: number,
): ProductionValue[] {
  if (totalHours <= EPSILON) {
    return [];
  }

  const grouped = new Map<
    string,
    {
      basePerCycle: number;
      actualPerCycle: number;
      effectivePerCycle: number;
      conversion?: ProductionValue["conversion"];
      cluePreferences: CluePreference[];
      materialsPerCycle: Record<string, number>;
      effectiveMaterialsPerCycle: Record<string, number>;
    }
  >();
  plans.forEach((plan) => {
    plan.facilities.forEach((facility) => {
      const production = facility.production;
      if (!production) {
        return;
      }
      const product = canonicalResourceKey(production.product);
      const rate =
        production.effectiveAmountPerHour ?? production.amountPerHour;
      const current = grouped.get(product) ?? {
        basePerCycle: 0,
        actualPerCycle: 0,
        effectivePerCycle: 0,
        conversion: production.conversion,
        cluePreferences: [],
        materialsPerCycle: {},
        effectiveMaterialsPerCycle: {},
      };
      if (!current.conversion && production.conversion) {
        current.conversion = production.conversion;
      }
      current.cluePreferences = sortedCluePreferences([
        ...current.cluePreferences,
        ...(production.cluePreferences ?? []),
      ]);
      current.basePerCycle +=
        (production.baseAmountPerHour ?? production.amountPerHour) *
        plan.durationHours;
      current.actualPerCycle += production.amountPerHour * plan.durationHours;
      current.effectivePerCycle += rate * plan.durationHours;
      Object.entries(production.materialPerHour ?? {}).forEach(
        ([material, amount]) => {
          const resource = canonicalResourceKey(material);
          current.materialsPerCycle[resource] =
            (current.materialsPerCycle[resource] ?? 0) +
            amount * plan.durationHours;
        },
      );
      Object.entries(
        production.effectiveMaterialPerHour ?? production.materialPerHour ?? {},
      ).forEach(([material, amount]) => {
        const resource = canonicalResourceKey(material);
        current.effectiveMaterialsPerCycle[resource] =
          (current.effectiveMaterialsPerCycle[resource] ?? 0) +
          amount * plan.durationHours;
      });
      grouped.set(product, current);
    });
  });

  return Array.from(grouped, ([product, value]) => {
    const baseAmountPerHour = value.basePerCycle / totalHours;
    const amountPerHour = value.actualPerCycle / totalHours;
    const effectiveAmountPerHour = value.effectivePerCycle / totalHours;
    const materialPerHour = Object.fromEntries(
      Object.entries(value.materialsPerCycle).map(([material, amount]) => [
        material,
        amount / totalHours,
      ]),
    );
    const effectiveMaterialPerHour = Object.fromEntries(
      Object.entries(value.effectiveMaterialsPerCycle).map(
        ([material, amount]) => [material, amount / totalHours],
      ),
    );
    return {
      product,
      ...(value.cluePreferences.length > 0
        ? { cluePreferences: value.cluePreferences }
        : {}),
      ...(value.conversion ? { conversion: value.conversion } : {}),
      baseAmountPerHour,
      baseAmountPerDay: baseAmountPerHour * 24,
      amountPerHour,
      amountPerDay: amountPerHour * 24,
      ...(Math.abs(effectiveAmountPerHour - amountPerHour) > EPSILON
        ? {
            effectiveAmountPerHour,
            effectiveAmountPerDay: effectiveAmountPerHour * 24,
          }
        : {}),
      ...(Object.keys(materialPerHour).length > 0 ? { materialPerHour } : {}),
      ...(Math.abs(effectiveAmountPerHour - amountPerHour) > EPSILON &&
      Object.keys(effectiveMaterialPerHour).length > 0
        ? { effectiveMaterialPerHour }
        : {}),
    };
  });
}

function selectedDailyAmount(production: ProductionValue): number {
  return production.effectiveAmountPerDay ?? production.amountPerDay;
}

export function aggregateDailyOutputs(
  document: ScheduleDocument,
  productions: ProductionValue[],
): DailyOutput[] {
  const gross = new Map<string, number>();
  const materials = new Map<string, number>();
  productions.forEach((production) => {
    const product = canonicalResourceKey(production.product);
    if (product !== "Clue") {
      gross.set(product, selectedDailyAmount(production));
    }
    const rates =
      production.effectiveMaterialPerHour ?? production.materialPerHour ?? {};
    Object.entries(rates).forEach(([material, rate]) => {
      const resource = canonicalResourceKey(material);
      materials.set(resource, (materials.get(resource) ?? 0) + rate * 24);
    });
  });
  const dormitoryCredit = document.layout
    .filter((entry) => entry.type === "dormitory")
    .reduce(
      (total, entry) => total + Math.floor(10 + (entry.level * 1000) / 125),
      0,
    );
  const clue = productions.find(
    (production) => canonicalResourceKey(production.product) === "Clue",
  );
  gross.set(
    "Credit",
    CREDIT_BASE_DAILY +
      dormitoryCredit +
      (clue ? selectedDailyAmount(clue) * CREDIT_PER_CLUE : 0),
  );

  const grossOutputs = DAILY_OUTPUT_ORDER.flatMap((product) => {
    const amountPerDay = gross.get(product);
    return amountPerDay === undefined || Math.abs(amountPerDay) <= EPSILON
      ? []
      : [{ product, kind: "production" as const, amountPerDay }];
  });
  const netOutputs = Array.from(materials, ([product, consumed]) => ({
    product,
    kind: "net" as const,
    amountPerDay: (gross.get(product) ?? 0) + consumed,
    consumed,
  }))
    .filter(
      (output) =>
        output.consumed < -EPSILON && Math.abs(output.amountPerDay) > EPSILON,
    )
    .sort(
      (left, right) =>
        (DAILY_OUTPUT_ORDER.indexOf(left.product) < 0
          ? DAILY_OUTPUT_ORDER.length
          : DAILY_OUTPUT_ORDER.indexOf(left.product)) -
          (DAILY_OUTPUT_ORDER.indexOf(right.product) < 0
            ? DAILY_OUTPUT_ORDER.length
            : DAILY_OUTPUT_ORDER.indexOf(right.product)) ||
        left.product.localeCompare(right.product),
    )
    .map(({ product, kind, amountPerDay }) => ({
      product,
      kind,
      amountPerDay,
    }));
  return [...grossOutputs, ...netOutputs];
}
