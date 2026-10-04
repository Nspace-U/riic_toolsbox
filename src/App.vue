<script setup lang="ts">
import {
  BookOutlined,
  CalculatorOutlined,
  ClusterOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  PictureOutlined,
  ReadOutlined,
  ToolOutlined,
  SettingOutlined,
} from "@ant-design/icons-vue";
import { computed, ref, watch } from "vue";
import type { Component } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";

import { useBaseData } from "./composables/useBaseData";

interface NavigationItem {
  key: string;
  label: string;
  icon: Component;
  children?: NavigationChildItem[];
}

interface NavigationChildItem {
  key: string;
  label: string;
  icon: Component;
}

const navigationItems: NavigationItem[] = [
  { key: "/simulator", label: "排班模拟器", icon: ClusterOutlined },
  { key: "/schedule-reference", label: "排班表参考", icon: BookOutlined },
  { key: "/operator-skills", label: "基建技能一览", icon: BookOutlined },
  {
    key: "/calculators",
    label: "计算器",
    icon: CalculatorOutlined,
    children: [
      {
        key: "/calculators/combination",
        label: "组合计算器",
        icon: CalculatorOutlined,
      },
      {
        key: "/calculators/efficiency",
        label: "效率计算器",
        icon: CalculatorOutlined,
      },
    ],
  },
  {
    key: "/toolbox",
    label: "工具箱",
    icon: ToolOutlined,
    children: [
      {
        key: "/toolbox/avatar",
        label: "头像生成器",
        icon: PictureOutlined,
      },
      { key: "/toolbox/skill", label: "技能生成器", icon: ReadOutlined },
    ],
  },
  { key: "/settings", label: "通用设置", icon: SettingOutlined },
];

const route = useRoute();
const router = useRouter();
useBaseData();

const siderCollapsed = ref(false);
const isMobile = ref(false);
const mobileMenuOpen = ref(false);
const openNavigationKeys = ref<string[]>([]);

const currentPath = computed(() => route.path);
const currentPageTitle = computed(
  () => findNavigationLabel(currentPath.value) ?? "基建工具箱",
);
const mainLayoutOffset = computed(() =>
  siderCollapsed.value || isMobile.value ? "0" : "200px",
);
const mainLayoutStyle = computed(() => ({
  marginInlineStart: mainLayoutOffset.value,
  "--app-main-layout-offset": mainLayoutOffset.value,
}));

const selectedNavigationKey = computed(() => {
  return currentPath.value;
});

function findNavigationLabel(path: string): string | undefined {
  for (const item of navigationItems) {
    if (item.key === path) {
      return item.label;
    }

    const child = item.children?.find(
      (navigationChild) => navigationChild.key === path,
    );
    if (child) {
      return child.label;
    }
  }

  return undefined;
}

function handleMenuClick(info: { key: string | number }): void {
  mobileMenuOpen.value = false;
  void router.push(String(info.key));
}

function toggleSider(): void {
  siderCollapsed.value = !siderCollapsed.value;
}

function handleBreakpoint(broken: boolean): void {
  isMobile.value = broken;
  if (broken) {
    siderCollapsed.value = true;
  }
}

function handleHeaderNavigation(): void {
  if (isMobile.value) {
    mobileMenuOpen.value = true;
    return;
  }

  toggleSider();
}

function handleNavigationOpenChange(keys: string[]): void {
  openNavigationKeys.value = keys;
}

function handleRouteChange(path: string): void {
  if (path.startsWith("/calculators/")) {
    openNavigationKeys.value = ["/calculators"];
    return;
  }
  if (path === "/toolbox" || path.startsWith("/toolbox/")) {
    openNavigationKeys.value = ["/toolbox"];
  }
}

watch(currentPath, handleRouteChange, { immediate: true });
</script>

<template>
  <a-layout class="app-layout" has-sider>
    <a-layout-sider
      v-model:collapsed="siderCollapsed"
      :breakpoint="'lg'"
      :collapsed-width="0"
      :style="{
        overflow: 'auto',
        height: '100vh',
        position: 'fixed',
        insetBlockStart: 0,
        insetInlineStart: 0,
        insetBlockEnd: 0,
      }"
      :trigger="null"
      class="app-sider"
      @breakpoint="handleBreakpoint"
    >
      <div
        :class="{ 'sider-brand--collapsed': siderCollapsed }"
        class="sider-brand"
      >
        <div v-if="!siderCollapsed" class="brand-copy">
          <strong>基建工具箱</strong>
          <span>RIIC TOOLS</span>
        </div>
      </div>

      <a-menu
        :open-keys="isMobile ? [] : openNavigationKeys"
        :selected-keys="[selectedNavigationKey]"
        class="app-menu"
        mode="inline"
        theme="dark"
        @click="handleMenuClick"
        @open-change="handleNavigationOpenChange"
      >
        <template v-for="item in navigationItems" :key="item.key">
          <a-sub-menu v-if="item.children" :key="item.key">
            <template #icon>
              <component :is="item.icon" />
            </template>
            <template #title>{{ item.label }}</template>
            <a-menu-item v-for="child in item.children" :key="child.key">
              <template #icon>
                <component :is="child.icon" />
              </template>
              <span>{{ child.label }}</span>
            </a-menu-item>
          </a-sub-menu>
          <a-menu-item v-else :key="item.key">
            <template #icon>
              <component :is="item.icon" />
            </template>
            <span>{{ item.label }}</span>
          </a-menu-item>
        </template>
      </a-menu>

      <div v-if="!siderCollapsed" class="sider-footer">基建效率工具</div>
    </a-layout-sider>

    <a-layout :style="mainLayoutStyle" class="app-main-layout">
      <a-layout-header
        :style="{ insetInlineStart: mainLayoutOffset }"
        class="app-header"
      >
        <div class="header-left">
          <a-button
            class="header-nav-button"
            :aria-label="
              isMobile
                ? '打开导航菜单'
                : siderCollapsed
                  ? '展开侧边栏'
                  : '收起侧边栏'
            "
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
    root-class-name="app-drawer"
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
      :open-keys="openNavigationKeys"
      :selected-keys="[selectedNavigationKey]"
      class="app-menu app-menu--drawer"
      mode="inline"
      theme="dark"
      @click="handleMenuClick"
      @open-change="handleNavigationOpenChange"
    >
      <template v-for="item in navigationItems" :key="item.key">
        <a-sub-menu v-if="item.children" :key="item.key">
          <template #icon>
            <component :is="item.icon" />
          </template>
          <template #title>{{ item.label }}</template>
          <a-menu-item v-for="child in item.children" :key="child.key">
            <template #icon>
              <component :is="child.icon" />
            </template>
            <span>{{ child.label }}</span>
          </a-menu-item>
        </a-sub-menu>
        <a-menu-item v-else :key="item.key">
          <template #icon>
            <component :is="item.icon" />
          </template>
          <span>{{ item.label }}</span>
        </a-menu-item>
      </template>
    </a-menu>
  </a-drawer>
</template>
