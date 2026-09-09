<script setup lang="ts">
import type { Component } from "vue";

defineProps<{
  icon: Component;
  title: string;
}>();
</script>

<template>
  <div class="page-shell">
    <div class="page-heading">
      <div class="page-heading-icon" aria-hidden="true">
        <component :is="icon" />
      </div>
      <a-typography-title :level="2" class="page-title">{{
        title
      }}</a-typography-title>
    </div>

    <a-card :bordered="false" class="placeholder-panel">
      <a-empty description="暂无内容" />
    </a-card>
  </div>
</template>
