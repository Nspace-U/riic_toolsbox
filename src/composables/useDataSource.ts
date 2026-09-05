import { computed, ref } from 'vue'

export const DATA_SOURCE_OPTIONS = [
  { label: 'Torappu', value: 'torappu' },
  { label: 'PRTS WIKI', value: 'prts' },
  { label: 'yuanyan3060/ArknightsGameResource', value: 'yuanyan3060' },
] as const

export type DataSourceId = (typeof DATA_SOURCE_OPTIONS)[number]['value']

const DATA_SOURCE_STORAGE_KEY = 'riic-tools:data-source'
const DEFAULT_DATA_SOURCE: DataSourceId = 'torappu'
const selectedDataSource = ref<DataSourceId>(readStoredDataSource())

const selectedDataSourceLabel = computed(() => {
  return DATA_SOURCE_OPTIONS.find((option) => option.value === selectedDataSource.value)?.label ?? ''
})

export function isDataSourceId(value: string): value is DataSourceId {
  return DATA_SOURCE_OPTIONS.some((option) => option.value === value)
}

function readStoredDataSource(): DataSourceId {
  if (typeof window === 'undefined') {
    return DEFAULT_DATA_SOURCE
  }

  try {
    const storedValue = window.localStorage.getItem(DATA_SOURCE_STORAGE_KEY)
    return storedValue && isDataSourceId(storedValue) ? storedValue : DEFAULT_DATA_SOURCE
  } catch {
    return DEFAULT_DATA_SOURCE
  }
}

function setDataSource(value: DataSourceId): void {
  selectedDataSource.value = value

  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, value)
  } catch {
    // Local storage may be unavailable in private browsing or restricted contexts.
  }
}

export function useDataSource() {
  return {
    dataSourceOptions: DATA_SOURCE_OPTIONS,
    selectedDataSource,
    selectedDataSourceLabel,
    setDataSource,
  }
}
