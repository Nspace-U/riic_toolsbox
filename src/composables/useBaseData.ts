import { ref, watch } from 'vue'

import { useDataSource, type DataSourceId } from '@/composables/useDataSource'
import type { BaseData, BaseDataMetadata, BaseSkillTerms, Operator } from '@/types/baseData'
import { parseOperatorCsv } from '@/utils/parseOperatorCsv'
import {
  parseTorappuData,
  type TorappuBuildingData,
  type TorappuCharacterTable,
} from '@/utils/parseTorappuData'

interface UseBaseDataResult {
  operators: Readonly<typeof operators>
  terms: Readonly<typeof terms>
  metadata: Readonly<typeof metadata>
  loading: Readonly<typeof loading>
  errorMessage: Readonly<typeof errorMessage>
  ready: Readonly<typeof ready>
  reload: () => Promise<void>
}

const dataCache = new Map<string, BaseData>()
const operators = ref<Operator[]>([])
const terms = ref<BaseSkillTerms>({})
const metadata = ref<BaseDataMetadata>()
const loading = ref(false)
const errorMessage = ref('')
const ready = ref(false)
let loadingPromise: Promise<void> | null = null
let loadedSourceId = ''
let sourceWatchRegistered = false

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
  const [operatorCsv, termData] = await Promise.all([
    fetch(assetUrl('assets/operator-base-skills.csv')).then((response) => {
      if (!response.ok) {
        throw new Error(`干员数据读取失败（HTTP ${response.status}）`)
      }
      return response.text()
    }),
    fetchJson<BaseSkillTerms>('assets/base-skill-terms.json', '术语数据'),
  ])

  return {
    operators: parseOperatorCsv(operatorCsv),
    terms: termData,
  }
}

async function fetchTorappuData(): Promise<BaseData> {
  const [characterTable, buildingData, termData, legacyCsv, metadata] = await Promise.all([
    fetchJson<TorappuCharacterTable>(
      'assets/gamedata/latest/excel/character_table.json',
      'Torappu 干员数据',
    ),
    fetchJson<TorappuBuildingData>(
      'assets/gamedata/latest/excel/building_data.json',
      'Torappu 基建数据',
    ),
    fetchJson<BaseSkillTerms>('assets/project/base-skill-terms.json', '基建术语数据'),
    fetch(assetUrl('assets/operator-base-skills.csv')).then((response) => {
      if (!response.ok) {
        throw new Error(`兼容字段读取失败（HTTP ${response.status}）`)
      }
      return response.text()
    }),
    fetchJson<BaseDataMetadata>('assets/gamedata/latest/torappu-meta.json', 'Torappu 版本信息'),
  ])

  return {
    operators: parseTorappuData(
      characterTable,
      buildingData,
      parseOperatorCsv(legacyCsv),
      termData,
      metadata,
    ),
    terms: termData,
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
      terms.value = data.terms
      metadata.value = data.metadata
      loadedSourceId = sourceId
      ready.value = true
    })
    .catch((error: unknown) => {
      operators.value = []
      terms.value = {}
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

function reload(): Promise<void> {
  dataCache.delete(useDataSource().selectedDataSource.value)
  return load()
}

const result: UseBaseDataResult = {
  operators,
  terms,
  metadata,
  loading,
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
      void load()
    })
  }

  if (!ready.value || loadedSourceId !== selectedDataSource.value) {
    void load()
  }

  return result
}
