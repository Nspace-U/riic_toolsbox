<script setup lang="ts">
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  UploadOutlined,
} from "@ant-design/icons-vue";
import { computed, ref, watch } from "vue";

import { useBaseData } from "@/composables/useBaseData";
import { useBasePointDisplaySettings } from "@/composables/useBasePointDisplaySettings";
import { useCalculationStepDisplaySettings } from "@/composables/useCalculationStepDisplaySettings";
import { useDroneStrategySettings } from "@/composables/useDroneStrategySettings";
import { useEfficiencyNoticeDisplaySettings } from "@/composables/useEfficiencyNoticeDisplaySettings";
import { useFacilityCardSettings } from "@/composables/useFacilityCardSettings";
import { useFacilityColors } from "@/composables/useFacilityColors";
import { useNumericTooltipSettings } from "@/composables/useNumericTooltipSettings";
import { useResultResourceDisplaySettings } from "@/composables/useResultResourceDisplaySettings";
import {
  DEFAULT_OPERATOR_PICKER_COLUMNS,
  useOperatorPickerSettings,
} from "@/composables/useOperatorPickerSettings";
import { useOperatorProgression } from "@/composables/useOperatorProgression";
import { useSanitySettings } from "@/composables/useSanitySettings";
import {
  buildRecycleRules,
  getRiicEfficiencyCatalog,
  getRiicEfficiencyOperatorSkillFile,
} from "@/adapters/riicEfficiencyData";
import OperatorAvatarDisplay from "@/components/OperatorAvatarDisplay.vue";
import type { Operator } from "@/types/baseData";
import type { TorappuItem } from "@/types/torappu";
import {
  EFFICIENCY_NOTICE_DISPLAY_OPTIONS,
  basePointTermOptions,
  fixedProgressionNodes,
  nodesForOperator,
  type OperatorProgressionEntry,
  type OperatorProgressionNode,
} from "@arknights/riic-efficiency";
import type { EfficiencyNoticeLevel } from "@arknights/riic-efficiency";
import type { RoomKey } from "@/types/schedule";
import type { SanitySettings } from "@/utils/sanity";
import type { LmdDroneStrategyLevel } from "@arknights/riic-efficiency";
import {
  sortBranchValues,
  sortProfessionValues,
} from "@/utils/operatorOrdering";
import { ROOM_ORDER } from "@/utils/schedule";

const {
  facilityColors,
  facilityLabels,
  productColors,
  productLabels,
  fiammettaColor,
  setFacilityColor,
  setProductColor,
  setFiammettaColor,
  resetFacilityColor,
  resetProductColor,
  resetFiammettaColor,
} = useFacilityColors();
const {
  operators,
  operatorIdAliases,
  itemTable,
  buildingData,
  ready: baseDataReady,
} = useBaseData();
const recycleRules = computed(() =>
  buildRecycleRules(buildingData.value, itemTable.value),
);
const { isBasePointVisible, setBasePointVisible, setAllBasePointsVisible } =
  useBasePointDisplaySettings();
const {
  isEfficiencyNoticeVisible,
  setEfficiencyNoticeVisible,
  setEfficiencyNoticesVisible,
  setAllEfficiencyNoticesVisible,
} = useEfficiencyNoticeDisplaySettings();
const {
  calculationStepDisplayMode,
  calculationStepDisplayModeOptions,
  showAutomaticRestOperators,
  setCalculationStepDisplayMode,
  setShowAutomaticRestOperators,
  resetCalculationStepDisplayMode,
} = useCalculationStepDisplaySettings();
const {
  resultResourceDisplayMode,
  resultResourceDisplayModeOptions,
  setResultResourceDisplayMode,
  resetResultResourceDisplayMode,
} = useResultResourceDisplaySettings();
const {
  numericTooltipEnabled,
  setNumericTooltipEnabled,
  resetNumericTooltipSettings,
} = useNumericTooltipSettings();
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
  showUnownedOperatorsInPicker,
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
  setShowUnownedOperatorsInPicker,
  setTreatSkillsAsUnlocked,
  setDormitoryDefaultIncludesMoodRecovery,
} = useOperatorProgression();
const {
  materialItems,
  sanitySettings,
  sanityValues,
  sanityMaterialValue,
  setSanitySetting,
  resetSanitySetting,
  setSanityMaterialSetting,
  resetSanityMaterialSetting,
} = useSanitySettings(itemTable, recycleRules);
const {
  lmdDroneStrategies,
  droneOverflowTruncationEnabled,
  setLmdDroneStrategy,
  resetLmdDroneStrategy,
  setDroneOverflowTruncationEnabled,
} = useDroneStrategySettings();

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
const pendingResetProfileId = ref<string>();
const pendingDeleteProfile = ref<{ id: string; name: string }>();
const progressionSearch = ref("");
const selectedProgressionFacility = ref<RoomKey | "">("");
const sanityMaterialSearch = ref("");
const selectedSanityMaterialRarities = ref<number[]>([]);
const sanityMaterialPanelKeys = ref<string[]>([]);
const sanityMaterialDrafts = ref<Record<string, number | null>>({});
const selectedProgressionProfession = ref("");
const selectedProgressionBranch = ref("");
const selectedProgressionRarity = ref<number | "">("");
const renameProfileModalOpen = ref(false);
const renameProfileName = ref("");
const clearLocalDataModalOpen = ref(false);
const clearLocalDataError = ref("");
const basePointDisplayOptions = computed(() =>
  basePointTermOptions(getRiicEfficiencyCatalog().terms),
);
const visibleBasePointTermCount = computed(
  () =>
    basePointDisplayOptions.value.filter((option) =>
      isBasePointVisible(option.key),
    ).length,
);
const visibleEfficiencyNoticeCount = computed(
  () =>
    EFFICIENCY_NOTICE_DISPLAY_OPTIONS.filter((option) =>
      isEfficiencyNoticeVisible(option.code),
    ).length,
);
const efficiencyNoticeDisplayLevels: Array<{
  level: EfficiencyNoticeLevel;
  label: string;
}> = [
  { level: "error", label: "Error" },
  { level: "warning", label: "Warning" },
  { level: "info", label: "Info" },
];
const efficiencyNoticeDisplayGroups = computed(() =>
  efficiencyNoticeDisplayLevels.map(({ level, label }) => {
    const options = EFFICIENCY_NOTICE_DISPLAY_OPTIONS.filter(
      (option) => option.level === level,
    );
    return {
      level,
      label,
      options,
      visibleCount: options.filter((option) =>
        isEfficiencyNoticeVisible(option.code),
      ).length,
    };
  }),
);
const deleteProfileConfirmationTitle = computed(() =>
  pendingDeleteProfile.value
    ? `确定删除“${pendingDeleteProfile.value.name}”吗？`
    : "确定删除当前练度档案吗？",
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
    }
  );
}

function progressionNodes(operator: Operator): OperatorProgressionNode[] {
  return nodesForOperator(getRiicEfficiencyOperatorSkillFile(operator.id));
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

function prepareResetAllProgressionEntries(profileId: string): void {
  pendingResetProfileId.value = profileId;
}

function cancelResetAllProgressionEntries(): void {
  pendingResetProfileId.value = undefined;
}

function resetAllProgressionEntries(): void {
  const profileId = pendingResetProfileId.value;
  pendingResetProfileId.value = undefined;
  if (
    !profileId ||
    !profiles.value.some((profile) => profile.id === profileId)
  ) {
    return;
  }
  resetProfile(profileId);
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
    importProfile(
      JSON.parse(await file.text()) as unknown,
      file.name,
      operatorIdAliases.value,
    );
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

function prepareRemoveProfile(profileId: string, profileName: string): void {
  pendingDeleteProfile.value = { id: profileId, name: profileName };
}

function cancelRemoveProfile(): void {
  pendingDeleteProfile.value = undefined;
}

function handleRemoveProfile(): void {
  const profile = pendingDeleteProfile.value;
  pendingDeleteProfile.value = undefined;
  if (!profile || !profiles.value.some((item) => item.id === profile.id)) {
    return;
  }
  removeProfile(profile.id);
  progressionSuccess.value = "已删除练度档案。";
}

function refreshProgressionSkillFiles(): void {
  if (!baseDataReady.value) {
    progressionLoading.value = false;
    return;
  }
  progressionLoading.value = true;
  try {
    if (activeProfile.value) {
      operators.value.forEach((operator) => {
        ensureEntry(activeProfile.value!.id, {
          id: operator.id,
          name: operator.name,
          elite: 0,
          level: 0,
          owned: false,
        });
      });
    }
  } finally {
    progressionLoading.value = false;
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

function handleOperatorPickerColumnsChange(value: number | null): void {
  setOperatorPickerColumns(value ?? DEFAULT_OPERATOR_PICKER_COLUMNS);
}

function setAllBasePointTermsVisible(visible: boolean): void {
  setAllBasePointsVisible(
    basePointTermOptions(getRiicEfficiencyCatalog().terms).map(
      (option) => option.key,
    ),
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

function sanityMaterialRarity(item: TorappuItem): number {
  return Number(item.rarity?.match(/\d+/)?.[0] ?? 0);
}

function compareSanityMaterials(left: TorappuItem, right: TorappuItem): number {
  const rarityDifference =
    sanityMaterialRarity(right) - sanityMaterialRarity(left);
  if (rarityDifference !== 0) {
    return rarityDifference;
  }

  const leftValue = sanityMaterialValue(left.itemId);
  const rightValue = sanityMaterialValue(right.itemId);
  if (leftValue === null && rightValue !== null) {
    return 1;
  }
  if (leftValue !== null && rightValue === null) {
    return -1;
  }
  if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
    return rightValue - leftValue;
  }

  return right.itemId.localeCompare(left.itemId, "en", { numeric: true });
}

function sanityMaterialIconUrl(item: TorappuItem): string {
  return `${import.meta.env.BASE_URL}assets/${item.localIconPath}`;
}

const sanityMaterialRarityOptions = computed(() =>
  [...new Set(materialItems.value.map(sanityMaterialRarity))]
    .sort((left, right) => right - left)
    .map((rarity) => ({ label: `${rarity}星`, value: rarity })),
);

const sanityMaterialRows = computed(() => {
  const search = sanityMaterialSearch.value.trim().toLocaleLowerCase("zh-CN");
  const selectedRarities = new Set(selectedSanityMaterialRarities.value);
  return [...materialItems.value]
    .filter((item) => {
      const matchesName = item.name.toLocaleLowerCase("zh-CN").includes(search);
      const matchesRarity =
        selectedRarities.size === 0 ||
        selectedRarities.has(sanityMaterialRarity(item));
      return matchesName && matchesRarity;
    })
    .sort(compareSanityMaterials);
});

function updateSanityMaterial(itemId: string, value: number | null): void {
  sanityMaterialDrafts.value = {
    ...sanityMaterialDrafts.value,
    [itemId]: value,
  };
}

function sanityMaterialInputValue(itemId: string): number | null {
  return Object.hasOwn(sanityMaterialDrafts.value, itemId)
    ? (sanityMaterialDrafts.value[itemId] ?? null)
    : sanityMaterialValue(itemId);
}

function commitSanityMaterial(itemId: string): void {
  if (!Object.hasOwn(sanityMaterialDrafts.value, itemId)) {
    return;
  }
  const value = sanityMaterialDrafts.value[itemId] ?? null;
  const drafts = { ...sanityMaterialDrafts.value };
  delete drafts[itemId];
  sanityMaterialDrafts.value = drafts;
  setSanityMaterialSetting(itemId, value);
}

function resetSanityMaterial(itemId: string): void {
  const drafts = { ...sanityMaterialDrafts.value };
  delete drafts[itemId];
  sanityMaterialDrafts.value = drafts;
  resetSanityMaterialSetting(itemId);
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
    label: "中级作战记录（经验）",
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
    label: "回收站每次产出道具",
    value: sanityValues.value.recycleItemSanity,
    unit: "理智/件",
    source:
      sanitySettings.value.recycleItemSanity === undefined
        ? "按产出池概率加权"
        : "可修改",
  },
  {
    label: "源石碎片",
    value: sanityValues.value.originiumShard,
    unit: "理智/源石碎片",
    source: "按开采协力订单反推",
  },
]);

watch(selectedProgressionProfession, () => {
  selectedProgressionBranch.value = "";
});
watch(
  baseDataReady,
  () => {
    refreshProgressionSkillFiles();
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
          <a-popconfirm
            cancel-text="取消"
            ok-text="确认重置"
            title="确定将所有干员重置为导入时状态吗？"
            @cancel="cancelResetAllProgressionEntries"
            @confirm="resetAllProgressionEntries"
          >
            <a-button
              size="small"
              @click="prepareResetAllProgressionEntries(activeProfile.id)"
            >
              <template #icon><ReloadOutlined /></template>
              全部重置
            </a-button>
          </a-popconfirm>
          <a-button size="small" @click="handleDuplicateProfile">
            <template #icon><CopyOutlined /></template>
            复制
          </a-button>
          <a-button size="small" @click="openRenameProfile">
            <template #icon><EditOutlined /></template>
            改名
          </a-button>
          <a-popconfirm
            :title="deleteProfileConfirmationTitle"
            cancel-text="取消"
            ok-text="删除"
            @cancel="cancelRemoveProfile"
            @confirm="handleRemoveProfile"
          >
            <a-button
              danger
              size="small"
              @click="
                prepareRemoveProfile(activeProfile.id, activeProfile.name)
              "
            >
              <template #icon><DeleteOutlined /></template>
              删除
            </a-button>
          </a-popconfirm>
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
          宿管启用默认练度
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
        <a-checkbox
          :checked="showUnownedOperatorsInPicker"
          @change="
            (event: { target: { checked: boolean } }) =>
              setShowUnownedOperatorsInPicker(event.target.checked)
          "
        >
          候选框显示未拥有干员
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
                  :elite-level="progressionAvatarElite(operator)"
                  :operator-owned="progressionEntry(operator)?.owned === true"
                  :operator="operator"
                  :show-elite-level="true"
                  :show-name="false"
                  :show-profession="true"
                  :show-rarity="true"
                  :plain="true"
                  :proportional-layout="true"
                  :size="56"
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
      class="settings-panel settings-simulator-panel"
      title="排班模拟器"
    >
      <section
        class="settings-simulator-section settings-drone-strategy-section"
      >
        <h3 class="settings-section-title">无人机加速贸易站策略</h3>
        <p class="settings-panel-description">
          排班表未设置专用策略时，按布局中最低贸易站等级自动选择。
        </p>
        <a-form layout="vertical" class="settings-sanity-form">
          <a-form-item label="1级贸易站策略">
            <div class="settings-control-row">
              <a-input
                :value="lmdDroneStrategies[1]"
                @update:value="
                  (value: string) => updateLmdDroneStrategy(1, value)
                "
              />
              <a-button
                aria-label="恢复1级贸易站策略默认值"
                size="small"
                title="恢复默认"
                @click="resetLmdDroneStrategy(1)"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </div>
          </a-form-item>
          <a-form-item label="2级贸易站策略">
            <div class="settings-control-row">
              <a-input
                :value="lmdDroneStrategies[2]"
                @update:value="
                  (value: string) => updateLmdDroneStrategy(2, value)
                "
              />
              <a-button
                aria-label="恢复2级贸易站策略默认值"
                size="small"
                title="恢复默认"
                @click="resetLmdDroneStrategy(2)"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </div>
          </a-form-item>
          <a-form-item label="3级贸易站策略">
            <div class="settings-control-row">
              <a-input
                :value="lmdDroneStrategies[3]"
                @update:value="
                  (value: string) => updateLmdDroneStrategy(3, value)
                "
              />
              <a-button
                aria-label="恢复3级贸易站策略默认值"
                size="small"
                title="恢复默认"
                @click="resetLmdDroneStrategy(3)"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </div>
          </a-form-item>
        </a-form>
        <a-checkbox
          :checked="droneOverflowTruncationEnabled"
          @change="
            (event: { target: { checked: boolean } }) =>
              setDroneOverflowTruncationEnabled(event.target.checked)
          "
        >
          模拟 MAA 无人机爆仓时截断至 250 架
        </a-checkbox>
        <p class="settings-panel-description">
          无论是否截断，发生无人机爆仓时都会显示警告；此设置不影响其他设施产物的爆仓模拟。
        </p>
      </section>

      <section class="settings-simulator-section settings-sanity-section">
        <h3 class="settings-section-title">理智计算</h3>
        <p class="settings-panel-description">
          设置资源的理智价值。赤金和作战记录按当前效率计算中的基础时间推导，无人机按每架加速
          3 分钟计算；材料默认值取自一图流物品价值表。
        </p>
        <a-form layout="vertical" class="settings-sanity-form">
          <a-form-item extra="每 1 龙门币" label="龙门币理智">
            <div class="settings-control-row">
              <a-input-number
                :min="0"
                :step="0.0001"
                :value="sanitySettings.lmd"
                @update:value="updateLmd"
              />
              <a-button
                aria-label="恢复龙门币理智默认值"
                size="small"
                title="恢复默认"
                @click="resetSanitySetting('lmd')"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </div>
          </a-form-item>
          <a-form-item extra="龙门币价值 ÷ 经验价值" label="钱书价值比">
            <div class="settings-control-row">
              <a-input-number
                :min="0"
                :step="0.01"
                :value="sanitySettings.goldExperienceRatio"
                @update:value="updateGoldExperienceRatio"
              />
              <a-button
                aria-label="恢复钱书价值比默认值"
                size="small"
                title="恢复默认"
                @click="resetSanitySetting('goldExperienceRatio')"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </div>
          </a-form-item>
          <a-form-item extra="用于反推源石碎片价值" label="合成玉理智">
            <div class="settings-control-row">
              <a-input-number
                :min="0"
                :step="0.01"
                :value="sanitySettings.orundum"
                @update:value="updateOrundum"
              />
              <a-button
                aria-label="恢复合成玉理智默认值"
                size="small"
                title="恢复默认"
                @click="resetSanitySetting('orundum')"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </div>
          </a-form-item>
          <a-form-item extra="每 1 信用，线索产出已并入信用" label="信用理智">
            <div class="settings-control-row">
              <a-input-number
                :min="0"
                :step="0.0001"
                :value="sanitySettings.credit"
                @update:value="updateCredit"
              />
              <a-button
                aria-label="恢复信用理智默认值"
                size="small"
                title="恢复默认"
                @click="resetSanitySetting('credit')"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </div>
          </a-form-item>
          <a-form-item extra="每 1 次刷新" label="公开招募标签刷新次数理智">
            <div class="settings-control-row">
              <a-input-number
                :min="0"
                :step="0.01"
                :value="sanitySettings.recruitRefresh"
                @update:value="updateRecruitRefresh"
              />
              <a-button
                aria-label="恢复公开招募标签刷新次数理智默认值"
                size="small"
                title="恢复默认"
                @click="resetSanitySetting('recruitRefresh')"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </div>
          </a-form-item>
          <a-form-item
            extra="默认按回收站产出池概率和材料理智加权，可单独覆盖"
            label="回收站每次产出道具等效理智"
          >
            <div class="settings-control-row">
              <a-input-number
                :min="0"
                :step="0.01"
                :value="
                  sanitySettings.recycleItemSanity ??
                  sanityValues.recycleItemSanity
                "
                @update:value="
                  (value: number | null) =>
                    setSanitySetting('recycleItemSanity', value)
                "
              />
              <a-button
                aria-label="恢复回收站每次产出道具等效理智默认值"
                size="small"
                title="恢复默认"
                @click="resetSanitySetting('recycleItemSanity')"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </div>
          </a-form-item>
        </a-form>
        <a-collapse
          v-model:active-key="sanityMaterialPanelKeys"
          :bordered="false"
          class="settings-sanity-materials"
        >
          <a-collapse-panel key="material-items">
            <template #header>材料道具（{{ materialItems.length }}）</template>
            <div class="settings-sanity-material-toolbar">
              <a-input
                v-model:value="sanityMaterialSearch"
                allow-clear
                placeholder="搜索材料名称"
              >
                <template #prefix><SearchOutlined /></template>
              </a-input>
              <a-select
                v-model:value="selectedSanityMaterialRarities"
                allow-clear
                mode="multiple"
                :options="sanityMaterialRarityOptions"
                placeholder="筛选稀有度"
              />
            </div>
            <a-form
              v-if="sanityMaterialRows.length > 0"
              layout="vertical"
              class="settings-sanity-material-form"
            >
              <a-form-item
                v-for="item in sanityMaterialRows"
                :key="item.itemId"
                extra="理智/个"
              >
                <template #label>
                  <span class="settings-sanity-material-label">
                    <img
                      :alt="''"
                      aria-hidden="true"
                      :src="sanityMaterialIconUrl(item)"
                    />
                    <span>{{ item.name }}</span>
                  </span>
                </template>
                <div class="settings-control-row">
                  <a-input-number
                    :aria-label="`${item.name}等效理智`"
                    :min="0"
                    placeholder="未设置"
                    :step="0.0001"
                    :value="sanityMaterialInputValue(item.itemId)"
                    @blur="commitSanityMaterial(item.itemId)"
                    @press-enter="commitSanityMaterial(item.itemId)"
                    @update:value="
                      (value: number | null) =>
                        updateSanityMaterial(item.itemId, value)
                    "
                  />
                  <a-button
                    :aria-label="`恢复${item.name}理智默认值`"
                    size="small"
                    title="恢复默认"
                    @click="resetSanityMaterial(item.itemId)"
                  >
                    <template #icon><ReloadOutlined /></template>
                  </a-button>
                </div>
              </a-form-item>
            </a-form>
            <a-empty v-else :image="undefined" description="没有匹配的道具" />
          </a-collapse-panel>
        </a-collapse>
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
      </section>

      <section class="settings-simulator-section settings-base-point-section">
        <h3 class="settings-section-title">基地点数显示</h3>
        <p class="settings-panel-description">
          选择排班模拟器计算结果中需要显示的基地点数，设置仅影响显示，不改变计算结果。
        </p>
        <a-checkbox
          v-if="basePointDisplayOptions.length"
          :checked="
            visibleBasePointTermCount === basePointDisplayOptions.length
          "
          :indeterminate="
            visibleBasePointTermCount > 0 &&
            visibleBasePointTermCount < basePointDisplayOptions.length
          "
          @change="
            (event: { target: { checked: boolean } }) =>
              setAllBasePointTermsVisible(event.target.checked)
          "
        >
          全部显示
        </a-checkbox>
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
          description="当前没有可用的基地点数"
        />
      </section>

      <section class="settings-simulator-section settings-notice-section">
        <h3 class="settings-section-title">计算提示</h3>
        <p class="settings-panel-description">
          选择排班模拟器中需要显示的计算提示，设置仅影响显示，不改变计算结果。
        </p>
        <a-checkbox
          :checked="
            visibleEfficiencyNoticeCount ===
            EFFICIENCY_NOTICE_DISPLAY_OPTIONS.length
          "
          :indeterminate="
            visibleEfficiencyNoticeCount > 0 &&
            visibleEfficiencyNoticeCount <
              EFFICIENCY_NOTICE_DISPLAY_OPTIONS.length
          "
          @change="
            (event: { target: { checked: boolean } }) =>
              setAllEfficiencyNoticesVisible(event.target.checked)
          "
        >
          全部显示
        </a-checkbox>
        <div class="settings-notice-groups">
          <section
            v-for="group in efficiencyNoticeDisplayGroups"
            :key="group.level"
            class="settings-notice-group"
          >
            <div class="settings-notice-group-heading">
              <h4 class="settings-notice-group-title">{{ group.label }}</h4>
            </div>
            <div class="settings-notice-group-toggle">
              <a-checkbox
                :checked="group.visibleCount === group.options.length"
                :indeterminate="
                  group.visibleCount > 0 &&
                  group.visibleCount < group.options.length
                "
                @change="
                  (event: { target: { checked: boolean } }) =>
                    setEfficiencyNoticesVisible(
                      group.options.map((option) => option.code),
                      event.target.checked,
                    )
                "
              >
                全部显示
              </a-checkbox>
            </div>
            <div class="settings-notice-options">
              <a-checkbox
                v-for="option in group.options"
                :key="option.code"
                :checked="isEfficiencyNoticeVisible(option.code)"
                @change="
                  (event: { target: { checked: boolean } }) =>
                    setEfficiencyNoticeVisible(
                      option.code,
                      event.target.checked,
                    )
                "
              >
                {{ option.label }}
              </a-checkbox>
            </div>
          </section>
        </div>
      </section>

      <section
        class="settings-simulator-section settings-result-resource-section"
      >
        <h3 class="settings-section-title">结果产物数值</h3>
        <p class="settings-panel-description">
          排班模拟器结果中的赤金和中级作战记录使用同一显示口径。
        </p>
        <a-form layout="vertical">
          <a-form-item label="显示方式">
            <div class="settings-control-row settings-control-row--start">
              <a-radio-group
                :value="resultResourceDisplayMode"
                button-style="solid"
                option-type="button"
                @change="
                  (event: { target: { value: unknown } }) =>
                    setResultResourceDisplayMode(event.target.value)
                "
              >
                <a-radio-button
                  v-for="(option, key) in resultResourceDisplayModeOptions"
                  :key="key"
                  :value="key"
                >
                  {{ option.label }}
                </a-radio-button>
              </a-radio-group>
              <a-button
                aria-label="恢复结果产物数值默认值"
                size="small"
                title="恢复默认"
                @click="resetResultResourceDisplayMode"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </div>
            <p class="settings-panel-hint">
              {{
                resultResourceDisplayModeOptions[resultResourceDisplayMode]
                  .description
              }}
            </p>
          </a-form-item>
        </a-form>
      </section>

      <section
        class="settings-simulator-section settings-calculation-step-section"
      >
        <h3 class="settings-section-title">计算步骤</h3>
        <p class="settings-panel-description">
          设置排班模拟器计算步骤的展开方式，修改后立即作用于所有排班表并保存在当前浏览器。
        </p>
        <a-form layout="vertical">
          <a-form-item label="展开方式">
            <div class="settings-control-row settings-control-row--start">
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
              <a-button
                aria-label="恢复计算步骤展开方式默认值"
                size="small"
                title="恢复默认"
                @click="resetCalculationStepDisplayMode"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </div>
            <p class="settings-panel-hint">
              {{
                calculationStepDisplayModeOptions[calculationStepDisplayMode]
                  .description
              }}
            </p>
          </a-form-item>
          <a-form-item label="数值原始精度">
            <div class="settings-control-row settings-control-row--start">
              <a-checkbox
                :checked="numericTooltipEnabled"
                @change="
                  (event: { target: { checked: boolean } }) =>
                    setNumericTooltipEnabled(event.target.checked)
                "
              >
                鼠标悬停显示被舍入前的数值
              </a-checkbox>
              <a-button
                aria-label="恢复数值原始精度默认值"
                size="small"
                title="恢复默认"
                @click="resetNumericTooltipSettings"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </div>
            <p class="settings-panel-hint">
              仅在页面数值因显示精度限制发生变化时显示，使用默认悬停延迟。
            </p>
          </a-form-item>
          <a-form-item label="宿舍自动休整干员">
            <div class="settings-control-row settings-control-row--start">
              <a-checkbox
                :checked="showAutomaticRestOperators"
                @change="
                  (event: { target: { checked: boolean } }) =>
                    setShowAutomaticRestOperators(event.target.checked)
                "
              >
                在宿舍计算步骤中显示自动休整进驻干员的明细
              </a-checkbox>
            </div>
          </a-form-item>
        </a-form>
      </section>

      <section class="settings-simulator-section settings-colors-section">
        <h3 class="settings-section-title">框体背景颜色</h3>
        <p class="settings-panel-description">
          调整排班表框体的设施背景色、产物颜色和菲亚梅塔假设施颜色。
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
              <a-button
                :aria-label="`恢复${label}背景颜色默认值`"
                size="small"
                title="恢复默认"
                @click="resetFacilityColor(type)"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
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
              <a-button
                aria-label="恢复菲亚梅塔假设施颜色默认值"
                size="small"
                title="恢复默认"
                @click="resetFiammettaColor"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
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
              <a-button
                :aria-label="`恢复${label}颜色默认值`"
                size="small"
                title="恢复默认"
                @click="resetProductColor(product)"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </div>
          </div>
        </div>
      </section>

      <section
        class="settings-simulator-section settings-operator-picker-section"
      >
        <h3 class="settings-section-title">干员候选框</h3>
        <p class="settings-panel-description">
          调整排班模拟器干员候选框中每行显示的干员数量，修改后立即生效并保存在当前浏览器。
        </p>
        <a-form layout="vertical">
          <a-form-item
            extra="默认 4，仅支持正整数，不设上限"
            label="每行显示干员数"
          >
            <div class="settings-control-row">
              <a-input-number
                :min="1"
                :precision="0"
                :step="1"
                :value="operatorPickerColumns"
                addon-after="人"
                @update:value="
                  (value: number | null) =>
                    handleOperatorPickerColumnsChange(value)
                "
              />
              <a-button
                aria-label="恢复干员候选框人数默认值"
                size="small"
                title="恢复默认"
                @click="resetOperatorPickerColumns"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </div>
          </a-form-item>
        </a-form>
      </section>

      <section
        class="settings-simulator-section settings-facility-card-section"
      >
        <h3 class="settings-section-title">设施卡片</h3>
        <p class="settings-panel-description">
          调整排班模拟器设施卡片背景的产物图标样式，修改后立即生效并保存在当前浏览器。
        </p>
        <a-form layout="vertical">
          <a-form-item label="设施卡片背景产物图标">
            <div class="settings-control-row settings-control-row--start">
              <div>
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
              </div>
              <a-button
                aria-label="恢复设施卡片背景产物图标默认值"
                size="small"
                title="恢复默认"
                @click="resetFacilityCardSettings"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </div>
          </a-form-item>
        </a-form>
      </section>
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

<style scoped src="../assets/page-layout.css"></style>
<style scoped src="./styles/settings.css"></style>
