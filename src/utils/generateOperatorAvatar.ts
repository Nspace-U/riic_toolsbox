export interface OperatorAvatarGenerationOptions {
  imageUrl: string
  operatorName: string
  professionIconUrl?: string
  eliteIconUrl?: string
  rarityIconUrl?: string
  showRarity: boolean
  showEliteLevel: boolean
  showProfession: boolean
  showName: boolean
  moodScattered: boolean
}

const imageCache = new Map<string, Promise<HTMLImageElement>>()
const LONGEST_OPERATOR_NAME = '泰拉大陆调查团'

function loadImage(imageUrl: string): Promise<HTMLImageElement> {
  const cachedImage = imageCache.get(imageUrl)
  if (cachedImage) {
    return cachedImage
  }

  const imagePromise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => {
      imageCache.delete(imageUrl)
      reject(new Error('头像图片读取失败，请检查当前阶段是否有对应资源'))
    }
    image.src = imageUrl
  })
  imageCache.set(imageUrl, imagePromise)
  return imagePromise
}

function loadOptionalImage(imageUrl: string | undefined): Promise<HTMLImageElement | undefined> {
  return imageUrl ? loadImage(imageUrl) : Promise.resolve(undefined)
}

interface AvatarOverlayImages {
  profession: HTMLImageElement | undefined
  elite: HTMLImageElement | undefined
  rarity: HTMLImageElement | undefined
}

async function loadOverlayImages(options: OperatorAvatarGenerationOptions): Promise<AvatarOverlayImages> {
  const [profession, elite, rarity] = await Promise.all([
    loadOptionalImage(options.professionIconUrl),
    loadOptionalImage(options.eliteIconUrl),
    loadOptionalImage(options.rarityIconUrl),
  ])
  return { profession, elite, rarity }
}

function drawMetadata(
  context: CanvasRenderingContext2D,
  images: AvatarOverlayImages,
  width: number,
  height: number,
  options: OperatorAvatarGenerationOptions,
): void {
  if (options.showProfession && images.profession) {
    const professionSize = Math.round(width * 0.25)
    context.drawImage(images.profession, 0, 0, professionSize, professionSize)
  }

  if (options.showEliteLevel && images.elite) {
    const eliteWidth = Math.round(width * 0.35)
    const eliteHeight = Math.round(eliteWidth * (images.elite.naturalHeight / images.elite.naturalWidth))
    context.drawImage(images.elite, 0, height - eliteHeight, eliteWidth, eliteHeight)
  }

  if (options.showRarity && images.rarity) {
    const rarityHeight = Math.round(height * 0.18)
    const rarityWidth = Math.round(rarityHeight * (images.rarity.naturalWidth / images.rarity.naturalHeight))
    context.drawImage(images.rarity, width - rarityWidth, height - rarityHeight, rarityWidth, rarityHeight)
  }
}

function drawOperatorName(
  context: CanvasRenderingContext2D,
  operatorName: string,
  width: number,
  avatarHeight: number,
  nameHeight: number,
): void {
  const maxTextWidth = Math.max(1, width - 24)
  let fontSize = Math.max(12, Math.round(nameHeight * 0.5))
  context.font = `600 ${fontSize}px "Segoe UI", sans-serif`
  while (fontSize > 12 && context.measureText(LONGEST_OPERATOR_NAME).width > maxTextWidth) {
    fontSize -= 1
    context.font = `600 ${fontSize}px "Segoe UI", sans-serif`
  }

  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(operatorName, width / 2, avatarHeight + nameHeight / 2, maxTextWidth)
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }
      reject(new Error('头像图片生成失败'))
    }, 'image/png')
  })
}

export async function generateOperatorAvatar(
  options: OperatorAvatarGenerationOptions,
): Promise<Blob> {
  const image = await loadImage(options.imageUrl)
  const overlayImages = await loadOverlayImages(options)
  const nameHeight = options.showName && options.operatorName
    ? Math.max(36, Math.round(image.naturalWidth * 0.14))
    : 0
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight + nameHeight

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('当前浏览器不支持头像图片生成')
  }

  context.drawImage(image, 0, 0)

  if (options.moodScattered) {
    context.fillStyle = 'rgba(255, 0, 0, 0.5)'
    context.fillRect(0, 0, image.naturalWidth, image.naturalHeight)
  }

  drawMetadata(context, overlayImages, image.naturalWidth, image.naturalHeight, options)

  if (nameHeight > 0) {
    drawOperatorName(context, options.operatorName, image.naturalWidth, image.naturalHeight, nameHeight)
  }

  return canvasToBlob(canvas)
}
