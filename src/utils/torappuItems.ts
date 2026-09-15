import type { TorappuItemTable } from "@/types/torappu";

export const TORAPPU_RESOURCE_ITEM_IDS: Record<string, string> = {
  LMD: "4001",
  Orundum: "4003",
  "Battle Record": "2003",
  "Pure Gold": "3003",
  "Originium Shard": "3141",
  Drone: "base_ap",
  Credit: "SOCIAL_PT",
  "Recruit Refresh": "7001",
  固源岩: "30012",
  装置: "30062",
};

export function torappuItemIconPath(
  resource: string,
  itemTable: TorappuItemTable | undefined,
): string | undefined {
  const itemId = TORAPPU_RESOURCE_ITEM_IDS[resource];
  return itemId ? itemTable?.items[itemId]?.localIconPath : undefined;
}
