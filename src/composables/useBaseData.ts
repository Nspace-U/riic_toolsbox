import { ref, watch } from 'vue'

import { useDataSource } from '@/composables/useDataSource'
import type { BaseSkillTerms, Operator } from '@/types/baseData'
import { parseOperatorCsv } from '@/utils/parseOperatorCsv'

interface BaseData {
  operators: Operator[]
  terms: BaseSkillTerms
}

interface UseBaseDataResult {
  operators: Readonly<typeof operators>
  terms: Readonly<typeof terms>
  loading: Readonly<typeof loading>
  errorMessage: Readonly<typeof errorMessage>
  ready: Readonly<typeof ready>
  reload: () => Promise<void>
}

const dataCache = new Map<string, BaseData>()
const operators = ref<Operator[]>([])
const terms = ref<BaseSkillTerms>({})
const loading = ref(false)
const errorMessage = ref('')
const ready = ref(false)
let loadingPromise: Promise<void> | null = null
let loadedSourceId = ''
let sourceWatchRegistered = false

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

async function fetchBaseData(sourceId: string): Promise<BaseData> {
  const cached = dataCache.get(sourceId)
  if (cached) {
    return cached
  }

  const [operatorResponse, termsResponse] = await Promise.all([
    fetch(assetUrl('assets/operator-base-skills.csv')),
    fetch(assetUrl('assets/base-skill-terms.json')),
  ])
  if (!operatorResponse.ok) {
    throw new Error(`干员数据读取失败（HTTP ${operatorResponse.status}）`)
  }
  if (!termsResponse.ok) {
    throw new Error(`术语数据读取失败（HTTP ${termsResponse.status}）`)
  }

  const [operatorCsv, termData] = await Promise.all([
    operatorResponse.text(),
    termsResponse.json() as Promise<BaseSkillTerms>,
  ])
  const data = {
    operators: parseOperatorCsv(operatorCsv),
    terms: termData,
  }
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
      loadedSourceId = sourceId
      ready.value = true
    })
    .catch((error: unknown) => {
      operators.value = []
      terms.value = {}
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
