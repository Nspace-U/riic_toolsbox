export const OPERATOR_AVATAR_LAYOUT = {
  professionSizeRatio: 0.25,
  eliteWidthRatio: 0.35,
  rarityHeightRatio: 0.18,
  nameHeightRatio: 0.14,
  nameMinHeight: 36,
  nameHorizontalPadding: 24,
  nameFontRatio: 0.7,
  nameMinFontSize: 12,
} as const;

export const OPERATOR_AVATAR_SOURCE_WIDTH = 180;

export interface OperatorAvatarNameMetrics {
  height: number;
  fontSize: number;
}

export function getOperatorAvatarNameHeight(imageWidth: number): number {
  return Math.max(
    OPERATOR_AVATAR_LAYOUT.nameMinHeight,
    Math.round(imageWidth * OPERATOR_AVATAR_LAYOUT.nameHeightRatio),
  );
}

export function getOperatorAvatarNameFontSize(nameHeight: number): number {
  return Math.max(
    OPERATOR_AVATAR_LAYOUT.nameMinFontSize,
    Math.round(nameHeight * OPERATOR_AVATAR_LAYOUT.nameFontRatio),
  );
}

export function getOperatorAvatarNameFontSizeForWidth(
  name: string,
  nameHeight: number,
  maxWidth: number,
  measureText: (name: string, fontSize: number) => number,
): number {
  let fontSize = getOperatorAvatarNameFontSize(nameHeight);
  while (
    fontSize > OPERATOR_AVATAR_LAYOUT.nameMinFontSize &&
    measureText(name, fontSize) > maxWidth
  ) {
    fontSize -= 1;
  }
  return fontSize;
}

export function normalizeOperatorAvatarOutputWidth(
  targetWidth: number | undefined,
  sourceWidth: number,
): number {
  if (targetWidth === undefined || !Number.isFinite(targetWidth)) {
    return sourceWidth;
  }
  return Math.min(Math.max(Math.round(targetWidth), 1), sourceWidth);
}

export function getOperatorAvatarScale(
  sourceWidth: number,
  outputWidth: number,
): number {
  return sourceWidth > 0 ? outputWidth / sourceWidth : 1;
}

export function getScaledOperatorAvatarLength(
  sourceLength: number,
  scale: number,
): number {
  return Math.max(1, Math.round(sourceLength * scale));
}

export function getOperatorAvatarProportionalNameMetrics(
  name: string,
  sourceWidth: number,
  outputWidth: number,
  measureText: (name: string, fontSize: number) => number,
): OperatorAvatarNameMetrics {
  const sourceNameHeight = getOperatorAvatarNameHeight(sourceWidth);
  const scale = getOperatorAvatarScale(sourceWidth, outputWidth);
  const sourceFontSize = getOperatorAvatarNameFontSizeForWidth(
    name,
    sourceNameHeight,
    Math.max(1, sourceWidth - OPERATOR_AVATAR_LAYOUT.nameHorizontalPadding),
    measureText,
  );
  return {
    height: getScaledOperatorAvatarLength(sourceNameHeight, scale),
    fontSize: getScaledOperatorAvatarLength(sourceFontSize, scale),
  };
}
