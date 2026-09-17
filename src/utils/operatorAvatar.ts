import type { EliteLevel, Operator, OperatorAvatars } from "@/types/baseData";
import { generateOperatorAvatar } from "@/utils/generateOperatorAvatar";
import {
  getEliteIconUrl,
  getProfessionIconUrl,
  getRarityIconUrl,
} from "@/utils/operatorAvatarAssets";

const AVATAR_KEYS: Record<EliteLevel, keyof OperatorAvatars> = {
  0: "elite0",
  1: "elite1",
  2: "elite2",
};

export interface OperatorAvatarRenderOptions {
  eliteLevel: EliteLevel;
  showRarity: boolean;
  showEliteLevel: boolean;
  showProfession: boolean;
  showName: boolean;
  moodScattered: boolean;
  operatorOwned: boolean;
  operatorTrainingUpgraded: boolean;
  outputWidth?: number;
}

export interface OperatorAvatarLayerSources {
  avatarUrl?: string;
  professionIconUrl?: string;
  eliteIconUrl: string;
  rarityIconUrl?: string;
}

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

export function getOperatorAvatarFile(
  operator: Operator,
  eliteLevel: EliteLevel,
): string {
  for (let level = eliteLevel; level >= 0; level -= 1) {
    const file = operator.avatars[AVATAR_KEYS[level as EliteLevel]];
    if (file) {
      return file;
    }
  }
  return "";
}

export function getOperatorAvatarSourceUrl(fileName: string): string {
  const encodedFileName = encodeURIComponent(fileName)
    .replace(/%2B/g, "+")
    .replace(/%26/g, "&");
  return assetUrl(`assets/raw/char_avatar/${encodedFileName}`);
}

export function getOperatorAvatarLayerSources(
  operator: Operator,
  eliteLevel: EliteLevel,
): OperatorAvatarLayerSources {
  const avatarFile = getOperatorAvatarFile(operator, eliteLevel);
  return {
    avatarUrl: avatarFile ? getOperatorAvatarSourceUrl(avatarFile) : undefined,
    professionIconUrl: getProfessionIconUrl(operator.profession),
    eliteIconUrl: getEliteIconUrl(eliteLevel),
    rarityIconUrl:
      operator.rarity > 0 ? getRarityIconUrl(operator.rarity) : undefined,
  };
}

export async function generateOperatorAvatarBlob(
  operator: Operator,
  options: OperatorAvatarRenderOptions,
): Promise<Blob | undefined> {
  const sources = getOperatorAvatarLayerSources(operator, options.eliteLevel);
  if (!sources.avatarUrl) {
    return undefined;
  }

  return generateOperatorAvatar({
    imageUrl: sources.avatarUrl,
    operatorName: operator.name,
    professionIconUrl: sources.professionIconUrl,
    eliteIconUrl: sources.eliteIconUrl,
    rarityIconUrl: sources.rarityIconUrl,
    showRarity: options.showRarity,
    showEliteLevel: options.showEliteLevel,
    showProfession: options.showProfession,
    showName: options.showName,
    moodScattered: options.moodScattered,
    operatorOwned: options.operatorOwned,
    operatorTrainingUpgraded: options.operatorTrainingUpgraded,
    outputWidth: options.outputWidth,
  });
}

export async function generateOperatorAvatarUrl(
  operator: Operator,
  options: OperatorAvatarRenderOptions,
): Promise<string | undefined> {
  const imageBlob = await generateOperatorAvatarBlob(operator, options);
  if (!imageBlob) {
    return undefined;
  }
  return URL.createObjectURL(imageBlob);
}
