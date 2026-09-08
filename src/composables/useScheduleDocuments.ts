import { ref } from 'vue'

import {
  cloneSchedule,
  createEmptySchedule,
  validateSchedule,
} from '@/utils/schedule'
import type {
  ScheduleDocument,
  StoredDocument,
} from '@/types/schedule'

const DOCUMENTS_STORAGE_KEY = 'riic-tools:schedule-documents:v1'
const ACTIVE_DOCUMENT_STORAGE_KEY = 'riic-tools:schedule-active-document:v1'
const LEGACY_DOCUMENTS_STORAGE_KEY = 'riic-tools:maa-documents:v1'
const LEGACY_ACTIVE_DOCUMENT_STORAGE_KEY = 'riic-tools:maa-active-document:v1'

let legacyStorageUsed = false

const documents = ref<StoredDocument[]>(readDocuments())
const activeDocumentId = ref(readActiveDocumentId())

function createId(): string {
  return `schedule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function now(): string {
  return new Date().toISOString()
}

function readStorageValue(key: string, legacyKey: string): string | null {
  try {
    const stored = window.localStorage.getItem(key)
    if (stored !== null) {
      return stored
    }
    const legacyStored = window.localStorage.getItem(legacyKey)
    if (legacyStored !== null) {
      legacyStorageUsed = true
    }
    return legacyStored
  } catch {
    return null
  }
}

function readDocuments(): StoredDocument[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = readStorageValue(DOCUMENTS_STORAGE_KEY, LEGACY_DOCUMENTS_STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(isStoredDocument)
  } catch {
    return []
  }
}

function readActiveDocumentId(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    return readStorageValue(ACTIVE_DOCUMENT_STORAGE_KEY, LEGACY_ACTIVE_DOCUMENT_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function isStoredDocument(value: unknown): value is StoredDocument {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<StoredDocument>
  if (!(
    typeof candidate.id === 'string'
      && candidate.document
      && typeof candidate.document === 'object'
      && typeof candidate.inferredLayout === 'boolean'
      && typeof candidate.sourceFileName === 'string'
      && typeof candidate.createdAt === 'string'
      && typeof candidate.updatedAt === 'string'
  )) {
    return false
  }

  try {
    validateSchedule(candidate.document)
    return true
  } catch {
    return false
  }
}

function persist(): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(documents.value))
    window.localStorage.setItem(ACTIVE_DOCUMENT_STORAGE_KEY, activeDocumentId.value)
  } catch {
    // localStorage 可能在隐私模式或受限环境中不可用，页面仍可继续编辑内存中的数据。
  }
}

function normalizeActiveDocument(): void {
  if (documents.value.some((document) => document.id === activeDocumentId.value)) {
    return
  }
  activeDocumentId.value = documents.value[0]?.id ?? ''
}

function documentName(document: ScheduleDocument, fallback = '排班表'): string {
  const title = document.title?.trim()
  return title || fallback
}

function createStoredDocument(
  document: ScheduleDocument,
  inferredLayout: boolean,
  sourceFileName: string,
): StoredDocument {
  const timestamp = now()
  return {
    id: createId(),
    document: cloneSchedule(document),
    inferredLayout,
    sourceFileName,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function createDocument(
  document: ScheduleDocument = createEmptySchedule(),
  inferredLayout = false,
  sourceFileName = '',
): StoredDocument {
  const stored = createStoredDocument(document, inferredLayout, sourceFileName)
  documents.value.push(stored)
  activeDocumentId.value = stored.id
  persist()
  return stored
}

function getDocument(id: string): StoredDocument | undefined {
  return documents.value.find((document) => document.id === id)
}

function getActiveDocument(): StoredDocument | undefined {
  normalizeActiveDocument()
  return getDocument(activeDocumentId.value)
}

function setActiveDocument(id: string): void {
  if (!getDocument(id)) {
    return
  }
  activeDocumentId.value = id
  persist()
}

function updateDocument(
  id: string,
  update: (document: StoredDocument) => void,
): StoredDocument | undefined {
  const stored = getDocument(id)
  if (!stored) {
    return undefined
  }
  update(stored)
  stored.updatedAt = now()
  persist()
  return stored
}

function removeDocument(id: string): void {
  const index = documents.value.findIndex((document) => document.id === id)
  if (index < 0) {
    return
  }
  documents.value.splice(index, 1)
  if (activeDocumentId.value === id) {
    activeDocumentId.value = documents.value[index]?.id ?? documents.value[index - 1]?.id ?? ''
  }
  persist()
}

function duplicateDocument(id: string): StoredDocument | undefined {
  const source = getDocument(id)
  if (!source) {
    return undefined
  }
  const copy = createStoredDocument(
    {
      ...cloneSchedule(source.document),
      title: `${documentName(source.document)} 副本`,
    },
    source.inferredLayout,
    source.sourceFileName,
  )
  documents.value.push(copy)
  activeDocumentId.value = copy.id
  persist()
  return copy
}

normalizeActiveDocument()
if (legacyStorageUsed) {
  persist()
}

export function useScheduleDocuments() {
  return {
    documents,
    activeDocumentId,
    createDocument,
    getDocument,
    getActiveDocument,
    setActiveDocument,
    updateDocument,
    removeDocument,
    duplicateDocument,
    persist,
  }
}
