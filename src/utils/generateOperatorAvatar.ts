import type { EliteLevel } from '@/types/baseData'

export interface OperatorAvatarGenerationOptions {
  imageUrl: string
  professionIconUrl?: string
  eliteIconUrl?: string
  rarityIconUrl?: string
  showRarity: boolean
  showEliteLevel: boolean
  showProfession: boolean
  moodScattered: boolean
}

function loadImage(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('头像图片读取失败，请检查当前阶段是否有对应资源'))
    image.src = imageUrl
  })
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
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('当前浏览器不支持头像图片生成')
  }

  context.save()
  context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight)
  context.restore()

  if (options.moodScattered) {
    context.fillStyle = 'rgba(255, 0, 0, 0.5)'
    context.fillRect(0, 0, image.naturalWidth, image.naturalHeight)
  }

  drawMetadata(context, overlayImages, image.naturalWidth, image.naturalHeight, options)

  return canvasToBlob(canvas)
}
