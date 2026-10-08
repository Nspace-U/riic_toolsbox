import materialSanityDefaults from "@/data/sanity-material-defaults.json";
import type { TorappuItem, TorappuItemTable } from "@/types/torappu";

export const SANITY_MATERIAL_DEFAULT_VALUES: Record<string, number> =
  materialSanityDefaults.values;

export function sanityMaterialItems(
  itemTable: TorappuItemTable | undefined,
): TorappuItem[] {
  return Object.values(itemTable?.items ?? {}).filter(
    (item) =>
      item.itemType === "MATERIAL" &&
      item.classifyType === "MATERIAL" &&
      item.sortId !== undefined &&
      item.sortId >= 100001 &&
      item.sortId <= 100060,
  );
}
