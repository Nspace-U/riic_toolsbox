export const OPERATOR_AVATAR_LAYOUT = {
  professionSizeRatio: 0.25,
  eliteWidthRatio: 0.35,
  rarityHeightRatio: 0.18,
  nameHeightRatio: 0.14,
  nameMinHeight: 36,
  nameHorizontalPadding: 24,
  nameFontRatio: 0.7,
  nameMinFontSize: 12,
} as const

export function getOperatorAvatarNameHeight(imageWidth: number): number {
  return Math.max(
    OPERATOR_AVATAR_LAYOUT.nameMinHeight,
    Math.round(imageWidth * OPERATOR_AVATAR_LAYOUT.nameHeightRatio),
  )
}

export function getOperatorAvatarNameFontSize(nameHeight: number): number {
  return Math.max(
    OPERATOR_AVATAR_LAYOUT.nameMinFontSize,
    Math.round(nameHeight * OPERATOR_AVATAR_LAYOUT.nameFontRatio),
  )
}

export function getOperatorAvatarNameFontSizeForWidth(
  name: string,
  nameHeight: number,
  maxWidth: number,
  measureText: (name: string, fontSize: number) => number,
): number {
  let fontSize = getOperatorAvatarNameFontSize(nameHeight)
  while (
    fontSize > OPERATOR_AVATAR_LAYOUT.nameMinFontSize
    && measureText(name, fontSize) > maxWidth
  ) {
    fontSize -= 1
  }
  return fontSize
}