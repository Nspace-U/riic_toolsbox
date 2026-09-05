<script setup lang="ts">
import { SettingOutlined } from '@ant-design/icons-vue'

import { isDataSourceId, useDataSource } from '@/composables/useDataSource'

const { dataSourceOptions, selectedDataSource, selectedDataSourceLabel, setDataSource } = useDataSource()

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
  </div>
</template>
