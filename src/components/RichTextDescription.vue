<script setup lang="ts">
import { computed } from 'vue'

import type { BaseSkillTerm } from '@/types/baseData'

interface RichTextPart {
  text: string
  color?: string
  term?: BaseSkillTerm
}

const props = defineProps<{
  text: string
  terms: Record<string, BaseSkillTerm>
}>()

function parseParts(text: string, color?: string, term?: BaseSkillTerm): RichTextPart[] {
  const parts: RichTextPart[] = []
  let cursor = 0

  while (cursor < text.length) {
    const tagStart = text.indexOf('[', cursor)
    if (tagStart < 0) {
      parts.push({ text: text.slice(cursor), color, term })
      break
    }
    if (tagStart > cursor) {
      parts.push({ text: text.slice(cursor, tagStart), color, term })
    }

    const tagEnd = text.indexOf(']', tagStart)
    if (tagEnd < 0) {
      parts.push({ text: text.slice(tagStart), color, term })
      break
    }

    const openingTag = text.slice(tagStart, tagEnd + 1)
    const tagType = openingTag.startsWith('[C=') ? 'C' : openingTag.startsWith('[T=') ? 'T' : ''
    if (!tagType) {
      parts.push({ text: openingTag, color, term })
      cursor = tagEnd + 1
      continue
    }

    const closeTag = `[/${tagType}]`
    const closeIndex = text.indexOf(closeTag, tagEnd + 1)
    if (closeIndex < 0) {
      parts.push({ text: text.slice(tagStart), color, term })
      break
    }

    const attribute = openingTag.slice(3, -1)
    const nextColor = tagType === 'C' ? attribute : color
    const nextTerm = tagType === 'T' ? props.terms[attribute] : term
    parts.push(...parseParts(text.slice(tagEnd + 1, closeIndex), nextColor, nextTerm))
    cursor = closeIndex + closeTag.length
  }

  return parts
}

const parts = computed(() => parseParts(props.text))
</script>

<template>
  <span class="rich-description">
    <template v-for="(part, index) in parts" :key="`${index}-${part.text}`">
      <a-tooltip v-if="part.term" placement="topLeft">
        <template #title>
          <div class="term-tooltip-title">术语：{{ part.term.name }}</div>
          <div v-if="part.term.definition" class="term-tooltip-definition">{{ part.term.definition }}</div>
          <div v-if="part.term.members.length" class="term-tooltip-members">
            包含：{{ part.term.members.join('、') }}
          </div>
        </template>
        <span :style="{ color: part.color }" class="term-text">{{ part.text }}</span>
      </a-tooltip>
      <span v-else :style="{ color: part.color }">{{ part.text }}</span>
    </template>
  </span>
</template>
