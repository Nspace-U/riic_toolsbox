import { ref } from 'vue'

import {
  ROOM_LABELS,
  ROOM_REPRESENTATIVE_COLORS,
  PRODUCT_LABELS,
  PRODUCT_REPRESENTATIVE_COLORS,
} from '@/utils/schedule'
import type { RoomKey } from '@/types/schedule'

const FACILITY_COLORS_STORAGE_KEY = 'riic-tools:facility-colors:v1'
const PRODUCT_COLORS_STORAGE_KEY = 'riic-tools:product-colors:v1'
const LEGACY_FACILITY_COLORS_STORAGE_KEY = 'riic-tools:maa-facility-colors:v1'
const LEGACY_PRODUCT_COLORS_STORAGE_KEY = 'riic-tools:maa-product-colors:v1'
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

const PRODUCT_COLOR_KEYS = ['Pure Gold', 'Orundum', 'Originium Shard'] as const
export type ProductColorKey = (typeof PRODUCT_COLOR_KEYS)[number]

function readStoredColors(key: string, legacyKey: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? window.localStorage.getItem(legacyKey)
  } catch {
    return null
  }
}

export function isProductColorKey(product: string): product is ProductColorKey {
  return PRODUCT_COLOR_KEYS.includes(product as ProductColorKey)
}

function cloneDefaultColors(): Record<RoomKey, string> {
  return { ...ROOM_REPRESENTATIVE_COLORS }
}

function loadFacilityColors(): Record<RoomKey, string> {
  const defaults = cloneDefaultColors()

  try {
    const stored = readStoredColors(FACILITY_COLORS_STORAGE_KEY, LEGACY_FACILITY_COLORS_STORAGE_KEY)
    if (!stored) {
      return defaults
    }

    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return defaults
    }

    Object.entries(parsed).forEach(([key, value]) => {
      if (key in defaults && typeof value === 'string' && HEX_COLOR_PATTERN.test(value)) {
        defaults[key as RoomKey] = value.toUpperCase()
      }
    })
  } catch {
    return defaults
  }

  return defaults
}

function cloneDefaultProductColors(): Record<ProductColorKey, string> {
  return {
    'Pure Gold': PRODUCT_REPRESENTATIVE_COLORS['Pure Gold'] ?? '#B87321',
    Orundum: PRODUCT_REPRESENTATIVE_COLORS.Orundum ?? '#B52D2D',
    'Originium Shard': PRODUCT_REPRESENTATIVE_COLORS['Originium Shard'] ?? '#B52D2D',
  }
}

function loadProductColors(): Record<ProductColorKey, string> {
  const defaults = cloneDefaultProductColors()

  try {
    const stored = readStoredColors(PRODUCT_COLORS_STORAGE_KEY, LEGACY_PRODUCT_COLORS_STORAGE_KEY)
    if (!stored) {
      return defaults
    }

    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return defaults
    }

    Object.entries(parsed).forEach(([key, value]) => {
      if (key in defaults && typeof value === 'string' && HEX_COLOR_PATTERN.test(value)) {
        defaults[key as ProductColorKey] = value.toUpperCase()
      }
    })
  } catch {
    return defaults
  }

  return defaults
}

const facilityColors = ref<Record<RoomKey, string>>(loadFacilityColors())
const productColors = ref<Record<ProductColorKey, string>>(loadProductColors())

function persistFacilityColors(): void {
  try {
    window.localStorage.setItem(FACILITY_COLORS_STORAGE_KEY, JSON.stringify(facilityColors.value))
  } catch {
    // localStorage 可能在隐私模式或受限环境中不可用，页面仍可继续编辑内存中的颜色。
  }
}

function setFacilityColor(type: RoomKey, color: string): void {
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

function setProductColor(product: ProductColorKey, color: string): void {
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

export function useFacilityColors() {
  return {
    facilityColors,
    facilityLabels: ROOM_LABELS,
    productColors,
    productLabels: {
      'Pure Gold': PRODUCT_LABELS['Pure Gold'] ?? '赤金',
      Orundum: PRODUCT_LABELS.Orundum ?? '合成玉',
      'Originium Shard': PRODUCT_LABELS['Originium Shard'] ?? '源石碎片',
    } satisfies Record<ProductColorKey, string>,
    setFacilityColor,
    setProductColor,
    resetFacilityColors,
  }
}
