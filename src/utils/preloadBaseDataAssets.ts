import type { DataSourceId } from '@/composables/useDataSource'
import type { BaseData } from '@/types/baseData'
import { getOperatorAvatarSourceUrl } from '@/utils/operatorAvatar'

const MAX_CONCURRENT_IMAGES = 4

export interface AssetPreloadResult {
  total: number
  failed: number
}

interface AssetPreloadEntry {
  cancelled: boolean
  images: Map<string, HTMLImageElement>
  promise: Promise<AssetPreloadResult>
}

const assetPreloadCache = new Map<DataSourceId, AssetPreloadEntry>()

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

function skillIconUrl(fileName: string): string {
  const encodedFileName = encodeURIComponent(fileName)
    .replace(/%2B/g, '+')
    .replace(/%26/g, '&')
  return assetUrl(`assets/raw/build_skill_icon/${encodedFileName}`)
}

function collectAssetUrls(dataSource: DataSourceId, data: BaseData): string[] {
  const urls = new Set<string>()

  data.operators.forEach((operator) => {
    Object.values(operator.avatars).forEach((fileName) => {
      if (fileName) {
        urls.add(getOperatorAvatarSourceUrl(dataSource, fileName))
      }
    })

    operator.skills.forEach((skill) => {
      if (skill.iconFile) {
        urls.add(skillIconUrl(skill.iconFile))
      }
    })
  })

  return [...urls]
}

function schedulePreloadBatch(callback: () => void): void {
  if (typeof window === 'undefined') {
    setTimeout(callback, 0)
    return
  }

  const idleWindow = window as Window & {
    requestIdleCallback?: (idleCallback: () => void, options?: { timeout: number }) => number
  }
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(callback, { timeout: 1000 })
    return
  }

  window.setTimeout(callback, 0)
}

function loadImage(url: string, entry: AssetPreloadEntry): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image()
    let settled = false

    function finish(success: boolean): void {
      if (settled) {
        return
      }
      settled = true
      if (success && !entry.cancelled) {
        entry.images.set(url, image)
      }
      resolve(success)
    }

    async function finishAfterDecode(): Promise<void> {
      try {
        await image.decode()
      } catch {}
      finish(true)
    }

    image.decoding = 'async'
    image.onload = () => {
      void finishAfterDecode()
    }
    image.onerror = () => {
      finish(false)
    }
    image.src = url

    if (image.complete && image.naturalWidth > 0) {
      void finishAfterDecode()
    }
  })
}

async function runPreload(
  urls: string[],
  entry: AssetPreloadEntry,
): Promise<AssetPreloadResult> {
  let failed = 0

  for (let start = 0; start < urls.length; start += MAX_CONCURRENT_IMAGES) {
    if (entry.cancelled) {
      return { total: urls.length, failed }
    }

    await new Promise<void>((resolve) => {
      schedulePreloadBatch(resolve)
    })
    if (entry.cancelled) {
      return { total: urls.length, failed }
    }

    const batch = urls.slice(start, start + MAX_CONCURRENT_IMAGES)
    const results = await Promise.all(batch.map((url) => loadImage(url, entry)))
    failed += results.filter((success) => !success).length
  }

  return { total: urls.length, failed }
}

export function preloadBaseDataAssets(
  dataSource: DataSourceId,
  data: BaseData,
): Promise<AssetPreloadResult> {
  const cached = assetPreloadCache.get(dataSource)
  if (cached) {
    return cached.promise
  }

  const urls = collectAssetUrls(dataSource, data)
  const entry: AssetPreloadEntry = {
    cancelled: false,
    images: new Map(),
    promise: Promise.resolve({ total: urls.length, failed: 0 }),
  }
  entry.promise = runPreload(urls, entry)
  assetPreloadCache.set(dataSource, entry)
  return entry.promise
}

export function clearBaseDataAssetCache(dataSource: DataSourceId): void {
  const cached = assetPreloadCache.get(dataSource)
  if (cached) {
    cached.cancelled = true
    cached.images.clear()
    assetPreloadCache.delete(dataSource)
  }
}