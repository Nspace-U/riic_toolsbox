import { maaScheduleAdapter } from '@/adapters/maaSchedule'
import type { ParsedSchedule, ScheduleDocument } from '@/types/schedule'

export interface ScheduleAdapter {
  id: string
  label: string
  fileExtension: string
  parse(text: string): ParsedSchedule
  serialize(document: ScheduleDocument): string
}

export const SCHEDULE_ADAPTERS: ScheduleAdapter[] = [maaScheduleAdapter]
export const DEFAULT_SCHEDULE_ADAPTER: ScheduleAdapter = maaScheduleAdapter
