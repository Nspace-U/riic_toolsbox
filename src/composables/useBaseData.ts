import { ref, watch } from 'vue'

import { useDataSource, type DataSourceId } from '@/composables/useDataSource'
import type { BaseData, BaseDataMetadata, Operator } from '@/types/baseData'
import { parseOperatorCsv } from '@/utils/parseOperatorCsv'
import {
  clearBaseDataAssetCache,
  preloadBaseDataAssets,
  type AssetPreloadResult,
} from '@/utils/preloadBaseDataAssets'
import {
  parseTorappuData,
  type TorappuBuildingData,
  type TorappuCharacterTable,
} from '@/utils/parseTorappuData'

interface UseBaseDataResult {
  operators: Readonly<typeof operators>
  metadata: Readonly<typeof metadata>
  loading: Readonly<typeof loading>
  assetsLoading: Readonly<typeof assetsLoading>
  assetsReady: Readonly<typeof assetsReady>
  assetPreloadResult: Readonly<typeof assetPreloadResult>
  errorMessage: Readonly<typeof errorMessage>
  ready: Readonly<typeof ready>
  reload: () => Promise<void>
}

const dataCache = new Map<string, BaseData>()
const operators = ref<Operator[]>([])
const metadata = ref<BaseDataMetadata>()
const loading = ref(false)
const assetsLoading = ref(false)
const assetsReady = ref(false)
const assetPreloadResult = ref<AssetPreloadResult>()
const errorMessage = ref('')
const ready = ref(false)
let loadingPromise: Promise<void> | null = null
let loadedSourceId = ''
let sourceWatchRegistered = false
let assetPreloadVersion = 0

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

async function fetchJson<T>(path: string, label: string): Promise<T> {
  const response = await fetch(assetUrl(path))
  if (!response.ok) {
    throw new Error(`${label}读取失败（HTTP ${response.status}）`)
  }
  return response.json() as Promise<T>
}

async function fetchLegacyData(): Promise<BaseData> {
  const operatorCsv = await fetch(assetUrl('assets/operator-base-skills.csv')).then((response) => {
    if (!response.ok) {
      throw new Error(`干员数据读取失败（HTTP ${response.status}）`)
    }
    return response.text()
  })

  return {
    operators: parseOperatorCsv(operatorCsv),
  }
}

async function fetchTorappuData(): Promise<BaseData> {
  const [characterTable, buildingData, metadata] = await Promise.all([
    fetchJson<TorappuCharacterTable>(
      'assets/gamedata/latest/excel/character_table.json',
      'Torappu 干员数据',
    ),
    fetchJson<TorappuBuildingData>(
      'assets/gamedata/latest/excel/building_data.json',
      'Torappu 基建数据',
    ),
    fetchJson<BaseDataMetadata>('assets/gamedata/latest/torappu-meta.json', 'Torappu 版本信息'),
  ])
  return {
    operators: parseTorappuData(
      characterTable,
      buildingData,
      metadata,
    ),
    metadata,
  }
}

async function fetchBaseData(sourceId: DataSourceId): Promise<BaseData> {
  const cached = dataCache.get(sourceId)
  if (cached) {
    return cached
  }

  const data = sourceId === 'torappu' ? await fetchTorappuData() : await fetchLegacyData()
  dataCache.set(sourceId, data)
  return data
}

function resetAssetState(): void {
  assetPreloadVersion += 1
  assetsLoading.value = false
  assetsReady.value = false
  assetPreloadResult.value = undefined
}

function startAssetPreload(sourceId: DataSourceId, data: BaseData): void {
  const requestVersion = ++assetPreloadVersion
  assetsLoading.value = true
  assetsReady.value = false
  assetPreloadResult.value = undefined

  void preloadBaseDataAssets(sourceId, data)
    .then((result) => {
      if (requestVersion !== assetPreloadVersion || useDataSource().selectedDataSource.value !== sourceId) {
        return
      }

      assetPreloadResult.value = result
      assetsLoading.value = false
      assetsReady.value = true
    })
    .catch(() => {
      if (requestVersion !== assetPreloadVersion || useDataSource().selectedDataSource.value !== sourceId) {
        return
      }

      assetsLoading.value = false
      assetsReady.value = true
    })
}

async function load(): Promise<void> {
  if (loadingPromise) {
    return loadingPromise
  }

  const { selectedDataSource } = useDataSource()
  const sourceId = selectedDataSource.value
  loading.value = true
  errorMessage.value = ''
  loadingPromise = fetchBaseData(sourceId)
    .then((data) => {
      if (selectedDataSource.value !== sourceId) {
        return
      }

      operators.value = data.operators
      metadata.value = data.metadata
      loadedSourceId = sourceId
      ready.value = true
      startAssetPreload(sourceId, data)
    })
    .catch((error: unknown) => {
      operators.value = []
      metadata.value = undefined
      ready.value = false
      errorMessage.value = error instanceof Error ? error.message : '数据读取失败'
    })
    .finally(() => {
      loading.value = false
      loadingPromise = null

      if (selectedDataSource.value !== sourceId) {
        void load()
      }
    })

  return loadingPromise
}

async function reload(): Promise<void> {
  const sourceId = useDataSource().selectedDataSource.value
  const currentLoadingPromise = loadingPromise
  if (currentLoadingPromise) {
    await currentLoadingPromise
  }

  if (useDataSource().selectedDataSource.value !== sourceId) {
    await load()
    return
  }

  dataCache.delete(sourceId)
  clearBaseDataAssetCache(sourceId)
  resetAssetState()
  await load()
}

const result: UseBaseDataResult = {
  operators,
  metadata,
  loading,
  assetsLoading,
  assetsReady,
  assetPreloadResult,
  errorMessage,
  ready,
  reload,
}

export function useBaseData(): UseBaseDataResult {
  const { selectedDataSource } = useDataSource()
  if (!sourceWatchRegistered) {
    sourceWatchRegistered = true
    watch(selectedDataSource, () => {
      ready.value = false
      resetAssetState()
      void load()
    })
  }

  if (!ready.value || loadedSourceId !== selectedDataSource.value) {
    void load()
  }

  return result
}
