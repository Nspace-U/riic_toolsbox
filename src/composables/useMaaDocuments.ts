import { ref } from 'vue'

import {
  cloneMaaSchedule,
  createEmptyMaaSchedule,
  validateMaaSchedule,
} from '@/utils/maaSchedule'
import type {
  MaaScheduleDocument,
  StoredMaaDocument,
} from '@/types/maaSchedule'

const DOCUMENTS_STORAGE_KEY = 'riic-tools:maa-documents:v1'
const ACTIVE_DOCUMENT_STORAGE_KEY = 'riic-tools:maa-active-document:v1'

const documents = ref<StoredMaaDocument[]>(readDocuments())
const activeDocumentId = ref(readActiveDocumentId())

function createId(): string {
  return `maa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function now(): string {
  return new Date().toISOString()
}

function readDocuments(): StoredMaaDocument[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(DOCUMENTS_STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(isStoredMaaDocument)
  } catch {
    return []
  }
}

function readActiveDocumentId(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    return window.localStorage.getItem(ACTIVE_DOCUMENT_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function isStoredMaaDocument(value: unknown): value is StoredMaaDocument {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<StoredMaaDocument>
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
    validateMaaSchedule(candidate.document)
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

function documentName(document: MaaScheduleDocument, fallback = '排班表'): string {
  const title = document.title?.trim()
  return title || fallback
}

function createStoredDocument(
  document: MaaScheduleDocument,
  inferredLayout: boolean,
  sourceFileName: string,
): StoredMaaDocument {
  const timestamp = now()
  return {
    id: createId(),
    document: cloneMaaSchedule(document),
    inferredLayout,
    sourceFileName,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function createDocument(
  document: MaaScheduleDocument = createEmptyMaaSchedule(),
  inferredLayout = false,
  sourceFileName = '',
): StoredMaaDocument {
  const stored = createStoredDocument(document, inferredLayout, sourceFileName)
  documents.value.push(stored)
  activeDocumentId.value = stored.id
  persist()
  return stored
}

function getDocument(id: string): StoredMaaDocument | undefined {
  return documents.value.find((document) => document.id === id)
}

function getActiveDocument(): StoredMaaDocument | undefined {
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
  update: (document: StoredMaaDocument) => void,
): StoredMaaDocument | undefined {
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

function duplicateDocument(id: string): StoredMaaDocument | undefined {
  const source = getDocument(id)
  if (!source) {
    return undefined
  }
  const copy = createStoredDocument(
    {
      ...cloneMaaSchedule(source.document),
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

export function useMaaDocuments() {
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