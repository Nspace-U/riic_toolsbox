import type { EliteLevel } from '@/types/baseData'

export interface OperatorAvatarGenerationOptions {
  imageUrl: string
  operatorName: string
  rarity: number
  profession: string
  eliteLevel: EliteLevel
  showRarity: boolean
  showEliteLevel: boolean
  showProfession: boolean
  moodScattered: boolean
}

const AVATAR_SIZE = 512
const CONTENT_MARGIN = 24

function loadImage(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('头像图片读取失败，请检查当前阶段是否有对应资源'))
    image.src = imageUrl
  })
}

function drawBackground(context: CanvasRenderingContext2D): void {
  context.fillStyle = '#17262b'
  context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)

  context.fillStyle = '#20373b'
  context.fillRect(0, 0, 12, AVATAR_SIZE)
  context.fillStyle = '#c2a36b'
  context.fillRect(12, 0, 3, AVATAR_SIZE)

  context.strokeStyle = 'rgba(214, 230, 226, 0.16)'
  context.lineWidth = 1
  for (let position = 72; position < AVATAR_SIZE; position += 72) {
    context.beginPath()
    context.moveTo(position, 0)
    context.lineTo(position - AVATAR_SIZE, AVATAR_SIZE)
    context.stroke()
  }
}

function drawBottomPanel(context: CanvasRenderingContext2D): void {
  context.fillStyle = 'rgba(13, 25, 29, 0.9)'
  context.fillRect(0, AVATAR_SIZE - 136, AVATAR_SIZE, 136)
  context.fillStyle = '#c2a36b'
  context.fillRect(CONTENT_MARGIN, AVATAR_SIZE - 136, 72, 4)
}

function fitFontSize(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  initialSize: number,
  minimumSize: number,
  fontWeight: number,
): number {
  let fontSize = initialSize
  while (fontSize > minimumSize) {
    context.font = `${fontWeight} ${fontSize}px "Microsoft YaHei", "Noto Sans SC", sans-serif`
    if (context.measureText(text).width <= maxWidth) {
      break
    }
    fontSize -= 1
  }
  return fontSize
}

function drawOperatorName(context: CanvasRenderingContext2D, operatorName: string): void {
  const fontSize = fitFontSize(context, operatorName, AVATAR_SIZE - CONTENT_MARGIN * 2, 34, 20, 700)
  context.font = `700 ${fontSize}px "Microsoft YaHei", "Noto Sans SC", sans-serif`
  context.fillStyle = '#f8faf9'
  context.textBaseline = 'alphabetic'
  context.fillText(operatorName, CONTENT_MARGIN, AVATAR_SIZE - 45)
}

function drawChip(context: CanvasRenderingContext2D, text: string, x: number, y: number): number {
  context.font = '600 17px "Microsoft YaHei", "Noto Sans SC", sans-serif'
  const width = context.measureText(text).width + 22
  context.fillStyle = 'rgba(220, 235, 232, 0.14)'
  context.fillRect(x, y, width, 30)
  context.fillStyle = '#dcebe8'
  context.textBaseline = 'middle'
  context.fillText(text, x + 11, y + 15)
  return width
}

function drawMetadata(context: CanvasRenderingContext2D, options: OperatorAvatarGenerationOptions): void {
  const metadata: string[] = []
  if (options.showRarity && options.rarity > 0) {
    metadata.push(`${options.rarity}★`)
  }
  if (options.showEliteLevel) {
    metadata.push(`精${options.eliteLevel}`)
  }
  if (options.showProfession && options.profession) {
    metadata.push(options.profession)
  }

  let x = CONTENT_MARGIN
  const y = AVATAR_SIZE - 104
  for (const text of metadata) {
    x += drawChip(context, text, x, y) + 8
  }
}

function drawMoodBadge(context: CanvasRenderingContext2D): void {
  const text = '心情涣散'
  context.font = '600 17px "Microsoft YaHei", "Noto Sans SC", sans-serif'
  const width = context.measureText(text).width + 24
  const x = AVATAR_SIZE - CONTENT_MARGIN - width
  const y = CONTENT_MARGIN

  context.fillStyle = 'rgba(150, 42, 48, 0.92)'
  context.fillRect(x, y, width, 34)
  context.fillStyle = '#fff5f3'
  context.textBaseline = 'middle'
  context.fillText(text, x + 12, y + 17)
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
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('当前浏览器不支持头像图片生成')
  }

  drawBackground(context)
  context.save()
  if (options.moodScattered) {
    context.filter = 'grayscale(0.88) saturate(0.68) brightness(0.82)'
  }
  context.drawImage(image, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  context.restore()

  if (options.moodScattered) {
    context.fillStyle = 'rgba(121, 35, 41, 0.18)'
    context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
  }

  drawBottomPanel(context)
  drawMetadata(context, options)
  drawOperatorName(context, options.operatorName)
  if (options.moodScattered) {
    drawMoodBadge(context)
  }

  context.strokeStyle = 'rgba(248, 250, 249, 0.3)'
  context.lineWidth = 2
  context.strokeRect(1, 1, AVATAR_SIZE - 2, AVATAR_SIZE - 2)

  return canvasToBlob(canvas)
}
