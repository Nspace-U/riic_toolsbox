<script setup lang="ts">
import { SettingOutlined } from '@ant-design/icons-vue'

import { isDataSourceId, useDataSource } from '@/composables/useDataSource'
import { useFacilityColors } from '@/composables/useFacilityColors'
import type { RoomKey } from '@/types/schedule'

const { dataSourceOptions, selectedDataSource, selectedDataSourceLabel, setDataSource } = useDataSource()
const {
  facilityColors,
  facilityLabels,
  productColors,
  productLabels,
  setFacilityColor,
  setProductColor,
  resetFacilityColors,
} = useFacilityColors()

const facilityColorEntries = Object.entries(facilityLabels) as Array<[RoomKey, string]>
const productColorEntries = Object.entries(productLabels) as Array<['Pure Gold' | 'Orundum' | 'Originium Shard', string]>

function handleDataSourceChange(value: string): void {
  if (isDataSourceId(value)) {
    setDataSource(value)
  }
}
</script>

<template>
  <div class="page-shell settings-page">
    <div class="page-heading">
      <div class="page-heading-icon" aria-hidden="true">
        <SettingOutlined />
      </div>
      <a-typography-title :level="2" class="page-title">通用设置</a-typography-title>
    </div>

    <a-card :bordered="false" class="settings-panel" title="数据源设置">
      <a-form layout="vertical">
        <a-form-item label="数据源">
          <a-select
            :value="selectedDataSource"
            :options="dataSourceOptions"
            class="data-source-select"
            @change="handleDataSourceChange"
          />
        </a-form-item>
      </a-form>

      <div class="setting-current">
        <span>当前数据源</span>
        <strong>{{ selectedDataSourceLabel }}</strong>
      </div>
    </a-card>

    <a-card :bordered="false" class="settings-panel settings-facility-colors-panel" title="设施背景颜色">
      <p class="settings-panel-description">调整排班模拟器中各设施的默认背景颜色。产品专属颜色仍会优先显示。</p>
      <div class="facility-color-list">
        <div v-for="[type, label] in facilityColorEntries" :key="type" class="facility-color-item">
          <div class="facility-color-name">
            <span :style="{ backgroundColor: facilityColors[type] }" class="facility-color-swatch" />
            <span>{{ label }}</span>
          </div>
          <div class="facility-color-controls">
            <input
              :aria-label="`${label}背景颜色`"
              :value="facilityColors[type]"
              class="facility-color-picker"
              type="color"
              @input="setFacilityColor(type, ($event.target as HTMLInputElement).value)"
            >
            <a-input
              :aria-label="`${label}颜色值`"
              :value="facilityColors[type]"
              class="facility-color-value"
              :maxlength="7"
              size="small"
              @change="setFacilityColor(type, ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
        <div v-for="[product, label] in productColorEntries" :key="product" class="facility-color-item">
          <div class="facility-color-name">
            <span :style="{ backgroundColor: productColors[product] }" class="facility-color-swatch" />
            <span>{{ label }}</span>
          </div>
          <div class="facility-color-controls">
            <input
              :aria-label="`${label}背景颜色`"
              :value="productColors[product]"
              class="facility-color-picker"
              type="color"
              @input="setProductColor(product, ($event.target as HTMLInputElement).value)"
            >
            <a-input
              :aria-label="`${label}颜色值`"
              :value="productColors[product]"
              class="facility-color-value"
              :maxlength="7"
              size="small"
              @change="setProductColor(product, ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
      </div>
      <a-button class="facility-color-reset" @click="resetFacilityColors">恢复默认颜色</a-button>
    </a-card>
  </div>
</template>
