<script setup lang="ts">
import { computed } from "vue";

import SearchHighlight from "@/components/SearchHighlight.vue";
import type { RichTextStyles, SkillTerm } from "@/types/baseData";

interface RichTextPart {
  text: string;
  color?: string;
  term?: SkillTerm;
}

const props = defineProps<{
  highlightQuery?: string;
  richTextStyles: RichTextStyles;
  termDefinitionDepth?: number;
  text: string;
  terms: Record<string, SkillTerm>;
}>();

const termDefinitionDepth = computed(() => props.termDefinitionDepth ?? 0);
const canShowTermDefinitions = computed(() => {
  return termDefinitionDepth.value < 2;
});

const MARKUP_TOKEN = /<\$[^>]+>|<@[^>]+>|<\/>/g;

function styleColor(style: string | undefined): string | undefined {
  return style?.match(/<color\s*=\s*([^>]+)>/i)?.[1]?.trim();
}

function parseParts(
  text: string,
  color?: string,
  term?: SkillTerm,
  cursor = 0,
  closingTag?: string,
): { parts: RichTextPart[]; cursor: number } {
  const parts: RichTextPart[] = [];

  while (cursor < text.length) {
    MARKUP_TOKEN.lastIndex = cursor;
    const match = MARKUP_TOKEN.exec(text);
    if (!match) {
      parts.push({ text: text.slice(cursor), color, term });
      return { parts, cursor: text.length };
    }

    const tag = match[0];
    const tagStart = match.index;
    if (tagStart > cursor) {
      parts.push({ text: text.slice(cursor, tagStart), color, term });
    }
    if (tag === closingTag) {
      return { parts, cursor: tagStart + tag.length };
    }
    if (tag === "</>") {
      parts.push({ text: tag, color, term });
      cursor = tagStart + tag.length;
      continue;
    }

    const tagType = tag[1];
    const attribute = tag.slice(2, -1);
    const nextColor =
      tagType === "@" ? styleColor(props.richTextStyles[attribute]) : color;
    const nextTerm = tagType === "$" ? props.terms[attribute] : term;
    const nextClosingTag = "</>";
    const child = parseParts(
      text,
      nextColor,
      nextTerm,
      tagStart + tag.length,
      nextClosingTag,
    );
    if (
      tagType === "$" &&
      !nextTerm &&
      !Object.hasOwn(props.richTextStyles, attribute)
    ) {
      const name = child.parts
        .map((part) => part.text)
        .join("")
        .trim();
      child.parts.forEach((part) => {
        part.term = { name };
      });
    }
    parts.push(...child.parts);
    cursor = child.cursor;
  }

  return { parts, cursor };
}

const parts = computed(() => {
  const normalizedText = props.text.replace(/<<(?=[$@])/g, "<");
  return parseParts(normalizedText).parts;
});
</script>

<template>
  <span class="rich-description">
    <template v-for="(part, index) in parts" :key="`${index}-${part.text}`">
      <a-tooltip
        v-if="part.term"
        :align="{ offset: [0, 0] }"
        overlay-class-name="term-tooltip"
        placement="topLeft"
      >
        <template #title>
          <div class="term-tooltip-title">术语：{{ part.term.name }}</div>
          <div
            v-if="canShowTermDefinitions && part.term.definition"
            class="term-tooltip-definition"
          >
            <RichTextDescription
              :rich-text-styles="richTextStyles"
              :term-definition-depth="termDefinitionDepth + 1"
              :terms="terms"
              :text="part.term.definition"
            />
          </div>
        </template>
        <span :style="{ color: part.color }" class="term-text">
          <SearchHighlight :query="highlightQuery ?? ''" :text="part.text" />
        </span>
      </a-tooltip>
      <span v-else :style="{ color: part.color }">
        <SearchHighlight :query="highlightQuery ?? ''" :text="part.text" />
      </span>
    </template>
  </span>
</template>
