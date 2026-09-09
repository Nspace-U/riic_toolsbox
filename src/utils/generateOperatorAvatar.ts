import {
  getOperatorAvatarNameFontSizeForWidth,
  getOperatorAvatarNameHeight,
  OPERATOR_AVATAR_LAYOUT,
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
  nameHeight: number,
): void {
  const maxTextWidth = Math.max(
    1,
    width - OPERATOR_AVATAR_LAYOUT.nameHorizontalPadding,
  );
  const fontSize = getOperatorAvatarNameFontSizeForWidth(
    operatorName,
    nameHeight,
    maxTextWidth,
    (name, size) => {
      context.font = `600 ${size}px "Segoe UI", sans-serif`;
      return context.measureText(name).width;
    },
  );
  context.font = `600 ${fontSize}px "Segoe UI", sans-serif`;

  const fontMetrics = context.measureText("Mg");
  const fontAscent = fontMetrics.fontBoundingBoxAscent;
  const fontDescent = fontMetrics.fontBoundingBoxDescent;
  const baseline =
    Number.isFinite(fontAscent) && Number.isFinite(fontDescent)
      ? (nameHeight - fontAscent - fontDescent) / 2 + fontAscent
      : nameHeight / 2;
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

export async function generateOperatorAvatar(
  options: OperatorAvatarGenerationOptions,
): Promise<Blob> {
  const image = await loadImage(options.imageUrl);
  const overlayImages = await loadOverlayImages(options);
  const nameHeight =
    options.showName && options.operatorName
      ? getOperatorAvatarNameHeight(image.naturalWidth)
      : 0;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight + nameHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器不支持头像图片生成");
  }

  context.save();
  context.filter = options.operatorOwned ? "none" : "grayscale(1)";
  context.drawImage(image, 0, 0);
  context.restore();

  if (options.operatorTrainingUpgraded) {
    context.fillStyle = "rgba(0, 255, 0, 0.5)";
    context.fillRect(0, 0, image.naturalWidth, image.naturalHeight);
  }

  if (options.moodScattered) {
    context.fillStyle = "rgba(255, 0, 0, 0.5)";
    context.fillRect(0, 0, image.naturalWidth, image.naturalHeight);
  }

  drawMetadata(
    context,
    overlayImages,
    image.naturalWidth,
    image.naturalHeight,
    options,
  );

  if (nameHeight > 0) {
    drawOperatorAvatarName(
      context,
      options.operatorName,
      image.naturalWidth,
      image.naturalHeight,
      nameHeight,
    );
  }

  return canvasToBlob(canvas);
}
