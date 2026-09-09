<script setup lang="ts">
import {
  CopyOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SettingOutlined,
  UploadOutlined,
} from "@ant-design/icons-vue";
import { computed, ref, watch } from "vue";

import { useBaseData } from "@/composables/useBaseData";
import { isDataSourceId, useDataSource } from "@/composables/useDataSource";
import { useFacilityColors } from "@/composables/useFacilityColors";
import { useOperatorProgression } from "@/composables/useOperatorProgression";
import OperatorAvatarDisplay from "@/components/OperatorAvatarDisplay.vue";
import type { Operator } from "@/types/baseData";
import type { OperatorSkillFile } from "@/types/efficiency";
import type {
  OperatorProgressionEntry,
  OperatorProgressionNode,
} from "@/types/operatorProgression";
import type { RoomKey } from "@/types/schedule";
import {
  sortBranchValues,
  sortProfessionValues,
} from "@/utils/operatorOrdering";
import { ROOM_ORDER } from "@/utils/schedule";
import { nodesForOperator } from "@/utils/operatorProgression";

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
  setFacilityColor,
  setProductColor,
  resetFacilityColors,
} = useFacilityColors();
const { operators, ready: baseDataReady } = useBaseData();
const {
  profiles,
  activeProfileId,
  activeProfile,
  showNoEditableOperators,
  showUnownedOperators,
  treatSkillsAsUnlocked,
  importProfile,
  setActiveProfile,
  updateEntry,
  ensureEntry,
  resetEntry,
  resetProfile,
  duplicateProfile,
  removeProfile,
  setShowNoEditableOperators,
  setShowUnownedOperators,
  setTreatSkillsAsUnlocked,
} = useOperatorProgression();

const facilityColorEntries = ROOM_ORDER.map(
  (type) => [type, facilityLabels[type]] as [RoomKey, string],
);
const productColorEntries = Object.entries(productLabels) as Array<
  ["Pure Gold" | "Orundum" | "Originium Shard", string]
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
const skillFiles = ref<Record<string, OperatorSkillFile | undefined>>({});
let skillFileRequestVersion = 0;

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
        return leftOrder === undefined ? 1 : -1;
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
  const nodes = nodesForOperator(skillFiles.value[operator.id]);
  const eliteNodes = nodes.filter((node) => node.type === "elite");
  if (eliteNodes.some((node) => node.value > 0)) {
    return eliteNodes;
  }

  const levelNodes = nodes.filter((node) => node.type === "level");
  if (levelNodes.length === 0 || levelNodes.some((node) => node.value === 0)) {
    return levelNodes;
  }
  return [
    {
      key: "level-0",
      type: "level",
      value: 0,
      label: "0级",
      facilities: [...new Set(levelNodes.flatMap((node) => node.facilities))],
    },
    ...levelNodes,
  ];
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
  return node.facilities.map((facility) => facilityLabels[facility]).join("、");
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
        导入干员练度后，可按基建技能节点设置干员状态。未选择档案时，排班模拟器会使用设施默认练度。
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
                    v-for="node in progressionNodes(operator)"
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
  </div>
</template>
