<script setup lang="ts">
import { DownOutlined, UpOutlined } from '@ant-design/icons-vue'
import { computed } from 'vue'

import RichTextDescription from '@/components/RichTextDescription.vue'
import SearchHighlight from '@/components/SearchHighlight.vue'
import type { DataSourceId } from '@/composables/useDataSource'
import type { BaseSkillTerm, Operator, OperatorSkill } from '@/types/baseData'
import { getOperatorTerms } from '@/utils/operatorSkill'
import { getOperatorAvatarFile, getOperatorAvatarSourceUrl } from '@/utils/operatorAvatar'

const props = withDefaults(defineProps<{
  dataSource: DataSourceId
  operator: Operator
  terms: Record<string, BaseSkillTerm>
  skills?: OperatorSkill[]
  visibleSkills?: OperatorSkill[]
  operatorTerms?: Array<[string, BaseSkillTerm]>
  expanded?: boolean
  showExpandButton?: boolean
  showOperatorId?: boolean
  showTerms?: boolean
  showTermDefinitions?: boolean
  searchText?: string
}>(), {
  skills: undefined,
  visibleSkills: undefined,
  expanded: false,
  showExpandButton: false,
  showOperatorId: true,
  showTerms: true,
  showTermDefinitions: true,
  searchText: '',
})

const emit = defineEmits<{
  'toggle-expanded': []
}>()

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

function imageUrl(directory: string, fileName: string): string {
  const encodedFileName = encodeURIComponent(fileName)
    .replace(/%2B/g, '+')
    .replace(/%26/g, '&')
  return assetUrl(`${directory}/${encodedFileName}`)
}

function operatorAvatarUrl(operator: Operator): string | undefined {
  const avatarFile = getOperatorAvatarFile(operator, 0)
  return avatarFile ? getOperatorAvatarSourceUrl(props.dataSource, avatarFile) : undefined
}

function isReplaced(skill: OperatorSkill): boolean {
  return skill.replacement.includes('被「')
}

function rarityLabel(operator: Operator): string {
  return operator.rarity > 0 ? `${operator.rarity}★` : '未知稀有度'
}

function skillKey(skill: OperatorSkill): string {
  return `${skill.slot}-${skill.name}-${skill.unlockCondition}`
}

const allSkills = computed(() => props.skills ?? props.operator.skills)
const visibleSkillKeys = computed(() => new Set((props.visibleSkills ?? allSkills.value).map(skillKey)))
const termsForOperator = computed<Array<[string, BaseSkillTerm]>>(() => {
  if (props.operatorTerms) {
    return props.operatorTerms
  }

  return getOperatorTerms(props.operator, props.terms)
})

function isSkillVisible(skill: OperatorSkill): boolean {
  return props.expanded || visibleSkillKeys.value.has(skillKey(skill))
}
</script>

<template>
  <a-card :bordered="false" class="operator-card">
    <div class="operator-avatar-column">
      <img
        v-if="operatorAvatarUrl(operator)"
        :alt="`${operator.name}头像`"
        :src="operatorAvatarUrl(operator) || ''"
        decoding="async"
      />
      <div v-else class="operator-avatar-placeholder">暂无</div>
    </div>

    <div class="operator-profile-copy">
      <h3><SearchHighlight :query="searchText" :text="operator.name" /></h3>
      <span v-if="showOperatorId" class="operator-id"><SearchHighlight :query="searchText" :text="operator.id" /></span>
      <div class="operator-tags">
        <a-tag color="gold"><SearchHighlight :query="searchText" :text="rarityLabel(operator)" /></a-tag>
        <a-tag color="blue"><SearchHighlight :query="searchText" :text="operator.profession || '未知职业'" /></a-tag>
        <a-tag v-if="operator.branch"><SearchHighlight :query="searchText" :text="operator.branch" /></a-tag>
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
          <span v-else>{{ skill.name.slice(0, 1) || '?' }}</span>
        </div>
        <div class="operator-skill-copy">
          <div class="operator-skill-meta">
            <a-tag color="cyan"><SearchHighlight :query="searchText" :text="skill.unlockCondition || '未注明解锁条件'" /></a-tag>
            <a-tag v-if="skill.facility" color="green"><SearchHighlight :query="searchText" :text="skill.facility" /></a-tag>
            <a-tag v-if="isReplaced(skill)" color="orange">被替换</a-tag>
          </div>
          <h4><SearchHighlight :query="searchText" :text="skill.name || '未命名技能'" /></h4>
          <RichTextDescription
            v-if="skill.description"
            :highlight-query="searchText"
            :terms="terms"
            :text="skill.description"
          />
        </div>
      </article>
      <a-button
        v-if="showExpandButton && (allSkills.length > (visibleSkills?.length ?? allSkills.length) || expanded)"
        class="operator-hidden-skills-button"
        type="text"
        @click="emit('toggle-expanded')"
      >
        <template #icon>
          <UpOutlined v-if="expanded" />
          <DownOutlined v-else />
        </template>
        {{ expanded ? '折叠隐藏技能' : '展开隐藏技能' }}
      </a-button>
    </div>

    <div v-if="showTerms && termsForOperator.length" class="operator-terms">
      <span class="operator-terms-label">所属术语</span>
      <span class="operator-terms-list">
        <a-tooltip
          v-for="([termKey, term]) in termsForOperator"
          :key="termKey"
          placement="topLeft"
        >
          <template #title>
            <div class="term-tooltip-title">术语：{{ term.name }}</div>
            <div v-if="showTermDefinitions && term.definition" class="term-tooltip-definition">{{ term.definition }}</div>
          </template>
          <span class="term-text"><SearchHighlight :query="searchText" :text="term.name" /></span>
        </a-tooltip>
      </span>
      <div v-if="showTermDefinitions" class="operator-term-definitions">
        <div
          v-for="([termKey, term]) in termsForOperator"
          :key="`${termKey}-definition`"
          v-show="term.definition"
          class="operator-term-definition"
        >
          <span>{{ term.definition }}</span>
        </div>
      </div>
    </div>
  </a-card>
</template>
