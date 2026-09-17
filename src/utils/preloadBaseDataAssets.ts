import type { BaseData } from "@/types/baseData";
import { getOperatorAvatarSourceUrl } from "@/utils/operatorAvatar";

const MAX_CONCURRENT_IMAGES = 4;

export interface AssetPreloadResult {
  total: number;
  failed: number;
}

interface AssetPreloadEntry {
  cancelled: boolean;
  images: Map<string, HTMLImageElement>;
  promise: Promise<AssetPreloadResult>;
}

let assetPreloadEntry: AssetPreloadEntry | undefined;

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

function skillIconUrl(fileName: string): string {
  const encodedFileName = encodeURIComponent(fileName)
    .replace(/%2B/g, "+")
    .replace(/%26/g, "&");
  return assetUrl(`assets/raw/build_skill_icon/${encodedFileName}`);
}

function collectAssetUrls(data: BaseData): string[] {
  const urls = new Set<string>();

  data.operators.forEach((operator) => {
    Object.values(operator.avatars).forEach((fileName) => {
      if (fileName) {
        urls.add(getOperatorAvatarSourceUrl(fileName));
      }
    });

    operator.skills.forEach((skill) => {
      if (skill.iconFile) {
        urls.add(skillIconUrl(skill.iconFile));
      }
    });
  });

  return [...urls];
}

function schedulePreloadBatch(callback: () => void): void {
  if (typeof window === "undefined") {
    setTimeout(callback, 0);
    return;
  }

  const idleWindow = window as Window & {
    requestIdleCallback?: (
      idleCallback: () => void,
      options?: { timeout: number },
    ) => number;
  };
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(callback, { timeout: 1000 });
    return;
  }

  window.setTimeout(callback, 0);
}

function loadImage(url: string, entry: AssetPreloadEntry): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;

    function finish(success: boolean): void {
      if (settled) {
        return;
      }
      settled = true;
      if (success && !entry.cancelled) {
        entry.images.set(url, image);
      }
      resolve(success);
    }

    async function finishAfterDecode(): Promise<void> {
      try {
        await image.decode();
      } catch {
        finish(true);
        return;
      }
      finish(true);
    }

    image.decoding = "async";
    image.onload = () => {
      void finishAfterDecode();
    };
    image.onerror = () => {
      finish(false);
    };
    image.src = url;

    if (image.complete && image.naturalWidth > 0) {
      void finishAfterDecode();
    }
  });
}

async function runPreload(
  urls: string[],
  entry: AssetPreloadEntry,
): Promise<AssetPreloadResult> {
  let failed = 0;

  for (let start = 0; start < urls.length; start += MAX_CONCURRENT_IMAGES) {
    if (entry.cancelled) {
      return { total: urls.length, failed };
    }

    await new Promise<void>((resolve) => {
      schedulePreloadBatch(resolve);
    });
    if (entry.cancelled) {
      return { total: urls.length, failed };
    }

    const batch = urls.slice(start, start + MAX_CONCURRENT_IMAGES);
    const results = await Promise.all(
      batch.map((url) => loadImage(url, entry)),
    );
    failed += results.filter((success) => !success).length;
  }

  return { total: urls.length, failed };
}

export function preloadBaseDataAssets(
  data: BaseData,
): Promise<AssetPreloadResult> {
  if (assetPreloadEntry) {
    return assetPreloadEntry.promise;
  }

  const urls = collectAssetUrls(data);
  const entry: AssetPreloadEntry = {
    cancelled: false,
    images: new Map(),
    promise: Promise.resolve({ total: urls.length, failed: 0 }),
  };
  entry.promise = runPreload(urls, entry);
  assetPreloadEntry = entry;
  return entry.promise;
}

export function clearBaseDataAssetCache(): void {
  if (assetPreloadEntry) {
    assetPreloadEntry.cancelled = true;
    assetPreloadEntry.images.clear();
    assetPreloadEntry = undefined;
  }
}
