export const OPERATOR_AVATAR_LAYOUT = {
  professionSizeRatio: 0.25,
  eliteWidthRatio: 0.35,
  rarityHeightRatio: 0.18,
  nameHeightRatio: 0.14,
  nameMinHeight: 36,
  nameFitCharacterCount: 6,
  nameOutputMinHeight: 24,
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

export function getOperatorAvatarNameFontSize(imageWidth: number): number {
  return Math.max(
    1,
    Math.round(imageWidth / OPERATOR_AVATAR_LAYOUT.nameFitCharacterCount),
  );
}

export function getOperatorAvatarNameHorizontalPadding(
  imageWidth: number,
): number {
  return getOperatorAvatarNameFontSize(imageWidth);
}

export function getOperatorAvatarSkippedLabelFontSize(
  imageWidth: number,
): number {
  return Math.max(10, getOperatorAvatarNameFontSize(imageWidth));
}

export function getOperatorAvatarNameFontSizeForWidth(
  name: string,
  imageWidth: number,
  maxWidth: number,
  measureText: (name: string, fontSize: number) => number,
): number {
  let fontSize = getOperatorAvatarNameFontSize(imageWidth);
  while (fontSize > 1 && measureText(name, fontSize) > maxWidth) {
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

export function getOperatorAvatarNameMaxTextWidth(outputWidth: number): number {
  return Math.max(
    1,
    outputWidth - getOperatorAvatarNameHorizontalPadding(outputWidth),
  );
}

export function getOperatorAvatarNameMinBandMetrics(
  sourceWidth: number,
  outputWidth: number,
): OperatorAvatarNameMetrics {
  const scale = getOperatorAvatarScale(sourceWidth, outputWidth);
  const sourceNameHeight = getOperatorAvatarNameHeight(sourceWidth);
  return {
    height: Math.max(
      getScaledOperatorAvatarLength(sourceNameHeight, scale),
      OPERATOR_AVATAR_LAYOUT.nameOutputMinHeight,
    ),
    fontSize: getOperatorAvatarNameFontSize(outputWidth),
  };
}

export function getOperatorAvatarProportionalNameMetrics(
  name: string,
  sourceWidth: number,
  outputWidth: number,
  measureText: (name: string, fontSize: number) => number,
): OperatorAvatarNameMetrics {
  return {
    height: getOperatorAvatarNameMinBandMetrics(sourceWidth, outputWidth)
      .height,
    fontSize: getOperatorAvatarNameFontSizeForWidth(
      name,
      outputWidth,
      getOperatorAvatarNameMaxTextWidth(outputWidth),
      measureText,
    ),
  };
}
