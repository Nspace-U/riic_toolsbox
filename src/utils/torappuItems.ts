import type { TorappuItemTable } from "@/types/torappu";

export const TORAPPU_RESOURCE_ITEM_IDS: Record<string, string> = {
  龙门币: "4001",
  合成玉: "4003",
  中级作战记录: "2003",
  赤金: "3003",
  源石碎片: "3141",
  无人机: "base_ap",
  信用: "SOCIAL_PT",
  公开招募标签刷新次数: "7001",
  固源岩: "30012",
  装置: "30062",
};

export const TORAPPU_SANITY_ICON_FILE = "AP_GAMEPLAY.png";

export function torappuItemIconPath(
  resource: string,
  itemTable: TorappuItemTable | undefined,
): string | undefined {
  const itemId =
    TORAPPU_RESOURCE_ITEM_IDS[resource] ??
    Object.values(itemTable?.items ?? {}).find((item) => item.name === resource)
      ?.itemId;
  return itemId ? itemTable?.items[itemId]?.localIconPath : undefined;
}
