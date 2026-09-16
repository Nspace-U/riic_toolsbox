<script setup lang="ts">
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  SettingOutlined,
  UploadOutlined,
} from "@ant-design/icons-vue";
import { computed, ref, watch } from "vue";

import { useBaseData } from "@/composables/useBaseData";
import { useBasePointDisplaySettings } from "@/composables/useBasePointDisplaySettings";
import {
  useAvatarDisplaySizes,
  type AvatarDisplaySizeTarget,
} from "@/composables/useAvatarDisplaySizes";
import { useCalculationStepDisplaySettings } from "@/composables/useCalculationStepDisplaySettings";
import { isDataSourceId, useDataSource } from "@/composables/useDataSource";
import { useDroneStrategySettings } from "@/composables/useDroneStrategySettings";
import { useFacilityCardSettings } from "@/composables/useFacilityCardSettings";
import { useFacilityColors } from "@/composables/useFacilityColors";
import { useNumericTooltipSettings } from "@/composables/useNumericTooltipSettings";
import {
  DEFAULT_OPERATOR_PICKER_COLUMNS,
  useOperatorPickerSettings,
} from "@/composables/useOperatorPickerSettings";
import { useOperatorProgression } from "@/composables/useOperatorProgression";
import { useSanitySettings } from "@/composables/useSanitySettings";
import OperatorAvatarDisplay from "@/components/OperatorAvatarDisplay.vue";
import type { Operator } from "@/types/baseData";
import type { OperatorSkillFile } from "@/types/efficiency";
import type {
  OperatorProgressionEntry,
  OperatorProgressionNode,
} from "@/types/operatorProgression";
import type { RoomKey } from "@/types/schedule";
import type { SanitySettings } from "@/utils/sanity";
import type { LmdDroneStrategyLevel } from "@/utils/efficiency/drone";
import {
  sortBranchValues,
  sortProfessionValues,
} from "@/utils/operatorOrdering";
import { basePointTermOptions } from "@/utils/efficiency/basePoints";
import { ROOM_ORDER } from "@/utils/schedule";
import {
  fixedProgressionNodes,
  nodesForOperator,
} from "@/utils/operatorProgression";

const {
  dataSourceOptions,
  selectedDataSource,
  selectedDataSourceLabel,
  setDataSource,
} = useDataSource();
const {
  facilityColors,
  facilityLabels,
  productColors,
  productLabels,
  fiammettaColor,
  setFacilityColor,
  setProductColor,
  setFiammettaColor,
  resetFacilityColors,
} = useFacilityColors();
const { operators, terms, ready: baseDataReady } = useBaseData();
const { isBasePointVisible, setAllBasePointsVisible, setBasePointVisible } =
  useBasePointDisplaySettings();
const {
  calculationStepDisplayMode,
  calculationStepDisplayModeOptions,
  setCalculationStepDisplayMode,
  resetCalculationStepDisplayMode,
} = useCalculationStepDisplaySettings();
const {
  numericTooltipEnabled,
  setNumericTooltipEnabled,
  resetNumericTooltipSettings,
} = useNumericTooltipSettings();
const {
  avatarDisplaySizes,
  avatarDisplaySizeOptions,
  avatarDisplaySizeTargets,
  setAvatarDisplaySize,
  resetAvatarDisplaySizes,
} = useAvatarDisplaySizes();
const {
  operatorPickerColumns,
  setOperatorPickerColumns,
  resetOperatorPickerColumns,
} = useOperatorPickerSettings();
const {
  facilityCardSettings,
  facilityCardIconStyleKeys,
  facilityCardIconStyleOptions,
  setFacilityCardIconStyle,
  resetFacilityCardSettings,
} = useFacilityCardSettings();
const {
  profiles,
  activeProfileId,
  activeProfile,
  showNoEditableOperators,
  showUnownedOperators,
  treatSkillsAsUnlocked,
  dormitoryDefaultIncludesMoodRecovery,
  importProfile,
  setActiveProfile,
  updateEntry,
  ensureEntry,
  resetEntry,
  resetProfile,
  duplicateProfile,
  removeProfile,
  renameProfile,
  setShowNoEditableOperators,
  setShowUnownedOperators,
  setTreatSkillsAsUnlocked,
  setDormitoryDefaultIncludesMoodRecovery,
} = useOperatorProgression();
const { sanitySettings, sanityValues, setSanitySetting, resetSanitySettings } =
  useSanitySettings();
const { lmdDroneStrategies, setLmdDroneStrategy, resetLmdDroneStrategies } =
  useDroneStrategySettings();

const facilityColorEntries = ROOM_ORDER.map(
  (type) => [type, facilityLabels[type]] as [RoomKey, string],
);
const productColorEntries = Object.entries(productLabels) as Array<
  ["赤金" | "合成玉" | "源石碎片", string]
>;

const progressionFileInput = ref<HTMLInputElement>();
const progressionError = ref("");
const progressionSuccess = ref("");
const progressionLoading = ref(false);
const progressionSearch = ref("");
const selectedProgressionFacility = ref<RoomKey | "">("");
const selectedProgressionProfession = ref("");
const selectedProgressionBranch = ref("");
const selectedProgressionRarity = ref<number | "">("");
const renameProfileModalOpen = ref(false);
const renameProfileName = ref("");
const clearLocalDataModalOpen = ref(false);
const clearLocalDataError = ref("");
const skillFiles = ref<Record<string, OperatorSkillFile | undefined>>({});
let skillFileRequestVersion = 0;

const basePointDisplayOptions = computed(() =>
  basePointTermOptions(terms.value),
);

const progressionFacilityOptions = ROOM_ORDER.map((value) => ({
  value,
  label: facilityLabels[value],
}));
const progressionRarityOptions = [1, 2, 3, 4, 5, 6].map((value) => ({
  value,
  label: `${value} 星`,
}));
const progressionProfessionOptions = computed(() =>
  sortProfessionValues(
    operators.value.map((operator) => operator.profession).filter(Boolean),
  ).map((value) => ({ value, label: value })),
);
const progressionBranchOptions = computed(() => {
  const branches = operators.value
    .filter(
      (operator) =>
        !selectedProgressionProfession.value ||
        operator.profession === selectedProgressionProfession.value,
    )
    .map((operator) => operator.branch)
    .filter(Boolean);
  return sortBranchValues(selectedProgressionProfession.value, branches).map(
    (value) => ({ value, label: value }),
  );
});
const filteredProgressionOperators = computed(() => {
  const query = progressionSearch.value.trim().toLocaleLowerCase();
  return operators.value
    .filter((operator) => {
      const nodes = progressionNodes(operator);
      const entry = progressionEntry(operator);
      const hasEditableNodes = nodes.length > 0;
      return (
        (showNoEditableOperators.value || hasEditableNodes) &&
        (showUnownedOperators.value || entry?.owned === true) &&
        (!selectedProgressionFacility.value ||
          nodes.some((node) =>
            node.facilities.includes(
              selectedProgressionFacility.value as RoomKey,
            ),
          )) &&
        (!selectedProgressionProfession.value ||
          operator.profession === selectedProgressionProfession.value) &&
        (!selectedProgressionBranch.value ||
          operator.branch === selectedProgressionBranch.value) &&
        (!selectedProgressionRarity.value ||
          operator.rarity === selectedProgressionRarity.value) &&
        (!query ||
          `${operator.name} ${operator.id}`.toLocaleLowerCase().includes(query))
      );
    })
    .map((operator, index) => ({ operator, index }))
    .sort((left, right) => {
      const leftOrder = left.operator.implementationOrder;
      const rightOrder = right.operator.implementationOrder;
      if (leftOrder === undefined || rightOrder === undefined) {
        if (leftOrder === undefined && rightOrder === undefined) {
          return left.index - right.index;
        }
        return leftOrder === undefined ? -1 : 1;
      }
      return rightOrder - leftOrder || left.index - right.index;
    })
    .map(({ operator }) => operator);
});

function progressionEntry(
  operator: Operator,
): OperatorProgressionEntry | undefined {
  return (
    activeProfile.value?.entries[operator.id] ?? {
      id: operator.id,
      name: operator.name,
      elite: 0,
      level: 0,
      owned: false,
      rarity: operator.rarity,
    }
  );
}

function progressionNodes(operator: Operator): OperatorProgressionNode[] {
  return nodesForOperator(skillFiles.value[operator.id]);
}

function nodeIsCurrent(
  operator: Operator,
  node: OperatorProgressionNode,
): boolean {
  const entry = progressionEntry(operator);
  return (
    entry?.owned === true &&
    (node.type === "elite"
      ? entry.elite === node.value
      : entry.level === node.value)
  );
}

function nodeFacilities(node: OperatorProgressionNode): string {
  return node.facilities.length
    ? node.facilities.map((facility) => facilityLabels[facility]).join("、")
    : "按干员稀有度提供的固定练度档位";
}

function updateProgressionNode(
  operator: Operator,
  node: OperatorProgressionNode,
): void {
  const profile = activeProfile.value;
  if (!profile) {
    return;
  }
  updateEntry(profile.id, operator.id, (entry) => {
    const isCurrent =
      entry.owned &&
      (node.type === "elite"
        ? entry.elite === node.value
        : entry.level === node.value);
    if (isCurrent) {
      entry.owned = false;
      return;
    }
    if (node.type === "elite") {
      entry.elite = node.value as 0 | 1 | 2;
      entry.level = 1;
    } else {
      if (operator.rarity <= 2) {
        entry.elite = 0;
      }
      entry.level = node.value;
    }
    entry.owned = true;
  });
}

function resetProgressionEntry(operator: Operator): void {
  if (activeProfile.value) {
    resetEntry(activeProfile.value.id, operator.id);
  }
}

function resetAllProgressionEntries(): void {
  const profile = activeProfile.value;
  if (!profile || !window.confirm("确定将所有干员重置为导入时状态吗？")) {
    return;
  }
  resetProfile(profile.id);
  progressionSuccess.value = "已将所有干员重置为导入时状态。";
}

function progressionAvatarElite(operator: Operator): 0 | 1 | 2 {
  const entry = progressionEntry(operator);
  return entry?.owned ? entry.elite : 0;
}

function progressionCurrentLabel(operator: Operator): string {
  const entry = progressionEntry(operator);
  return entry?.owned ? `精英${entry.elite} · ${entry.level}级` : "—";
}

function facilityFilterStyle(
  type: RoomKey,
  selected: boolean,
): Record<string, string> {
  const color = facilityColors.value[type];
  return {
    "--facility-filter-color": color,
    "background-color": selected ? color : `${color}1a`,
    color: selected ? "#ffffff" : "#344447",
  };
}

function openProgressionFilePicker(): void {
  progressionFileInput.value?.click();
}

async function handleProgressionFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) {
    return;
  }
  progressionError.value = "";
  progressionSuccess.value = "";
  try {
    importProfile(JSON.parse(await file.text()) as unknown, file.name);
    progressionSuccess.value = `已导入练度档案“${file.name.replace(/\.json$/i, "")}”。`;
  } catch (error: unknown) {
    progressionError.value =
      error instanceof Error ? error.message : "练度 JSON 导入失败";
  }
}

function handleDuplicateProfile(): void {
  if (!activeProfile.value) {
    return;
  }
  duplicateProfile(activeProfile.value.id);
  progressionSuccess.value = "已复制当前练度档案。";
}

function openRenameProfile(): void {
  if (!activeProfile.value) {
    return;
  }
  renameProfileName.value = activeProfile.value.name;
  renameProfileModalOpen.value = true;
}

function handleRenameProfile(): void {
  const profile = activeProfile.value;
  if (!profile) {
    renameProfileModalOpen.value = false;
    return;
  }
  renameProfile(profile.id, renameProfileName.value);
  renameProfileModalOpen.value = false;
  progressionSuccess.value = `已修改练度档案名称为“${profile.name}”。`;
}

function handleRemoveProfile(): void {
  if (!activeProfile.value) {
    return;
  }
  if (!window.confirm(`确定删除“${activeProfile.value.name}”吗？`)) {
    return;
  }
  removeProfile(activeProfile.value.id);
  progressionSuccess.value = "已删除练度档案。";
}

async function refreshProgressionSkillFiles(): Promise<void> {
  const requestVersion = ++skillFileRequestVersion;
  if (!baseDataReady.value || selectedDataSource.value !== "torappu") {
    skillFiles.value = {};
    progressionLoading.value = false;
    return;
  }
  progressionLoading.value = true;
  try {
    const response = await Promise.all(
      operators.value.map(async (operator) => {
        try {
          const result = await fetch(
            `${import.meta.env.BASE_URL}assets/operator-skills/${operator.id}.json`,
          );
          return [
            operator.id,
            result.ok
              ? ((await result.json()) as OperatorSkillFile)
              : undefined,
            !result.ok,
          ] as const;
        } catch {
          return [operator.id, undefined, true] as const;
        }
      }),
    );
    if (requestVersion === skillFileRequestVersion) {
      skillFiles.value = Object.fromEntries(
        response.map(([id, skillFile]) => [id, skillFile]),
      );
      if (activeProfile.value) {
        operators.value.forEach((operator) => {
          ensureEntry(activeProfile.value!.id, {
            id: operator.id,
            name: operator.name,
            elite: 0,
            level: 0,
            owned: false,
            rarity: operator.rarity,
          });
        });
      }
    }
  } finally {
    if (requestVersion === skillFileRequestVersion) {
      progressionLoading.value = false;
    }
  }
}

function handleDataSourceChange(value: string): void {
  if (isDataSourceId(value)) {
    setDataSource(value);
  }
}

function openClearLocalDataModal(): void {
  clearLocalDataError.value = "";
  clearLocalDataModalOpen.value = true;
}

function handleClearLocalData(): void {
  try {
    window.localStorage.clear();
    window.location.reload();
  } catch {
    clearLocalDataModalOpen.value = false;
    clearLocalDataError.value =
      "清除本地数据失败，请检查浏览器存储权限后重试。";
  }
}

function handleAvatarDisplaySizeChange(
  target: AvatarDisplaySizeTarget,
  value: number | null,
): void {
  setAvatarDisplaySize(
    target,
    value ?? avatarDisplaySizeOptions[target].defaultSize,
  );
}

function handleOperatorPickerColumnsChange(value: number | null): void {
  setOperatorPickerColumns(value ?? DEFAULT_OPERATOR_PICKER_COLUMNS);
}

function setAllBasePointTermsVisible(visible: boolean): void {
  setAllBasePointsVisible(
    basePointDisplayOptions.value.map((option) => option.key),
    visible,
  );
}

function handleSanitySettingChange(
  key: keyof SanitySettings,
  value: number | null,
): void {
  setSanitySetting(key, value);
}

function updateLmd(value: number | null): void {
  handleSanitySettingChange("lmd", value);
}

function updateGoldExperienceRatio(value: number | null): void {
  handleSanitySettingChange("goldExperienceRatio", value);
}

function updateOrundum(value: number | null): void {
  handleSanitySettingChange("orundum", value);
}

function updateCredit(value: number | null): void {
  handleSanitySettingChange("credit", value);
}

function updateRecruitRefresh(value: number | null): void {
  handleSanitySettingChange("recruitRefresh", value);
}

function updateSolidRock(value: number | null): void {
  handleSanitySettingChange("solidRock", value);
}

function updateDevice(value: number | null): void {
  handleSanitySettingChange("device", value);
}

function updateLmdDroneStrategy(
  level: LmdDroneStrategyLevel,
  value: string,
): void {
  setLmdDroneStrategy(level, value);
}

function formatSanityValue(value: number | null): string {
  return value === null
    ? "未设置"
    : value.toLocaleString("zh-CN", { maximumFractionDigits: 8 });
}

const sanityDisplayRows = computed(() => [
  {
    label: "龙门币",
    value: sanityValues.value.lmd,
    unit: "理智/龙门币",
    source: "可修改",
  },
  {
    label: "钱书价值比",
    value: sanityValues.value.goldExperienceRatio,
    unit: "龙门币价值 / 经验价值",
    source: "可修改",
  },
  {
    label: "赤金点数",
    value: sanityValues.value.pureGoldPoint,
    unit: "理智/赤金点数",
    source: "按当前基础时间计算",
  },
  {
    label: "作战记录（经验）",
    value: sanityValues.value.experience,
    unit: "理智/经验",
    source: "按当前基础时间计算",
  },
  {
    label: "无人机",
    value: sanityValues.value.drone,
    unit: "理智/无人机",
    source: "按当前基础时间计算",
  },
  {
    label: "信用",
    value: sanityValues.value.credit,
    unit: "理智/信用",
    source: "可修改",
  },
  {
    label: "公开招募标签刷新次数",
    value: sanityValues.value.recruitRefresh,
    unit: "理智/次",
    source: "可修改",
  },
  {
    label: "源石碎片",
    value: sanityValues.value.originiumShard,
    unit: "理智/源石碎片",
    source: "按开采协力订单反推",
  },
  {
    label: "固源岩",
    value: sanityValues.value.solidRock,
    unit: "理智/固源岩",
    source: "用户填写",
  },
  {
    label: "装置",
    value: sanityValues.value.device,
    unit: "理智/装置",
    source: "用户填写",
  },
]);

watch(selectedProgressionProfession, () => {
  selectedProgressionBranch.value = "";
});
watch(
  [baseDataReady, selectedDataSource],
  () => {
    void refreshProgressionSkillFiles();
  },
  { immediate: true },
);
</script>

<template>
  <div class="page-shell settings-page">
    <div class="page-heading">
      <div class="page-heading-icon" aria-hidden="true">
        <SettingOutlined />
      </div>
      <a-typography-title :level="2" class="page-title"
        >通用设置</a-typography-title
      >
    </div>

    <a-card :bordered="false" class="settings-panel" title="数据源设置">
      <a-form layout="vertical">
        <a-form-item label="数据源">
          <a-select
            :value="selectedDataSource"
            :options="dataSourceOptions"
            class="data-source-select"
            @change="handleDataSourceChange"
          />
        </a-form-item>
      </a-form>

      <div class="setting-current">
        <span>当前数据源</span>
        <strong>{{ selectedDataSourceLabel }}</strong>
      </div>
    </a-card>

    <a-card
      :bordered="false"
      class="settings-panel settings-drone-strategy-panel"
      title="无人机加速贸易站策略"
    >
      <p class="settings-panel-description">
        排班表未设置专用策略时，按布局中最低贸易站等级自动选择。
      </p>
      <a-form layout="vertical" class="settings-sanity-form">
        <a-form-item label="1级贸易站策略">
          <a-input
            :value="lmdDroneStrategies[1]"
            @update:value="(value: string) => updateLmdDroneStrategy(1, value)"
          />
        </a-form-item>
        <a-form-item label="2级贸易站策略">
          <a-input
            :value="lmdDroneStrategies[2]"
            @update:value="(value: string) => updateLmdDroneStrategy(2, value)"
          />
        </a-form-item>
        <a-form-item label="3级贸易站策略">
          <a-input
            :value="lmdDroneStrategies[3]"
            @update:value="(value: string) => updateLmdDroneStrategy(3, value)"
          />
        </a-form-item>
      </a-form>
      <a-button @click="resetLmdDroneStrategies">恢复默认策略</a-button>
    </a-card>

    <a-card
      :bordered="false"
      class="settings-panel settings-base-point-panel"
      title="基地点数显示"
    >
      <p class="settings-panel-description">
        选择排班模拟器计算结果中需要显示的基地点数，设置仅影响显示，不改变计算结果。
      </p>
      <a-space :size="6" wrap>
        <a-button size="small" @click="setAllBasePointTermsVisible(true)">
          全选显示
        </a-button>
        <a-button size="small" @click="setAllBasePointTermsVisible(false)">
          全部隐藏
        </a-button>
      </a-space>
      <div
        v-if="basePointDisplayOptions.length"
        class="settings-base-point-options"
      >
        <a-checkbox
          v-for="option in basePointDisplayOptions"
          :key="option.key"
          :checked="isBasePointVisible(option.key)"
          @change="
            (event: { target: { checked: boolean } }) =>
              setBasePointVisible(option.key, event.target.checked)
          "
        >
          {{ option.name }}
        </a-checkbox>
      </div>
      <a-empty
        v-else
        :image="undefined"
        description="当前数据源没有可用的基地点数"
      />
    </a-card>

    <a-card
      :bordered="false"
      class="settings-panel settings-calculation-step-panel"
      title="计算步骤"
    >
      <p class="settings-panel-description">
        设置排班模拟器计算步骤的展开方式，修改后立即作用于所有排班表并保存在当前浏览器。
      </p>
      <a-form layout="vertical">
        <a-form-item label="展开方式">
          <a-radio-group
            :value="calculationStepDisplayMode"
            button-style="solid"
            option-type="button"
            @change="
              (event: { target: { value: unknown } }) =>
                setCalculationStepDisplayMode(event.target.value)
            "
          >
            <a-radio-button
              v-for="(option, key) in calculationStepDisplayModeOptions"
              :key="key"
              :value="key"
            >
              {{ option.label }}
            </a-radio-button>
          </a-radio-group>
          <p class="settings-panel-hint">
            {{
              calculationStepDisplayModeOptions[calculationStepDisplayMode]
                .description
            }}
          </p>
        </a-form-item>
        <a-form-item label="数值原始精度">
          <a-checkbox
            :checked="numericTooltipEnabled"
            @change="
              (event: { target: { checked: boolean } }) =>
                setNumericTooltipEnabled(event.target.checked)
            "
          >
            鼠标悬停显示被舍入前的数值
          </a-checkbox>
          <p class="settings-panel-hint">
            仅在页面数值因显示精度限制发生变化时显示，使用默认悬停延迟。
          </p>
        </a-form-item>
      </a-form>
      <a-space>
        <a-button @click="resetCalculationStepDisplayMode"
          >恢复默认展开方式</a-button
        >
        <a-button @click="resetNumericTooltipSettings"
          >恢复默认数值显示</a-button
        >
      </a-space>
    </a-card>

    <a-card
      :bordered="false"
      class="settings-panel settings-sanity-panel"
      title="理智计算"
    >
      <p class="settings-panel-description">
        设置资源的理智价值。赤金和作战记录按当前效率计算中的基础时间推导，无人机固定按每个加速
        3 分钟基础时间计算。
      </p>
      <a-form layout="vertical" class="settings-sanity-form">
        <a-form-item extra="每 1 龙门币" label="龙门币理智">
          <a-input-number
            :min="0"
            :step="0.0001"
            :value="sanitySettings.lmd"
            @update:value="updateLmd"
          />
        </a-form-item>
        <a-form-item extra="龙门币价值 ÷ 经验价值" label="钱书价值比">
          <a-input-number
            :min="0"
            :step="0.01"
            :value="sanitySettings.goldExperienceRatio"
            @update:value="updateGoldExperienceRatio"
          />
        </a-form-item>
        <a-form-item extra="用于反推源石碎片价值" label="合成玉理智">
          <a-input-number
            :min="0"
            :step="0.01"
            :value="sanitySettings.orundum"
            @update:value="updateOrundum"
          />
        </a-form-item>
        <a-form-item extra="每 1 信用，线索产出已并入信用" label="信用理智">
          <a-input-number
            :min="0"
            :step="0.0001"
            :value="sanitySettings.credit"
            @update:value="updateCredit"
          />
        </a-form-item>
        <a-form-item extra="每 1 次刷新" label="公开招募标签刷新次数理智">
          <a-input-number
            :min="0"
            :step="0.01"
            :value="sanitySettings.recruitRefresh"
            @update:value="updateRecruitRefresh"
          />
        </a-form-item>
        <a-form-item
          extra="不填写时，相关总理智显示为不完整"
          label="固源岩理智"
        >
          <a-input-number
            :min="0"
            placeholder="未设置"
            :step="0.01"
            :value="sanitySettings.solidRock"
            @update:value="updateSolidRock"
          />
        </a-form-item>
        <a-form-item extra="不填写时，相关总理智显示为不完整" label="装置理智">
          <a-input-number
            :min="0"
            placeholder="未设置"
            :step="0.01"
            :value="sanitySettings.device"
            @update:value="updateDevice"
          />
        </a-form-item>
      </a-form>
      <div class="settings-sanity-values">
        <div
          v-for="row in sanityDisplayRows"
          :key="row.label"
          class="settings-sanity-value"
        >
          <span>{{ row.label }}</span>
          <strong>{{ formatSanityValue(row.value) }}</strong>
          <small>{{ row.unit }} · {{ row.source }}</small>
        </div>
      </div>
      <a-button @click="resetSanitySettings">恢复默认理智设置</a-button>
    </a-card>

    <a-card
      :bordered="false"
      class="settings-panel settings-progression-panel"
      title="干员练度"
    >
      <template #extra>
        <a-space :size="6">
          <a-button size="small" @click="openProgressionFilePicker">
            <template #icon><UploadOutlined /></template>
            导入
          </a-button>
          <input
            ref="progressionFileInput"
            accept=".json,application/json"
            hidden
            type="file"
            @change="handleProgressionFileChange"
          />
        </a-space>
      </template>
      <a-alert
        v-if="progressionError"
        :message="progressionError"
        closable
        show-icon
        type="error"
        @close="progressionError = ''"
      />
      <a-alert
        v-if="progressionSuccess"
        :message="progressionSuccess"
        class="settings-progression-alert"
        closable
        show-icon
        type="success"
        @close="progressionSuccess = ''"
      />
      <p class="settings-panel-description">
        导入干员练度后，可按干员稀有度提供的固定档位设置干员状态；列表筛选仍依据基建技能节点。未选择档案时，排班模拟器会使用设施默认练度。
      </p>
      <div class="settings-progression-toolbar">
        <a-select
          :options="[
            { value: '', label: '未选择练度档案' },
            ...profiles.map((profile) => ({
              value: profile.id,
              label: profile.name,
            })),
          ]"
          :value="activeProfileId"
          class="settings-progression-profile-select"
          @update:value="(value: string) => setActiveProfile(value)"
        />
        <a-space v-if="activeProfile" :size="6" wrap>
          <a-button size="small" @click="resetAllProgressionEntries">
            <template #icon><ReloadOutlined /></template>
            全部重置
          </a-button>
          <a-button size="small" @click="handleDuplicateProfile">
            <template #icon><CopyOutlined /></template>
            复制
          </a-button>
          <a-button size="small" @click="openRenameProfile">
            <template #icon><EditOutlined /></template>
            改名
          </a-button>
          <a-button danger size="small" @click="handleRemoveProfile">
            <template #icon><DeleteOutlined /></template>
            删除
          </a-button>
        </a-space>
      </div>
      <div class="settings-progression-options">
        <a-checkbox
          :checked="treatSkillsAsUnlocked"
          @change="
            (event: { target: { checked: boolean } }) =>
              setTreatSkillsAsUnlocked(event.target.checked)
          "
        >
          基建技能视为已解锁
        </a-checkbox>
        <a-checkbox
          :checked="dormitoryDefaultIncludesMoodRecovery"
          @change="
            (event: { target: { checked: boolean } }) =>
              setDormitoryDefaultIncludesMoodRecovery(event.target.checked)
          "
        >
          宿舍默认练度包含心情回复技能
        </a-checkbox>
        <a-checkbox
          :checked="showNoEditableOperators"
          @change="
            (event: { target: { checked: boolean } }) =>
              setShowNoEditableOperators(event.target.checked)
          "
        >
          显示无可用技能干员
        </a-checkbox>
        <a-checkbox
          :checked="showUnownedOperators"
          @change="
            (event: { target: { checked: boolean } }) =>
              setShowUnownedOperators(event.target.checked)
          "
        >
          显示未拥有干员
        </a-checkbox>
      </div>
      <template v-if="activeProfile">
        <div class="settings-progression-filters">
          <a-input
            v-model:value="progressionSearch"
            allow-clear
            placeholder="搜索干员名称"
          />
        </div>
        <div class="settings-progression-filter-groups">
          <div class="settings-progression-filter-group">
            <span class="settings-progression-filter-label">设施</span>
            <div class="settings-progression-filter-options">
              <a-button
                :type="!selectedProgressionFacility ? 'primary' : 'default'"
                @click="selectedProgressionFacility = ''"
              >
                全部
              </a-button>
              <a-button
                v-for="option in progressionFacilityOptions"
                :key="option.value"
                class="settings-progression-facility-filter-button"
                :class="{
                  'settings-progression-filter-button--selected':
                    selectedProgressionFacility === option.value,
                }"
                type="default"
                :style="
                  facilityFilterStyle(
                    option.value,
                    selectedProgressionFacility === option.value,
                  )
                "
                @click="selectedProgressionFacility = option.value"
              >
                {{ option.label }}
              </a-button>
            </div>
          </div>
          <div class="settings-progression-filter-group">
            <span class="settings-progression-filter-label">职业</span>
            <div class="settings-progression-filter-options">
              <a-button
                :type="!selectedProgressionProfession ? 'primary' : 'default'"
                @click="selectedProgressionProfession = ''"
              >
                全部
              </a-button>
              <a-button
                v-for="option in progressionProfessionOptions"
                :key="option.value"
                :type="
                  selectedProgressionProfession === option.value
                    ? 'primary'
                    : 'default'
                "
                @click="selectedProgressionProfession = option.value"
              >
                {{ option.label }}
              </a-button>
            </div>
          </div>
          <div
            v-if="selectedProgressionProfession"
            class="settings-progression-filter-group"
          >
            <span class="settings-progression-filter-label">分支</span>
            <div class="settings-progression-filter-options">
              <a-button
                :type="!selectedProgressionBranch ? 'primary' : 'default'"
                @click="selectedProgressionBranch = ''"
              >
                全部
              </a-button>
              <a-button
                v-for="option in progressionBranchOptions"
                :key="option.value"
                :type="
                  selectedProgressionBranch === option.value
                    ? 'primary'
                    : 'default'
                "
                @click="selectedProgressionBranch = option.value"
              >
                {{ option.label }}
              </a-button>
            </div>
          </div>
          <div class="settings-progression-filter-group">
            <span class="settings-progression-filter-label">稀有度</span>
            <div class="settings-progression-filter-options">
              <a-button
                :type="!selectedProgressionRarity ? 'primary' : 'default'"
                @click="selectedProgressionRarity = ''"
              >
                全部
              </a-button>
              <a-button
                v-for="option in progressionRarityOptions"
                :key="option.value"
                :type="
                  selectedProgressionRarity === option.value
                    ? 'primary'
                    : 'default'
                "
                @click="selectedProgressionRarity = option.value"
              >
                {{ option.label }}
              </a-button>
            </div>
          </div>
        </div>
        <a-spin :spinning="progressionLoading">
          <div class="settings-progression-list">
            <a-card
              v-for="operator in filteredProgressionOperators"
              :key="operator.id"
              :bordered="false"
              class="settings-progression-item"
            >
              <div class="settings-progression-item-heading">
                <OperatorAvatarDisplay
                  :data-source="selectedDataSource"
                  :elite-level="progressionAvatarElite(operator)"
                  :operator-owned="progressionEntry(operator)?.owned === true"
                  :operator="operator"
                  :show-elite-level="true"
                  :show-name="false"
                  :show-profession="true"
                  :show-rarity="true"
                  :plain="true"
                  :proportional-layout="true"
                  :size="avatarDisplaySizes.progressionCard"
                />
                <div class="settings-progression-item-copy">
                  <strong>{{ operator.name }}</strong>
                  <span
                    >{{ operator.profession }} · {{ operator.branch }} ·
                    {{ operator.rarity }}星</span
                  >
                  <span class="settings-progression-current"
                    >当前练度：{{ progressionCurrentLabel(operator) }}</span
                  >
                </div>
              </div>
              <div class="settings-progression-node-editor-row">
                <a-button
                  :aria-label="`重置${operator.name}练度`"
                  size="small"
                  title="重置为导入时状态"
                  @click="resetProgressionEntry(operator)"
                >
                  <template #icon><ReloadOutlined /></template>
                </a-button>
                <div
                  v-if="progressionNodes(operator).length"
                  class="settings-progression-nodes"
                >
                  <a-button
                    v-for="node in fixedProgressionNodes(operator.rarity)"
                    :key="node.key"
                    :class="{
                      'settings-progression-node--current': nodeIsCurrent(
                        operator,
                        node,
                      ),
                    }"
                    :title="nodeFacilities(node)"
                    size="small"
                    @click="updateProgressionNode(operator, node)"
                  >
                    {{ node.label }}
                  </a-button>
                </div>
                <span v-else class="settings-progression-no-node"
                  >暂无可编辑的基建技能节点</span
                >
              </div>
            </a-card>
          </div>
        </a-spin>
      </template>
      <a-empty
        v-else
        :image="undefined"
        description="请先导入或选择一组练度档案"
      />
    </a-card>

    <a-modal
      v-model:open="renameProfileModalOpen"
      cancel-text="取消"
      ok-text="保存"
      title="修改练度档案名称"
      @ok="handleRenameProfile"
    >
      <a-input
        v-model:value="renameProfileName"
        autofocus
        maxlength="40"
        placeholder="请输入练度档案名称"
        @press-enter="handleRenameProfile"
      />
    </a-modal>

    <a-card
      :bordered="false"
      class="settings-panel settings-facility-colors-panel"
      title="设施背景颜色"
    >
      <p class="settings-panel-description">
        调整排班模拟器中各设施的默认背景颜色。产品专属颜色仍会优先显示。
      </p>
      <div class="facility-color-list">
        <div
          v-for="[type, label] in facilityColorEntries"
          :key="type"
          class="facility-color-item"
        >
          <div class="facility-color-name">
            <span
              :style="{ backgroundColor: facilityColors[type] }"
              class="facility-color-swatch"
            />
            <span>{{ label }}</span>
          </div>
          <div class="facility-color-controls">
            <input
              :aria-label="`${label}背景颜色`"
              :value="facilityColors[type]"
              class="facility-color-picker"
              type="color"
              @input="
                setFacilityColor(
                  type,
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
            <a-input
              :aria-label="`${label}颜色值`"
              :value="facilityColors[type]"
              class="facility-color-value"
              :maxlength="7"
              size="small"
              @change="
                setFacilityColor(
                  type,
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
          </div>
        </div>
        <div class="facility-color-item">
          <div class="facility-color-name">
            <span
              :style="{ backgroundColor: fiammettaColor }"
              class="facility-color-swatch"
            />
            <span>菲亚梅塔假设施</span>
          </div>
          <div class="facility-color-controls">
            <input
              aria-label="菲亚梅塔假设施背景颜色"
              :value="fiammettaColor"
              class="facility-color-picker"
              type="color"
              @input="
                setFiammettaColor(($event.target as HTMLInputElement).value)
              "
            />
            <a-input
              aria-label="菲亚梅塔假设施颜色值"
              :value="fiammettaColor"
              class="facility-color-value"
              :maxlength="7"
              size="small"
              @change="
                setFiammettaColor(($event.target as HTMLInputElement).value)
              "
            />
          </div>
        </div>
        <div
          v-for="[product, label] in productColorEntries"
          :key="product"
          class="facility-color-item"
        >
          <div class="facility-color-name">
            <span
              :style="{ backgroundColor: productColors[product] }"
              class="facility-color-swatch"
            />
            <span>{{ label }}</span>
          </div>
          <div class="facility-color-controls">
            <input
              :aria-label="`${label}背景颜色`"
              :value="productColors[product]"
              class="facility-color-picker"
              type="color"
              @input="
                setProductColor(
                  product,
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
            <a-input
              :aria-label="`${label}颜色值`"
              :value="productColors[product]"
              class="facility-color-value"
              :maxlength="7"
              size="small"
              @change="
                setProductColor(
                  product,
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
          </div>
        </div>
      </div>
      <a-button class="facility-color-reset" @click="resetFacilityColors"
        >恢复默认颜色</a-button
      >
    </a-card>

    <a-card
      :bordered="false"
      class="settings-panel settings-avatar-sizes-panel"
      title="头像显示尺寸"
    >
      <p class="settings-panel-description">
        调整各页面头像的显示宽度，头像与徽标按等比缩放，修改后立即生效并保存在当前浏览器。
      </p>
      <a-form layout="vertical">
        <a-form-item
          v-for="target in avatarDisplaySizeTargets"
          :key="target"
          :extra="`默认 ${avatarDisplaySizeOptions[target].defaultSize}px，可设置 ${avatarDisplaySizeOptions[target].minSize}–${avatarDisplaySizeOptions[target].maxSize}px`"
          :label="avatarDisplaySizeOptions[target].label"
        >
          <a-input-number
            :max="avatarDisplaySizeOptions[target].maxSize"
            :min="avatarDisplaySizeOptions[target].minSize"
            :value="avatarDisplaySizes[target]"
            addon-after="px"
            @update:value="
              (value: number | null) =>
                handleAvatarDisplaySizeChange(target, value)
            "
          />
        </a-form-item>
      </a-form>
      <a-button @click="resetAvatarDisplaySizes">恢复默认尺寸</a-button>
    </a-card>

    <a-card
      :bordered="false"
      class="settings-panel settings-operator-picker-panel"
      title="干员候选框"
    >
      <p class="settings-panel-description">
        调整排班模拟器干员候选框中每行显示的干员数量，修改后立即生效并保存在当前浏览器。
      </p>
      <a-form layout="vertical">
        <a-form-item
          extra="默认 4，仅支持正整数，不设上限"
          label="每行显示干员数"
        >
          <a-input-number
            :min="1"
            :precision="0"
            :step="1"
            :value="operatorPickerColumns"
            addon-after="人"
            @update:value="
              (value: number | null) => handleOperatorPickerColumnsChange(value)
            "
          />
        </a-form-item>
      </a-form>
      <a-button @click="resetOperatorPickerColumns">恢复默认人数</a-button>
    </a-card>

    <a-card
      :bordered="false"
      class="settings-panel settings-facility-card-panel"
      title="设施卡片"
    >
      <p class="settings-panel-description">
        调整排班模拟器中队列卡片背景的产物图标样式，修改后立即生效并保存在当前浏览器。
      </p>
      <a-form layout="vertical">
        <a-form-item label="卡片背景产物图标">
          <a-radio-group
            :value="facilityCardSettings.iconStyle"
            @change="
              (event: { target: { value: unknown } }) =>
                setFacilityCardIconStyle(event.target.value)
            "
          >
            <a-radio
              v-for="key in facilityCardIconStyleKeys"
              :key="key"
              :value="key"
            >
              {{ facilityCardIconStyleOptions[key].label }}
            </a-radio>
          </a-radio-group>
          <p class="settings-panel-hint">
            {{
              facilityCardIconStyleOptions[facilityCardSettings.iconStyle]
                .description
            }}
          </p>
        </a-form-item>
      </a-form>
      <a-button @click="resetFacilityCardSettings">恢复默认设置</a-button>
    </a-card>

    <a-card
      :bordered="false"
      class="settings-panel settings-data-panel"
      title="本地数据"
    >
      <a-alert
        v-if="clearLocalDataError"
        :message="clearLocalDataError"
        closable
        show-icon
        type="error"
        @close="clearLocalDataError = ''"
      />
      <p class="settings-panel-description">
        清除当前浏览器中保存的排班表、干员练度、颜色和其他应用设置。
      </p>
      <a-button danger @click="openClearLocalDataModal">
        <template #icon><DeleteOutlined /></template>
        清除本地数据
      </a-button>
    </a-card>

    <a-modal
      v-model:open="clearLocalDataModalOpen"
      cancel-text="取消"
      ok-text="清除数据"
      ok-type="danger"
      title="确认清除本地数据"
      @ok="handleClearLocalData"
    >
      <p>
        这将删除本应用保存在当前浏览器中的全部数据，且无法撤销。确定继续吗？
      </p>
    </a-modal>
  </div>
</template>
