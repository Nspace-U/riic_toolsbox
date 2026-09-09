<script setup lang="ts">
import { DownOutlined, UpOutlined } from "@ant-design/icons-vue";
import { computed } from "vue";

import OperatorAvatarDisplay from "@/components/OperatorAvatarDisplay.vue";
import RichTextDescription from "@/components/RichTextDescription.vue";
import SearchHighlight from "@/components/SearchHighlight.vue";
import type { DataSourceId } from "@/composables/useDataSource";
import type {
  Operator,
  OperatorSkill,
  RichTextStyles,
  SkillTerm,
  SkillTermReference,
} from "@/types/baseData";
import { getOperatorTerms } from "@/utils/operatorSkill";
import {
  getOperatorAvatarFile,
  getOperatorAvatarSourceUrl,
} from "@/utils/operatorAvatar";

const props = withDefaults(
  defineProps<{
    dataSource: DataSourceId;
    operator: Operator;
    terms: Record<string, SkillTerm>;
    skills?: OperatorSkill[];
    visibleSkills?: OperatorSkill[];
    operatorTerms?: SkillTermReference[];
    richTextStyles: RichTextStyles;
    expanded?: boolean;
    showExpandButton?: boolean;
    showOperatorId?: boolean;
    showTerms?: boolean;
    showTermDefinitions?: boolean;
    searchText?: string;
  }>(),
  {
    skills: undefined,
    visibleSkills: undefined,
    expanded: false,
    showExpandButton: false,
    showOperatorId: true,
    showTerms: true,
    showTermDefinitions: true,
    searchText: "",
  },
);

const emit = defineEmits<{
  "toggle-expanded": [];
}>();

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

function imageUrl(directory: string, fileName: string): string {
  const encodedFileName = encodeURIComponent(fileName)
    .replace(/%2B/g, "+")
    .replace(/%26/g, "&");
  return assetUrl(`${directory}/${encodedFileName}`);
}

function operatorAvatarUrl(operator: Operator): string | undefined {
  const avatarFile = getOperatorAvatarFile(operator, 0);
  return avatarFile
    ? getOperatorAvatarSourceUrl(props.dataSource, avatarFile)
    : undefined;
}

function isReplaced(skill: OperatorSkill): boolean {
  return skill.replacement.includes("被「");
}

function rarityLabel(operator: Operator): string {
  return operator.rarity > 0 ? `${operator.rarity}★` : "未知稀有度";
}

function skillKey(skill: OperatorSkill): string {
  return `${skill.slot}-${skill.name}-${skill.unlockCondition}`;
}

function termDefinition(term: SkillTermReference): string | undefined {
  return props.terms[term.key]?.definition;
}

const allSkills = computed(() => props.skills ?? props.operator.skills);
const visibleSkillKeys = computed(
  () => new Set((props.visibleSkills ?? allSkills.value).map(skillKey)),
);
const termsForOperator = computed<SkillTermReference[]>(() => {
  if (props.operatorTerms) {
    return props.operatorTerms;
  }

  return getOperatorTerms(props.operator);
});

function isSkillVisible(skill: OperatorSkill): boolean {
  return props.expanded || visibleSkillKeys.value.has(skillKey(skill));
}
</script>

<template>
  <a-card :bordered="false" class="operator-card">
    <div class="operator-avatar-column">
      <OperatorAvatarDisplay
        v-if="operatorAvatarUrl(operator)"
        :data-source="dataSource"
        :elite-level="0"
        :mood-scattered="false"
        :operator="operator"
        :plain="true"
        :show-elite-level="false"
        :show-name="false"
        :show-profession="false"
        :show-rarity="false"
        :size="112"
      />
      <div v-else class="operator-avatar-placeholder">暂无</div>
    </div>

    <div class="operator-profile-copy">
      <h3><SearchHighlight :query="searchText" :text="operator.name" /></h3>
      <span v-if="showOperatorId" class="operator-id"
        ><SearchHighlight :query="searchText" :text="operator.id"
      /></span>
      <div class="operator-tags">
        <a-tag color="gold"
          ><SearchHighlight :query="searchText" :text="rarityLabel(operator)"
        /></a-tag>
        <a-tag color="blue"
          ><SearchHighlight
            :query="searchText"
            :text="operator.profession || '未知职业'"
        /></a-tag>
        <a-tag v-if="operator.branch"
          ><SearchHighlight :query="searchText" :text="operator.branch"
        /></a-tag>
      </div>
      <div v-if="showTerms && termsForOperator.length" class="operator-terms">
        <span class="operator-terms-label">所属术语</span>
        <span class="operator-terms-list">
          <a-tooltip
            v-for="term in termsForOperator"
            :key="term.key"
            :align="{ offset: [0, 0] }"
            overlay-class-name="term-tooltip"
            placement="topLeft"
          >
            <template #title>
              <div class="term-tooltip-title">术语：{{ term.name }}</div>
              <div
                v-if="showTermDefinitions && termDefinition(term)"
                class="term-tooltip-definition"
              >
                <RichTextDescription
                  :show-term-definitions="showTermDefinitions"
                  :show-terms="showTerms"
                  :rich-text-styles="richTextStyles"
                  :term-definition-depth="1"
                  :terms="terms"
                  :text="termDefinition(term) ?? ''"
                />
              </div>
            </template>
            <span class="term-text"
              ><SearchHighlight :query="searchText" :text="term.name"
            /></span>
          </a-tooltip>
        </span>
      </div>
    </div>

    <div class="operator-skills-list">
      <article
        v-for="skill in allSkills"
        :key="skillKey(skill)"
        v-show="isSkillVisible(skill)"
        :class="{ 'operator-skill-row--replaced': isReplaced(skill) }"
        class="operator-skill-row"
      >
        <div class="skill-icon">
          <img
            v-if="skill.iconFile"
            :alt="`${skill.name}图标`"
            :src="imageUrl('assets/raw/build_skill_icon', skill.iconFile)"
            decoding="async"
          />
          <span v-else>{{ skill.name.slice(0, 1) || "?" }}</span>
        </div>
        <div class="operator-skill-copy">
          <div class="operator-skill-meta">
            <a-tag color="cyan"
              ><SearchHighlight
                :query="searchText"
                :text="skill.unlockCondition || '未注明解锁条件'"
            /></a-tag>
            <a-tag v-if="skill.facility" color="green"
              ><SearchHighlight :query="searchText" :text="skill.facility"
            /></a-tag>
            <a-tag v-if="isReplaced(skill)" color="orange">被替换</a-tag>
          </div>
          <h4>
            <SearchHighlight
              :query="searchText"
              :text="skill.name || '未命名技能'"
            />
          </h4>
          <RichTextDescription
            v-if="skill.description"
            :highlight-query="searchText"
            :show-term-definitions="showTermDefinitions"
            :show-terms="showTerms"
            :rich-text-styles="richTextStyles"
            :terms="terms"
            :text="skill.description"
          />
        </div>
      </article>
      <a-button
        v-if="
          showExpandButton &&
          (allSkills.length > (visibleSkills?.length ?? allSkills.length) ||
            expanded)
        "
        class="operator-hidden-skills-button"
        type="text"
        @click="emit('toggle-expanded')"
      >
        <template #icon>
          <UpOutlined v-if="expanded" />
          <DownOutlined v-else />
        </template>
        {{ expanded ? "折叠隐藏技能" : "展开隐藏技能" }}
      </a-button>
    </div>

    <div
      v-if="
        showTerms &&
        showTermDefinitions &&
        termsForOperator.some((term) => termDefinition(term))
      "
      class="operator-term-definitions"
    >
      <div
        v-for="term in termsForOperator"
        :key="`${term.key}-definition`"
        v-show="termDefinition(term)"
        class="operator-term-definition"
      >
        <span class="operator-term-definition-name">{{ term.name }}：</span>
        <RichTextDescription
          :show-term-definitions="showTermDefinitions"
          :show-terms="showTerms"
          :rich-text-styles="richTextStyles"
          :term-definition-depth="1"
          :terms="terms"
          :text="termDefinition(term) ?? ''"
        />
      </div>
    </div>
  </a-card>
</template>
