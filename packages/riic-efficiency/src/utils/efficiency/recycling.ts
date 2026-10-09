import type { RecycleRules } from "./baseRules";
import type { RecycleItemOutputRate } from "../../types/efficiency";

export const RECYCLE_OUTPUT_PRODUCT = "精英材料";

export function expectedRecycleOutputPerDraw(
  rules: RecycleRules | undefined,
): Array<{ itemId: string; name: string; amount: number }> {
  const pool = rules?.outputPool;
  if (!pool) {
    return [];
  }

  const normalWeight = pool.normalItems.reduce(
    (total, item) => total + item.weight,
    0,
  );
  const extraWeight = pool.extraItems.reduce(
    (total, item) => total + item.weight,
    0,
  );
  if (normalWeight <= 0 || extraWeight <= 0) {
    return [];
  }

  const expectedExtraProgress =
    pool.normalItems.reduce(
      (total, item) => total + item.weight * item.extraPoolValueChange,
      0,
    ) / normalWeight;
  const normalDrawsPerExtra =
    expectedExtraProgress > 0
      ? pool.extraPoolRequirement / expectedExtraProgress
      : Number.POSITIVE_INFINITY;
  const extraDrawShare =
    Number.isFinite(normalDrawsPerExtra) && normalDrawsPerExtra > 0
      ? 1 / (normalDrawsPerExtra + 1)
      : 0;
  const normalDrawShare = 1 - extraDrawShare;
  const outputs = new Map<
    string,
    { itemId: string; name: string; amount: number }
  >();

  function addPoolItems(
    items: NonNullable<RecycleRules["outputPool"]>["normalItems"],
    weight: number,
    share: number,
  ): void {
    items.forEach((item) => {
      const amount = share * (item.weight / weight) * item.count;
      const current = outputs.get(item.itemId);
      outputs.set(item.itemId, {
        itemId: item.itemId,
        name: item.name,
        amount: (current?.amount ?? 0) + amount,
      });
    });
  }

  addPoolItems(pool.normalItems, normalWeight, normalDrawShare);
  addPoolItems(pool.extraItems, extraWeight, extraDrawShare);
  return [...outputs.values()];
}

export function recycleOutputRates(
  rules: RecycleRules | undefined,
  drawRatePerHour: number,
): RecycleItemOutputRate[] {
  return expectedRecycleOutputPerDraw(rules).map((item) => ({
    itemId: item.itemId,
    name: item.name,
    amountPerHour: item.amount * drawRatePerHour,
  }));
}

export function recycleOutputItemSanity(
  rules: RecycleRules | undefined,
  materialValues: Readonly<Record<string, number | null>>,
): number | null {
  const items = expectedRecycleOutputPerDraw(rules);
  const totalAmount = items.reduce((total, item) => total + item.amount, 0);
  if (totalAmount <= 0) {
    return null;
  }

  let totalSanity = 0;
  for (const item of items) {
    const sanity = materialValues[item.itemId];
    if (sanity === undefined || sanity === null) {
      return null;
    }
    totalSanity += sanity * item.amount;
  }
  return totalSanity / totalAmount;
}
