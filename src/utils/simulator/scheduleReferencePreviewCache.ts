export interface CachedScheduleReferencePreview {
  version: string;
  root: HTMLDivElement;
  cleanup: () => void;
  width: number;
  height: number;
  contentScale: number;
}

const previewCache = new Map<string, CachedScheduleReferencePreview>();

export function getScheduleReferencePreview(
  documentId: string,
  version: string,
): CachedScheduleReferencePreview | undefined {
  const cached = previewCache.get(documentId);
  if (!cached) {
    return undefined;
  }
  if (cached.version !== version) {
    removeScheduleReferencePreview(documentId);
    return undefined;
  }
  return cached;
}

export function setScheduleReferencePreview(
  documentId: string,
  preview: CachedScheduleReferencePreview,
): void {
  const previous = previewCache.get(documentId);
  if (previous && previous !== preview) {
    previous.cleanup();
  }
  previewCache.set(documentId, preview);
}

export function removeScheduleReferencePreview(documentId: string): void {
  const cached = previewCache.get(documentId);
  if (!cached) {
    return;
  }
  previewCache.delete(documentId);
  cached.cleanup();
}

export function pruneScheduleReferencePreviewCache(
  documentIds: Set<string>,
): void {
  previewCache.forEach((_preview, documentId) => {
    if (!documentIds.has(documentId)) {
      removeScheduleReferencePreview(documentId);
    }
  });
}
