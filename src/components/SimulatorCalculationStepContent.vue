<script setup lang="ts">
import { computed } from "vue";

import type {
  EfficiencyPlanResult,
  FacilityEfficiencyResult,
  MoodSnapshot,
} from "@arknights/riic-efficiency";
import SimulatorNumericValue from "@/components/SimulatorNumericValue.vue";
import {
  cluePreferenceText,
  convertedProductionAmount,
  efficiencyStatLabel,
  efficiencyStatUnit,
  facilityOverflowLabel,
  formatNumber,
  moodRateDetailLabel,
  moodRateFormula,
  operatorCalculationRows,
  productionLabel,
  productionMaterialsForDisplay,
  resourceLabel,
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
      <section class="simulator-step-section">
        <span class="simulator-step-subheading">效率汇总</span>
        <div class="simulator-step-detail-grid">
          <span>基础效率</span>
          <strong
            ><SimulatorNumericValue
              :value="step.facility.baseEfficiency"
              unit="%"
            />%</strong
          >
          <span>干员效率</span>
          <strong
            ><SimulatorNumericValue
              mode="signed"
              :value="step.facility.moodEfficiency"
              unit="%"
            />%</strong
          >
          <span>干员技能效率</span>
          <strong
            ><SimulatorNumericValue
              mode="signed"
              :value="step.facility.operatorSkillEfficiency"
              unit="%"
            />%</strong
          >
          <span>整体效率</span>
          <strong
            ><SimulatorNumericValue
              :value="step.facility.efficiency"
              unit="%"
            />%</strong
          >
          <span>计算公式</span>
          <span>
            基础 {{ formatNumber(step.facility.baseEfficiency) }}% + 心情
            {{ formatNumber(step.facility.moodEfficiency) }}% + 干员技能
            {{ formatNumber(step.facility.operatorSkillEfficiency) }}% =
            {{ formatNumber(step.facility.efficiency) }}%
          </span>
        </div>
      </section>
      <section v-if="step.facility.inherited" class="simulator-step-section">
        <span class="simulator-step-subheading">继承说明</span>
        <div class="simulator-step-detail-grid">
          <span>说明</span>
          <span>
            本队列为跳过队列，已继承
            {{ inheritedLabel.replace(/^继承自 /, "") }}
            的干员与练度；心情按当前队列重新计算。
          </span>
        </div>
      </section>
      <div
        v-if="step.facility.capacity || step.facility.production"
        class="simulator-step-section"
      >
        <span class="simulator-step-subheading">产出与容量</span>
        <div class="simulator-step-detail-grid">
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
              <SimulatorNumericValue
                mode="production"
                :value="
                  step.facility.production.baseAmountPerHour ??
                  step.facility.production.amountPerHour
                "
                unit="/小时"
              />/小时
            </strong>
            <span>实际速率</span>
            <strong
              ><SimulatorNumericValue
                mode="production"
                :value="step.facility.production.amountPerHour"
                unit="/小时"
              />/小时</strong
            >
            <span>容量消耗速率</span>
            <strong>
              <template v-if="step.facility.production.itemRate !== undefined">
                <SimulatorNumericValue
                  mode="production"
                  :value="step.facility.production.itemRate"
                  unit=" / 小时"
                />
                / 小时
              </template>
            </strong>
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
                :key="`facility-material-${material.material}`"
              >
                <span>基础材料消耗速率</span>
                <strong>
                  {{ resourceLabel(material.material) }}
                  <SimulatorNumericValue
                    mode="signed"
                    :value="material.baseAmount"
                    unit="/小时"
                  />/小时
                </strong>
                <span>材料消耗速率</span>
                <strong>
                  {{ resourceLabel(material.material) }}
                  <SimulatorNumericValue
                    mode="signed"
                    :value="material.amount"
                    unit="/小时"
                  />/小时
                </strong>
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
                <SimulatorNumericValue
                  mode="production"
                  :value="
                    convertedProductionAmount(
                      step.facility.production,
                      step.facility.production.amountPerHour,
                    )
                  "
                  unit="/小时"
                />/小时
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
              <SimulatorNumericValue
                :value="step.facility.capacity.total"
                :unit="step.facility.capacity.unit"
              />
              {{ step.facility.capacity.unit }}
              <small>
                （基础
                <SimulatorNumericValue
                  :value="step.facility.capacity.base"
                  :unit="step.facility.capacity.unit"
                />，技能
                <SimulatorNumericValue
                  mode="signed"
                  :value="step.facility.capacity.skill"
                  :unit="step.facility.capacity.unit"
                />）
              </small>
            </strong>
          </template>
          <template v-if="step.facility.production?.breachTime !== undefined">
            <span>爆仓</span>
            <strong>
              {{ facilityOverflowLabel(step.facility.production) }} ·
              <SimulatorNumericValue
                :value="step.facility.production.breachTime"
                unit="小时"
              />
              小时
            </strong>
          </template>
        </div>
        <div
          v-if="
            step.facility.capacity && step.facility.capacity.segments.length > 1
          "
          class="simulator-step-subsection"
        >
          <span class="simulator-step-subheading">动态容量时间段</span>
          <div class="simulator-step-detail-grid">
            <div
              v-for="segment in step.facility.capacity.segments"
              :key="`${segment.startHours}-${segment.endHours}`"
              class="simulator-step-detail-row"
            >
              <span>
                <SimulatorNumericValue
                  :value="segment.startHours"
                  unit="小时"
                />
                小时 -
                <SimulatorNumericValue :value="segment.endHours" unit="小时" />
                小时
              </span>
              <strong>
                <SimulatorNumericValue
                  :value="segment.total"
                  :unit="step.facility.capacity.unit"
                />
                {{ step.facility.capacity.unit }}
                <small>
                  （基础
                  <SimulatorNumericValue
                    :value="segment.base"
                    :unit="step.facility.capacity.unit"
                  />，技能
                  <SimulatorNumericValue
                    mode="signed"
                    :value="segment.skill"
                    :unit="step.facility.capacity.unit"
                  />）
                </small>
              </strong>
            </div>
          </div>
        </div>
        <div
          v-if="step.facility.production?.orders?.length"
          class="simulator-step-subsection"
        >
          <span class="simulator-step-subheading">订单摘要</span>
          <div class="simulator-step-detail-grid">
            <div
              v-for="order in step.facility.production.orders"
              :key="`${order.name}-${order.time}-${order.quantity}`"
              class="simulator-step-detail-row"
            >
              <span>
                {{ order.name }} ·
                <SimulatorNumericValue
                  :value="order.probability * 100"
                  unit="%"
                />%
              </span>
              <span>
                <SimulatorNumericValue :value="order.quantity" /> /
                <SimulatorNumericValue :value="order.time" unit="小时" /> 小时
                <template v-if="order.material">
                  · {{ resourceLabel(order.material) }} ×
                  <SimulatorNumericValue :value="order.amount ?? 0" />
                </template>
              </span>
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="step.facility.operatorContributions.length"
        class="simulator-step-section"
      >
        <span class="simulator-step-subheading">干员组合贡献</span>
        <div class="simulator-step-detail-grid">
          <div
            v-for="contribution in step.facility.operatorContributions"
            :key="contribution.operator"
            class="simulator-step-detail-row"
          >
            <span>{{ contribution.operator }}</span>
            <span>
              <SimulatorNumericValue
                mode="signed"
                :value="contribution.efficiency"
              />（基础
              <SimulatorNumericValue
                mode="signed"
                :value="contribution.baseEfficiency"
              />，技能
              <SimulatorNumericValue
                mode="signed"
                :value="contribution.skillEfficiency"
              />）
            </span>
          </div>
        </div>
      </div>
      <div v-if="step.facility.details.length" class="simulator-step-section">
        <span class="simulator-step-subheading">生效技能明细</span>
        <div class="simulator-skill-detail-list">
          <div
            v-for="(detail, detailIndex) in step.facility.details"
            :key="`${detail.operator}-${detail.skill ?? 'skill'}-${detail.stat}-${detailIndex}`"
            class="simulator-skill-detail-row"
          >
            <span>
              {{ detail.operator
              }}<template v-if="detail.skill"> · {{ detail.skill }}</template>
            </span>
            <span>
              {{ efficiencyStatLabel(detail.stat) }}
              <SimulatorNumericValue
                mode="signed"
                :value="detail.value"
                :unit="efficiencyStatUnit(detail.stat)"
              />{{ efficiencyStatUnit(detail.stat) }}
            </span>
            <div
              v-if="operatorCalculationRows(detail).length"
              class="simulator-skill-detail-calculation"
            >
              <div
                v-for="(line, lineIndex) in operatorCalculationRows(detail)"
                :key="`${detailIndex}-${lineIndex}`"
                class="simulator-skill-detail-calculation-row"
              >
                <span
                  v-if="line.label"
                  class="simulator-skill-detail-calculation-label"
                >
                  {{ line.label }}
                </span>
                <span v-else aria-hidden="true"></span>
                <span>{{ line.value }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <a-empty
        v-if="!step.facility.details.length && !step.moods.length"
        :image="undefined"
        class="simulator-step-empty"
        description="当前设施没有可展开的技能明细"
      />
    </template>
    <div v-if="step.moods.length" class="simulator-step-section">
      <span class="simulator-step-subheading">干员心情消耗步骤</span>
      <div class="simulator-step-detail-grid">
        <div
          v-for="mood in step.moods"
          :key="`${mood.facilityId}-${mood.slotIndex}-${mood.operator}`"
          class="simulator-mood-detail-row"
        >
          <strong class="simulator-mood-operator">{{ mood.operator }}</strong>
          <template
            v-for="(detail, detailIndex) in mood.rateDetails"
            :key="`${mood.operator}-${detail.kind}-${detailIndex}`"
          >
            <span>{{ moodRateDetailLabel(detail) }}</span>
            <strong
              ><SimulatorNumericValue
                mode="signed"
                :value="detail.value"
                unit="/小时"
              />/小时</strong
            >
          </template>
          <span>消耗速度</span>
          <strong>{{ moodRateFormula(mood) }}</strong>
          <span>计算过程</span>
          <span>
            {{ formatNumber(mood.start) }} - {{ formatNumber(mood.costRate) }} ×
            {{ formatNumber(step.plan.durationHours) }} =
            {{ formatNumber(mood.end) }}
          </span>
          <span>剩余心情</span>
          <strong><SimulatorNumericValue :value="mood.end" /></strong>
        </div>
      </div>
    </div>
  </div>
</template>
