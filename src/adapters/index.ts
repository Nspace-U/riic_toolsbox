import { maaScheduleAdapter } from "@/adapters/maaSchedule";
import { isTextSchedule, parseTextSchedule } from "@/adapters/textSchedule";
import type { ParsedSchedule, ScheduleDocument } from "@/types/schedule";

export interface ScheduleAdapter {
  id: string;
  label: string;
  fileExtension: string;
  parse(text: string): ParsedSchedule;
  serialize(document: ScheduleDocument): string;
}

export const SCHEDULE_ADAPTERS: ScheduleAdapter[] = [maaScheduleAdapter];
export const DEFAULT_SCHEDULE_ADAPTER: ScheduleAdapter = maaScheduleAdapter;

export { isTextSchedule };

export function parseScheduleImport(text: string): ParsedSchedule {
  return text.trimStart().startsWith("{")
    ? maaScheduleAdapter.parse(text)
    : parseTextSchedule(text);
}
