<script setup lang="ts">
import {
  BookOutlined,
  CalculatorOutlined,
  ClusterOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  TableOutlined,
} from '@ant-design/icons-vue'
import { computed, ref } from 'vue'
import type { Component } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

import { useDataSource } from './composables/useDataSource'

interface NavigationItem {
  key: string
  label: string
  icon: Component
}

const navigationItems: NavigationItem[] = [
  { key: '/simulator', label: '排班模拟器', icon: ClusterOutlined },
  { key: '/schedule-calculator', label: '排班表计算器', icon: TableOutlined },
  { key: '/schedule-reference', label: '排班表参考', icon: BookOutlined },
  { key: '/basic-calculator', label: '基础计算器', icon: CalculatorOutlined },
  { key: '/operator-skills', label: '基建技能一览', icon: BookOutlined },
  { key: '/settings', label: '通用设置', icon: SettingOutlined },
]

const route = useRoute()
const router = useRouter()
const { selectedDataSourceLabel } = useDataSource()

const siderCollapsed = ref(false)
const isMobile = ref(false)
const mobileMenuOpen = ref(false)

const currentPath = computed(() => route.path)
const currentPageTitle = computed(() => {
  return navigationItems.find((item) => item.key === currentPath.value)?.label ?? '基建工具箱'
})

function handleMenuClick(info: { key: string | number }): void {
  mobileMenuOpen.value = false
  void router.push(String(info.key))
}

function toggleSider(): void {
  siderCollapsed.value = !siderCollapsed.value
}

function handleBreakpoint(broken: boolean): void {
  isMobile.value = broken
  if (broken) {
    siderCollapsed.value = true
  }
}

function handleHeaderNavigation(): void {
  if (isMobile.value) {
    mobileMenuOpen.value = true
    return
  }

  toggleSider()
}
</script>

<template>
  <a-layout class="app-layout">
    <a-layout-sider
      v-model:collapsed="siderCollapsed"
      :breakpoint="'lg'"
      :collapsed-width="0"
      :trigger="null"
      class="app-sider"
      @breakpoint="handleBreakpoint"
    >
      <div :class="{ 'sider-brand--collapsed': siderCollapsed }" class="sider-brand">
        <div v-if="!siderCollapsed" class="brand-copy">
          <strong>基建工具箱</strong>
          <span>RIIC TOOLS</span>
        </div>
      </div>

      <a-menu
        :selected-keys="[currentPath]"
        class="app-menu"
        mode="inline"
        theme="dark"
        @click="handleMenuClick"
      >
        <a-menu-item v-for="item in navigationItems" :key="item.key">
          <template #icon>
            <component :is="item.icon" />
          </template>
          <span>{{ item.label }}</span>
        </a-menu-item>
      </a-menu>

      <div v-if="!siderCollapsed" class="sider-footer">基建效率工具</div>
    </a-layout-sider>

    <a-layout>
      <a-layout-header class="app-header">
        <div class="header-left">
          <a-button
            class="header-nav-button"
            :aria-label="isMobile ? '打开导航菜单' : siderCollapsed ? '展开侧边栏' : '收起侧边栏'"
            type="text"
            @click="handleHeaderNavigation"
          >
            <MenuOutlined v-if="isMobile" />
            <MenuUnfoldOutlined v-else-if="siderCollapsed" />
            <MenuFoldOutlined v-else />
          </a-button>
          <div class="header-context">
            <span class="header-kicker">当前模块</span>
            <span class="header-title">{{ currentPageTitle }}</span>
          </div>
        </div>

        <div class="header-source">
          <span>数据源</span>
          <strong>{{ selectedDataSourceLabel }}</strong>
        </div>
      </a-layout-header>

      <a-layout-content class="app-content">
        <RouterView v-slot="{ Component: routeComponent }">
          <Transition mode="out-in" name="page-fade">
            <component :is="routeComponent" />
          </Transition>
        </RouterView>
      </a-layout-content>
    </a-layout>
  </a-layout>

  <a-drawer
    :body-style="{ padding: 0 }"
    :closable="false"
    :open="mobileMenuOpen"
    :title="null"
    placement="left"
    width="240"
    @close="mobileMenuOpen = false"
  >
    <div class="drawer-brand">
      <div class="brand-copy">
        <strong>基建工具箱</strong>
        <span>RIIC TOOLS</span>
      </div>
    </div>
    <a-menu
      :selected-keys="[currentPath]"
      class="app-menu app-menu--drawer"
      mode="inline"
      theme="dark"
      @click="handleMenuClick"
    >
      <a-menu-item v-for="item in navigationItems" :key="item.key">
        <template #icon>
          <component :is="item.icon" />
        </template>
        <span>{{ item.label }}</span>
      </a-menu-item>
    </a-menu>
  </a-drawer>
</template>
