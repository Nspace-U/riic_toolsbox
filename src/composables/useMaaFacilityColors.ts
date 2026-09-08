import { ref } from 'vue'

import {
  MAA_ROOM_LABELS,
  MAA_ROOM_REPRESENTATIVE_COLORS,
  MAA_PRODUCT_LABELS,
  MAA_PRODUCT_REPRESENTATIVE_COLORS,
} from '@/utils/maaSchedule'
import type { MaaRoomKey } from '@/types/maaSchedule'

const FACILITY_COLORS_STORAGE_KEY = 'riic-tools:maa-facility-colors:v1'
const PRODUCT_COLORS_STORAGE_KEY = 'riic-tools:maa-product-colors:v1'
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

const PRODUCT_COLOR_KEYS = ['Pure Gold', 'Orundum', 'Originium Shard'] as const
export type MaaProductColorKey = (typeof PRODUCT_COLOR_KEYS)[number]

export function isMaaProductColorKey(product: string): product is MaaProductColorKey {
  return PRODUCT_COLOR_KEYS.includes(product as MaaProductColorKey)
}

function cloneDefaultColors(): Record<MaaRoomKey, string> {
  return { ...MAA_ROOM_REPRESENTATIVE_COLORS }
}

function loadFacilityColors(): Record<MaaRoomKey, string> {
  const defaults = cloneDefaultColors()

  try {
    const stored = window.localStorage.getItem(FACILITY_COLORS_STORAGE_KEY)
    if (!stored) {
      return defaults
    }

    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return defaults
    }

    Object.entries(parsed).forEach(([key, value]) => {
      if (key in defaults && typeof value === 'string' && HEX_COLOR_PATTERN.test(value)) {
        defaults[key as MaaRoomKey] = value.toUpperCase()
      }
    })
  } catch {
    return defaults
  }

  return defaults
}

function cloneDefaultProductColors(): Record<MaaProductColorKey, string> {
  return {
    'Pure Gold': MAA_PRODUCT_REPRESENTATIVE_COLORS['Pure Gold'] ?? '#B87321',
    Orundum: MAA_PRODUCT_REPRESENTATIVE_COLORS.Orundum ?? '#B52D2D',
    'Originium Shard': MAA_PRODUCT_REPRESENTATIVE_COLORS['Originium Shard'] ?? '#B52D2D',
  }
}

function loadProductColors(): Record<MaaProductColorKey, string> {
  const defaults = cloneDefaultProductColors()

  try {
    const stored = window.localStorage.getItem(PRODUCT_COLORS_STORAGE_KEY)
    if (!stored) {
      return defaults
    }

    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return defaults
    }

    Object.entries(parsed).forEach(([key, value]) => {
      if (key in defaults && typeof value === 'string' && HEX_COLOR_PATTERN.test(value)) {
        defaults[key as MaaProductColorKey] = value.toUpperCase()
      }
    })
  } catch {
    return defaults
  }

  return defaults
}

const facilityColors = ref<Record<MaaRoomKey, string>>(loadFacilityColors())
const productColors = ref<Record<MaaProductColorKey, string>>(loadProductColors())

function persistFacilityColors(): void {
  try {
    window.localStorage.setItem(FACILITY_COLORS_STORAGE_KEY, JSON.stringify(facilityColors.value))
  } catch {
    // localStorage 可能在隐私模式或受限环境中不可用，页面仍可继续编辑内存中的颜色。
  }
}

function setFacilityColor(type: MaaRoomKey, color: string): void {
  if (!HEX_COLOR_PATTERN.test(color)) {
    return
  }
  facilityColors.value[type] = color.toUpperCase()
  persistFacilityColors()
}

function persistProductColors(): void {
  try {
    window.localStorage.setItem(PRODUCT_COLORS_STORAGE_KEY, JSON.stringify(productColors.value))
  } catch {
    // localStorage 可能在隐私模式或受限环境中不可用，页面仍可继续编辑内存中的颜色。
  }
}

function setProductColor(product: MaaProductColorKey, color: string): void {
  if (!HEX_COLOR_PATTERN.test(color)) {
    return
  }
  productColors.value[product] = color.toUpperCase()
  persistProductColors()
}

function resetFacilityColors(): void {
  facilityColors.value = cloneDefaultColors()
  productColors.value = cloneDefaultProductColors()
  persistFacilityColors()
  persistProductColors()
}

export function useMaaFacilityColors() {
  return {
    facilityColors,
    facilityLabels: MAA_ROOM_LABELS,
    productColors,
    productLabels: {
      'Pure Gold': MAA_PRODUCT_LABELS['Pure Gold'] ?? '赤金',
      Orundum: MAA_PRODUCT_LABELS.Orundum ?? '合成玉',
      'Originium Shard': MAA_PRODUCT_LABELS['Originium Shard'] ?? '源石碎片',
    } satisfies Record<MaaProductColorKey, string>,
    setFacilityColor,
    setProductColor,
    resetFacilityColors,
  }
}