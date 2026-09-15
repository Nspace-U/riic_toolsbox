<script setup lang="ts">
import { computed } from "vue";

import type {
  EfficiencyPlanResult,
  FacilityEfficiencyResult,
  MoodSnapshot,
} from "@/types/efficiency";
import {
  cluePreferenceText,
  convertedProductionAmount,
  efficiencyStatLabel,
  facilityOverflowLabel,
  formatDurationHours,
  formatEfficiencyNumber,
  formatNumber,
  formatProduction,
  moodRateDetailLabel,
  moodRateFormula,
  operatorCalculationLines,
  productionLabel,
  productionMaterialsForDisplay,
  productionRateLabel,
  resourceLabel,
  signedNumber,
} from "@/utils/simulator/presentation";

export interface SimulatorCalculationStepView {
  plan: EfficiencyPlanResult;
  planIndex: number;
  facility?: FacilityEfficiencyResult;
  moods: MoodSnapshot[];
}

const props = defineProps<{
  step: SimulatorCalculationStepView;
  simulateOverflow: boolean;
  inheritedSourceLabel?: string;
}>();

const inheritedLabel = computed(() => props.inheritedSourceLabel ?? "");
</script>

<template>
  <div class="simulator-step-content">
    <template v-if="step.facility">
      <div class="simulator-step-formula">
        基础 {{ formatNumber(step.facility.baseEfficiency) }} + 心情
        {{ formatNumber(step.facility.moodEfficiency) }} + 干员技能
        {{ formatNumber(step.facility.operatorSkillEfficiency) }} =
        <strong>{{ formatNumber(step.facility.efficiency) }}%</strong>
      </div>
      <div class="simulator-step-stat-grid">
        <span>基础效率</span>
        <strong>{{ formatNumber(step.facility.baseEfficiency) }}</strong>
        <span>干员效率</span>
        <strong>{{ formatNumber(step.facility.moodEfficiency) }}</strong>
        <span>干员技能效率</span>
        <strong>{{
          signedNumber(step.facility.operatorSkillEfficiency)
        }}</strong>
        <span>组合效率</span>
        <strong
          >{{
            formatEfficiencyNumber(step.facility.combinationEfficiency)
          }}%</strong
        >
      </div>
      <div v-if="step.facility.inherited" class="simulator-inherited-note">
        本队列为跳过队列，已继承
        {{ inheritedLabel.replace(/^继承自 /, "") }}
        的干员与练度；心情按当前队列重新计算。
      </div>
      <div
        v-if="step.facility.capacity || step.facility.production"
        class="simulator-production-panel"
      >
        <span class="simulator-step-subheading">产出与容量</span>
        <div class="simulator-production-summary">
          <template v-if="step.facility.production">
            <span>产物</span>
            <strong>{{
              productionLabel(step.facility.production.product)
            }}</strong>
            <template v-if="step.facility.production.cluePreferences?.length">
              <span>线索倾向</span>
              <strong>{{
                cluePreferenceText(step.facility.production.cluePreferences)
              }}</strong>
            </template>
            <span>基础速率</span>
            <strong>
              {{
                formatProduction(
                  step.facility.production.baseAmountPerHour ??
                    step.facility.production.amountPerHour,
                )
              }}/小时
            </strong>
            <span>实际速率</span>
            <strong
              >{{
                formatProduction(step.facility.production.amountPerHour)
              }}/小时</strong
            >
            <span>容量单位速率</span>
            <strong>{{ productionRateLabel(step.facility.production) }}</strong>
            <template
              v-if="
                (step.facility.facility.type === 'trading' ||
                  step.facility.facility.type === 'manufacture') &&
                productionMaterialsForDisplay(
                  step.facility.production,
                  props.simulateOverflow,
                ).length
              "
            >
              <template
                v-for="material in productionMaterialsForDisplay(
                  step.facility.production,
                  props.simulateOverflow,
                )"
                :key="`facility-material-${material}`"
              >
                <span>材料消耗速率</span>
                <strong>{{ material }}</strong>
              </template>
            </template>
            <template v-if="step.facility.production.conversion">
              <span>单位折算</span>
              <strong>
                {{ step.facility.production.conversion.amountPerUnit }}
                {{ step.facility.production.conversion.label }}/{{
                  step.facility.production.conversion.sourceUnit
                }}
              </strong>
              <span>基础周期</span>
              <strong>
                {{ step.facility.production.conversion.baseCycleHours }} 小时/{{
                  step.facility.production.conversion.sourceUnit
                }}
              </strong>
              <span>折算实际速率</span>
              <strong>
                {{
                  formatProduction(
                    convertedProductionAmount(
                      step.facility.production,
                      step.facility.production.amountPerHour,
                    ),
                  )
                }}/小时
              </strong>
            </template>
            <template v-if="step.facility.production.orderRule">
              <span>订单规则</span>
              <strong>{{ step.facility.production.orderRule }}</strong>
            </template>
          </template>
          <template v-if="step.facility.capacity">
            <span>{{ step.facility.capacity.label }}</span>
            <strong>
              {{ formatNumber(step.facility.capacity.total) }}
              {{ step.facility.capacity.unit }}
              <small>
                （基础 {{ formatNumber(step.facility.capacity.base) }}，技能
                {{ signedNumber(step.facility.capacity.skill) }}）
              </small>
            </strong>
          </template>
          <template v-if="step.facility.production?.breachTime !== undefined">
            <span>爆仓</span>
            <strong>
              {{ facilityOverflowLabel(step.facility.production) }} ·
              {{ formatDurationHours(step.facility.production.breachTime) }}
            </strong>
          </template>
        </div>
        <div
          v-if="
            step.facility.capacity && step.facility.capacity.segments.length > 1
          "
          class="simulator-capacity-segment-list"
        >
          <span class="simulator-step-subheading">容量时间段</span>
          <div
            v-for="segment in step.facility.capacity.segments"
            :key="`${segment.startHours}-${segment.endHours}`"
            class="simulator-capacity-segment-row"
          >
            <span>
              {{ formatDurationHours(segment.startHours) }} -
              {{ formatDurationHours(segment.endHours) }}
            </span>
            <strong>
              {{ formatNumber(segment.total) }}
              {{ step.facility.capacity.unit }}
              <small>
                （基础 {{ formatNumber(segment.base) }}，技能
                {{ signedNumber(segment.skill) }}）
              </small>
            </strong>
          </div>
        </div>
        <div
          v-if="step.facility.production?.orders?.length"
          class="simulator-order-list"
        >
          <span class="simulator-step-subheading">订单摘要</span>
          <div
            v-for="order in step.facility.production.orders"
            :key="`${order.name}-${order.time}-${order.quantity}`"
            class="simulator-order-row"
          >
            <span>
              {{ order.name }} · {{ formatNumber(order.probability * 100) }}%
            </span>
            <span>
              {{ formatNumber(order.quantity) }} /
              {{ formatNumber(order.time) }} 小时
              <template v-if="order.material">
                · {{ resourceLabel(order.material) }} ×
                {{ formatNumber(order.amount ?? 0) }}
              </template>
            </span>
          </div>
        </div>
      </div>
      <div
        v-if="step.facility.operatorContributions.length"
        class="simulator-operator-contribution-list"
      >
        <span class="simulator-step-subheading">干员组合贡献</span>
        <div
          v-for="contribution in step.facility.operatorContributions"
          :key="contribution.operator"
          class="simulator-operator-contribution"
        >
          <span>{{ contribution.operator }}</span>
          <span>
            {{ signedNumber(contribution.efficiency) }}（基础
            {{ signedNumber(contribution.baseEfficiency) }}，技能
            {{ signedNumber(contribution.skillEfficiency) }}）
          </span>
        </div>
      </div>
      <div v-if="step.facility.details.length" class="simulator-detail-list">
        <span class="simulator-step-subheading">生效技能明细</span>
        <div
          v-for="(detail, detailIndex) in step.facility.details"
          :key="`${detail.operator}-${detail.skill ?? 'skill'}-${detail.stat}-${detailIndex}`"
          class="simulator-detail-row"
        >
          <div class="simulator-detail-main">
            <span>
              {{ detail.operator
              }}<template v-if="detail.skill"> · {{ detail.skill }}</template>
            </span>
            <div
              v-if="operatorCalculationLines(detail).length"
              class="simulator-detail-calculation simulator-step-formula"
            >
              <div
                v-for="(line, lineIndex) in operatorCalculationLines(detail)"
                :key="`${detailIndex}-${lineIndex}`"
              >
                {{ line }}
              </div>
            </div>
          </div>
          <span>
            {{ efficiencyStatLabel(detail.stat) }}
            {{ signedNumber(detail.value) }}
          </span>
        </div>
      </div>
      <a-empty
        v-if="!step.facility.details.length && !step.moods.length"
        :image="undefined"
        class="simulator-step-empty"
        description="当前设施没有可展开的技能明细"
      />
    </template>
    <div v-if="step.moods.length" class="simulator-mood-calculation-list">
      <span class="simulator-step-subheading">干员心情消耗步骤</span>
      <div
        v-for="mood in step.moods"
        :key="`${mood.facilityId}-${mood.slotIndex}-${mood.operator}`"
        class="simulator-mood-calculation"
      >
        <div class="simulator-mood-calculation-header">
          <span>{{ mood.operator }}</span>
          <strong>剩余 {{ formatNumber(mood.end) }}</strong>
        </div>
        <div class="simulator-mood-rate-steps">
          <div
            v-for="(detail, detailIndex) in mood.rateDetails"
            :key="`${mood.operator}-${detail.kind}-${detailIndex}`"
            class="simulator-mood-rate-step"
          >
            <span>{{ moodRateDetailLabel(detail) }}</span>
            <strong>{{ signedNumber(detail.value) }}/小时</strong>
          </div>
          <div class="simulator-mood-rate-step">
            <span>消耗速度</span>
            <strong>{{ moodRateFormula(mood) }}</strong>
          </div>
        </div>
        <div class="simulator-step-formula">
          {{ formatNumber(mood.start) }} - {{ formatNumber(mood.costRate) }} ×
          {{ formatNumber(step.plan.durationHours) }} =
          <strong>{{ formatNumber(mood.end) }}</strong>
        </div>
      </div>
    </div>
  </div>
</template>
