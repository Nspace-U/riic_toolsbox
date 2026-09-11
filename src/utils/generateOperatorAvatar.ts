import {
  getOperatorAvatarNameMaxTextWidth,
  getOperatorAvatarProportionalNameMetrics,
  getOperatorAvatarScale,
  getScaledOperatorAvatarLength,
  normalizeOperatorAvatarOutputWidth,
  OPERATOR_AVATAR_LAYOUT,
  type OperatorAvatarNameMetrics,
} from "@/utils/operatorAvatarLayout";

export interface OperatorAvatarGenerationOptions {
  imageUrl: string;
  operatorName: string;
  professionIconUrl?: string;
  eliteIconUrl?: string;
  rarityIconUrl?: string;
  showRarity: boolean;
  showEliteLevel: boolean;
  showProfession: boolean;
  showName: boolean;
  moodScattered: boolean;
  operatorOwned: boolean;
  operatorTrainingUpgraded: boolean;
  outputWidth?: number;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(imageUrl: string): Promise<HTMLImageElement> {
  const cachedImage = imageCache.get(imageUrl);
  if (cachedImage) {
    return cachedImage;
  }

  const imagePromise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => {
      imageCache.delete(imageUrl);
      reject(new Error("头像图片读取失败，请检查当前阶段是否有对应资源"));
    };
    image.src = imageUrl;
  });
  imageCache.set(imageUrl, imagePromise);
  return imagePromise;
}

function loadOptionalImage(
  imageUrl: string | undefined,
): Promise<HTMLImageElement | undefined> {
  return imageUrl ? loadImage(imageUrl) : Promise.resolve(undefined);
}

interface AvatarOverlayImages {
  profession: HTMLImageElement | undefined;
  elite: HTMLImageElement | undefined;
  rarity: HTMLImageElement | undefined;
}

async function loadOverlayImages(
  options: OperatorAvatarGenerationOptions,
): Promise<AvatarOverlayImages> {
  const [profession, elite, rarity] = await Promise.all([
    loadOptionalImage(options.professionIconUrl),
    loadOptionalImage(options.eliteIconUrl),
    loadOptionalImage(options.rarityIconUrl),
  ]);
  return { profession, elite, rarity };
}

function drawMetadata(
  context: CanvasRenderingContext2D,
  images: AvatarOverlayImages,
  width: number,
  height: number,
  options: OperatorAvatarGenerationOptions,
): void {
  if (options.showProfession && images.profession) {
    const professionSize = Math.round(
      width * OPERATOR_AVATAR_LAYOUT.professionSizeRatio,
    );
    context.drawImage(images.profession, 0, 0, professionSize, professionSize);
  }

  if (options.showEliteLevel && images.elite) {
    const eliteWidth = Math.round(
      width * OPERATOR_AVATAR_LAYOUT.eliteWidthRatio,
    );
    const eliteHeight = Math.round(
      eliteWidth * (images.elite.naturalHeight / images.elite.naturalWidth),
    );
    context.drawImage(
      images.elite,
      0,
      height - eliteHeight,
      eliteWidth,
      eliteHeight,
    );
  }

  if (options.showRarity && images.rarity) {
    const rarityHeight = Math.round(
      height * OPERATOR_AVATAR_LAYOUT.rarityHeightRatio,
    );
    const rarityWidth = Math.round(
      rarityHeight * (images.rarity.naturalWidth / images.rarity.naturalHeight),
    );
    context.drawImage(
      images.rarity,
      width - rarityWidth,
      height - rarityHeight,
      rarityWidth,
      rarityHeight,
    );
  }
}

export function drawOperatorAvatarName(
  context: CanvasRenderingContext2D,
  operatorName: string,
  width: number,
  nameTop: number,
  metrics: OperatorAvatarNameMetrics,
  maxTextWidth: number,
): void {
  context.font = `600 ${metrics.fontSize}px "Segoe UI", sans-serif`;

  const fontMetrics = context.measureText("Mg");
  const fontAscent = fontMetrics.fontBoundingBoxAscent;
  const fontDescent = fontMetrics.fontBoundingBoxDescent;
  const baseline =
    Number.isFinite(fontAscent) && Number.isFinite(fontDescent)
      ? (metrics.height - fontAscent - fontDescent) / 2 + fontAscent
      : metrics.height / 2;
  context.fillStyle = "#000000";
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillText(operatorName, width / 2, nameTop + baseline, maxTextWidth);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("头像图片生成失败"));
    }, "image/png");
  });
}

interface AvatarCanvas {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}

function createAvatarCanvas(width: number, height: number): AvatarCanvas {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器不支持头像图片生成");
  }
  return { canvas, context };
}

export async function generateOperatorAvatar(
  options: OperatorAvatarGenerationOptions,
): Promise<Blob> {
  const image = await loadImage(options.imageUrl);
  const overlayImages = await loadOverlayImages(options);
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const outputWidth = normalizeOperatorAvatarOutputWidth(
    options.outputWidth,
    sourceWidth,
  );
  const scale = getOperatorAvatarScale(sourceWidth, outputWidth);

  const source = createAvatarCanvas(sourceWidth, sourceHeight);
  const context = source.context;
  context.drawImage(image, 0, 0);

  if (!options.operatorOwned) {
    context.fillStyle = "rgba(128, 128, 128, 0.5)";
    context.fillRect(0, 0, sourceWidth, sourceHeight);
  }

  if (options.operatorTrainingUpgraded) {
    context.fillStyle = "rgba(0, 255, 0, 0.5)";
    context.fillRect(0, 0, sourceWidth, sourceHeight);
  }

  if (options.moodScattered) {
    context.fillStyle = "rgba(255, 0, 0, 0.5)";
    context.fillRect(0, 0, sourceWidth, sourceHeight);
  }

  drawMetadata(context, overlayImages, sourceWidth, sourceHeight, options);

  const showName = options.showName && Boolean(options.operatorName);
  const nameMetrics = showName
    ? getOperatorAvatarProportionalNameMetrics(
        options.operatorName,
        sourceWidth,
        outputWidth,
        (name, fontSize) => {
          context.font = `600 ${fontSize}px "Segoe UI", sans-serif`;
          return context.measureText(name).width;
        },
      )
    : undefined;

  const bodyHeight = getScaledOperatorAvatarLength(sourceHeight, scale);
  const output = createAvatarCanvas(
    outputWidth,
    bodyHeight + (nameMetrics ? nameMetrics.height : 0),
  );
  output.context.imageSmoothingEnabled = true;
  output.context.imageSmoothingQuality = "high";
  output.context.drawImage(source.canvas, 0, 0, outputWidth, bodyHeight);

  if (nameMetrics) {
    drawOperatorAvatarName(
      output.context,
      options.operatorName,
      outputWidth,
      bodyHeight,
      nameMetrics,
      getOperatorAvatarNameMaxTextWidth(outputWidth),
    );
  }

  return canvasToBlob(output.canvas);
}
