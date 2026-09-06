<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  text: string
  query: string
}>()

const parts = computed(() => {
  const query = props.query.trim()
  if (!query) {
    return [{ text: props.text, highlighted: false }]
  }

  const lowerText = props.text.toLocaleLowerCase()
  const lowerQuery = query.toLocaleLowerCase()
  const result: Array<{ text: string; highlighted: boolean }> = []
  let cursor = 0
  let matchIndex = lowerText.indexOf(lowerQuery, cursor)
  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      result.push({ text: props.text.slice(cursor, matchIndex), highlighted: false })
    }
    result.push({ text: props.text.slice(matchIndex, matchIndex + query.length), highlighted: true })
    cursor = matchIndex + query.length
    matchIndex = lowerText.indexOf(lowerQuery, cursor)
  }

  if (cursor < props.text.length) {
    result.push({ text: props.text.slice(cursor), highlighted: false })
  }
  return result.length > 0 ? result : [{ text: props.text, highlighted: false }]
})
</script>

<template>
  <template v-for="(part, index) in parts" :key="`${index}-${part.text}`">
    <mark v-if="part.highlighted" class="search-highlight">{{ part.text }}</mark>
    <template v-else>{{ part.text }}</template>
  </template>
</template>
