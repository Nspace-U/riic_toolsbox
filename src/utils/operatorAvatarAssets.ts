const AVATAR_METADATA_ICON_BASE_PATH = "assets/raw";

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

const PROFESSION_ICON_FILES: Record<string, string> = {
  近卫: "icon_profession_warrior_large.png",
  医疗: "icon_profession_medic_large.png",
  先锋: "icon_profession_pioneer_large.png",
  狙击: "icon_profession_sniper_large.png",
  特种: "icon_profession_special_large.png",
  辅助: "icon_profession_support_large.png",
  重装: "icon_profession_tank_large.png",
  术师: "icon_profession_caster_large.png",
};

function localAvatarMetadataIconUrl(
  directory: string,
  fileName: string,
): string {
  return `${import.meta.env.BASE_URL}${AVATAR_METADATA_ICON_BASE_PATH}/${directory}/${fileName}`;
}

export function getEliteIconUrl(eliteLevel: number): string {
  return localAvatarMetadataIconUrl(
    "elite_icon",
    `elite_${eliteLevel}_large.png`,
  );
}

export function getRarityIconUrl(rarity: number): string {
  const rarityIndex = Math.max(0, rarity - 1);
  return localAvatarMetadataIconUrl(
    "rarity_icon",
    `rarity_yellow_${rarityIndex}.png`,
  );
}

export function getProfessionIconUrl(profession: string): string | undefined {
  const professionLabel = PROFESSION_LABELS[profession] ?? profession;
  const fileName = PROFESSION_ICON_FILES[professionLabel];
  return fileName
    ? localAvatarMetadataIconUrl("profession_large_icon", fileName)
    : undefined;
}
