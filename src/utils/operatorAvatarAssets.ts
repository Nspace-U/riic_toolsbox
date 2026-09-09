const TORAPPU_ASSET_BASE_URL = "https://torappu.prts.wiki/assets";
const PROFESSION_ICON_BASE_URL = "https://media.prts.wiki";

const PROFESSION_LABELS: Record<string, string> = {
  CASTER: "术师",
  MEDIC: "医疗",
  PIONEER: "先锋",
  SNIPER: "狙击",
  SPECIAL: "特种",
  SUPPORT: "辅助",
  TANK: "重装",
  WARRIOR: "近卫",
};

const PROFESSION_ICON_PATHS: Record<string, string> = {
  近卫: "/7/7d/%E5%9B%BE%E6%A0%87_%E8%81%8C%E4%B8%9A_%E8%BF%91%E5%8D%AB.png",
  医疗: "/b/be/%E5%9B%BE%E6%A0%87_%E8%81%8C%E4%B8%9A_%E5%8C%BB%E7%96%97.png",
  先锋: "/7/78/%E5%9B%BE%E6%A0%87_%E8%81%8C%E4%B8%9A_%E5%85%88%E9%94%8B.png",
  狙击: "/9/96/%E5%9B%BE%E6%A0%87_%E8%81%8C%E4%B8%9A_%E7%8B%99%E5%87%BB.png",
  特种: "/f/f1/%E5%9B%BE%E6%A0%87_%E8%81%8C%E4%B8%9A_%E7%89%B9%E7%A7%8D.png",
  辅助: "/c/c7/%E5%9B%BE%E6%A0%87_%E8%81%8C%E4%B8%9A_%E8%BE%85%E5%8A%A9.png",
  重装: "/3/3c/%E5%9B%BE%E6%A0%87_%E8%81%8C%E4%B8%9A_%E9%87%8D%E8%A3%85.png",
  术师: "/2/23/%E5%9B%BE%E6%A0%87_%E8%81%8C%E4%B8%9A_%E6%9C%AF%E5%B8%88.png",
};

export function getEliteIconUrl(eliteLevel: number): string {
  return `${TORAPPU_ASSET_BASE_URL}/elite_icon/elite_${eliteLevel}_large.png`;
}

export function getRarityIconUrl(rarity: number): string {
  const rarityIndex = Math.max(0, rarity - 1);
  return `${TORAPPU_ASSET_BASE_URL}/rarity_icon/rarity_yellow_${rarityIndex}.png`;
}

export function getProfessionIconUrl(profession: string): string | undefined {
  const professionLabel = PROFESSION_LABELS[profession] ?? profession;
  const path = PROFESSION_ICON_PATHS[professionLabel];
  return path ? `${PROFESSION_ICON_BASE_URL}${path}` : undefined;
}
