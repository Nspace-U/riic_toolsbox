import type { DataSourceId } from '@/composables/useDataSource'
import type { EliteLevel, Operator, OperatorAvatars } from '@/types/baseData'
import { generateOperatorAvatar } from '@/utils/generateOperatorAvatar'
import {
  getEliteIconUrl,
  getProfessionIconUrl,
  getRarityIconUrl,
} from '@/utils/operatorAvatarAssets'

const AVATAR_KEYS: Record<EliteLevel, keyof OperatorAvatars> = {
  0: 'elite0',
  1: 'elite1',
  2: 'elite2',
}

export interface OperatorAvatarRenderOptions {
  eliteLevel: EliteLevel
  showRarity: boolean
  showEliteLevel: boolean
  showProfession: boolean
  moodScattered: boolean
}

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

export function getOperatorAvatarFile(
  operator: Operator,
  eliteLevel: EliteLevel,
): string {
  return operator.avatars[AVATAR_KEYS[eliteLevel]]
}

export function getOperatorAvatarSourceUrl(
  dataSource: DataSourceId,
  fileName: string,
): string {
  const directory = dataSource === 'torappu'
    ? 'assets/raw/char_avatar'
    : 'assets/operator-avatars'
  const encodedFileName = encodeURIComponent(fileName)
    .replace(/%2B/g, '+')
    .replace(/%26/g, '&')
  return assetUrl(`${directory}/${encodedFileName}`)
}

export async function generateOperatorAvatarUrl(
  operator: Operator,
  dataSource: DataSourceId,
  options: OperatorAvatarRenderOptions,
): Promise<string | undefined> {
  const avatarFile = getOperatorAvatarFile(operator, options.eliteLevel)
  if (!avatarFile) {
    return undefined
  }

  const imageBlob = await generateOperatorAvatar({
    imageUrl: getOperatorAvatarSourceUrl(dataSource, avatarFile),
    professionIconUrl: getProfessionIconUrl(operator.profession),
    eliteIconUrl: getEliteIconUrl(options.eliteLevel),
    rarityIconUrl: operator.rarity > 0 ? getRarityIconUrl(operator.rarity) : undefined,
    showRarity: options.showRarity,
    showEliteLevel: options.showEliteLevel,
    showProfession: options.showProfession,
    moodScattered: options.moodScattered,
  })
  return URL.createObjectURL(imageBlob)
}
