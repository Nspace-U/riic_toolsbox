import { ScheduleError, validateSchedule } from "@/utils/schedule";
import type { ScheduleDocument, StoredDocument } from "@/types/schedule";

const SCHEDULE_BACKUP_FORMAT = "riic-tools-schedule-backup";
const SCHEDULE_BACKUP_VERSION = 1;

export interface ScheduleBackupEditSettings {
  layout: boolean;
  queue: boolean;
}

export interface ScheduleBackup {
  format: typeof SCHEDULE_BACKUP_FORMAT;
  version: typeof SCHEDULE_BACKUP_VERSION;
  activeDocumentId: string;
  documents: StoredDocument[];
  editSettings: Record<string, ScheduleBackupEditSettings>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredDocument(value: unknown): value is StoredDocument {
  if (!isRecord(value)) {
    return false;
  }

  const candidate = value as Partial<StoredDocument>;
  if (
    typeof candidate.id !== "string" ||
    candidate.id.trim().length === 0 ||
    !isRecord(candidate.document) ||
    typeof candidate.inferredLayout !== "boolean" ||
    typeof candidate.sourceFileName !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    (candidate.tags !== undefined &&
      (!Array.isArray(candidate.tags) ||
        !candidate.tags.every((tag) => typeof tag === "string"))) ||
    (candidate.hiddenAutoTags !== undefined &&
      (!Array.isArray(candidate.hiddenAutoTags) ||
        !candidate.hiddenAutoTags.every((tag) => typeof tag === "string")))
  ) {
    return false;
  }

  try {
    validateSchedule(candidate.document as ScheduleDocument);
    return true;
  } catch {
    return false;
  }
}

function isEditSettings(value: unknown): value is ScheduleBackupEditSettings {
  return (
    isRecord(value) &&
    typeof value.layout === "boolean" &&
    typeof value.queue === "boolean"
  );
}

export function parseScheduleBackup(text: string): ScheduleBackup | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || parsed.format !== SCHEDULE_BACKUP_FORMAT) {
    return undefined;
  }
  if (parsed.version !== SCHEDULE_BACKUP_VERSION) {
    throw new ScheduleError("不支持的排班备份版本");
  }
  if (!Array.isArray(parsed.documents) || parsed.documents.length === 0) {
    throw new ScheduleError("排班备份中没有排班表");
  }

  const documents = parsed.documents;
  if (!documents.every(isStoredDocument)) {
    throw new ScheduleError("排班备份中包含无效排班表，未导入任何内容");
  }

  const documentIds = documents.map((document) => document.id);
  if (new Set(documentIds).size !== documentIds.length) {
    throw new ScheduleError("排班备份中存在重复的排班表 ID");
  }
  if (
    typeof parsed.activeDocumentId !== "string" ||
    !documentIds.includes(parsed.activeDocumentId)
  ) {
    throw new ScheduleError("排班备份中的当前排班表无效");
  }
  if (!isRecord(parsed.editSettings)) {
    throw new ScheduleError("排班备份中的编辑设置无效");
  }

  const editSettings = parsed.editSettings;
  if (
    !documentIds.every((id) => isEditSettings(editSettings[id])) ||
    Object.keys(editSettings).some((id) => !documentIds.includes(id))
  ) {
    throw new ScheduleError("排班备份中的编辑设置与排班表不匹配");
  }

  return parsed as unknown as ScheduleBackup;
}

export function serializeScheduleBackup(backup: ScheduleBackup): string {
  return JSON.stringify(backup, null, 2);
}
