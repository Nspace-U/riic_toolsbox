import { ref } from "vue";

import type {
  BaseData,
  BaseDataMetadata,
  BaseSkillTerms,
  Operator,
  RichTextStyles,
} from "@/types/baseData";
import type { TorappuItemTable } from "@/types/torappu";
import {
  preloadBaseDataAssets,
  clearBaseDataAssetCache,
  type AssetPreloadResult,
} from "@/utils/preloadBaseDataAssets";
import {
  parseTorappuData,
  type TorappuBuildingData,
  type TorappuCharacterTable,
  type TorappuGamedataConst,
} from "@/utils/parseTorappuData";

interface UseBaseDataResult {
  operators: Readonly<typeof operators>;
  richTextStyles: Readonly<typeof richTextStyles>;
  terms: Readonly<typeof terms>;
  metadata: Readonly<typeof metadata>;
  itemTable: Readonly<typeof itemTable>;
  loading: Readonly<typeof loading>;
  assetsLoading: Readonly<typeof assetsLoading>;
  assetsReady: Readonly<typeof assetsReady>;
  assetPreloadResult: Readonly<typeof assetPreloadResult>;
  errorMessage: Readonly<typeof errorMessage>;
  ready: Readonly<typeof ready>;
  reload: () => Promise<void>;
}

const operators = ref<Operator[]>([]);
const richTextStyles = ref<RichTextStyles>({});
const terms = ref<BaseSkillTerms>({});
const metadata = ref<BaseDataMetadata>();
const itemTable = ref<TorappuItemTable>();
const loading = ref(false);
const assetsLoading = ref(false);
const assetsReady = ref(false);
const assetPreloadResult = ref<AssetPreloadResult>();
const errorMessage = ref("");
const ready = ref(false);
let loadingPromise: Promise<void> | null = null;
let assetPreloadVersion = 0;

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function fetchJson<T>(path: string, label: string): Promise<T> {
  const response = await fetch(assetUrl(path));
  if (!response.ok) {
    throw new Error(`${label}读取失败（HTTP ${response.status}）`);
  }
  return response.json() as Promise<T>;
}

async function fetchTorappuData(): Promise<BaseData> {
  const [characterTable, buildingData, gamedataConst, metadata, itemTable] =
    await Promise.all([
      fetchJson<TorappuCharacterTable>(
        "assets/gamedata/latest/excel/character_table.json",
        "干员数据",
      ),
      fetchJson<TorappuBuildingData>(
        "assets/gamedata/latest/excel/building_data.json",
        "基建数据",
      ),
      fetchJson<TorappuGamedataConst>(
        "assets/gamedata/latest/excel/gamedata_const.json",
        "常量数据",
      ),
      fetchJson<BaseDataMetadata>(
        "assets/gamedata/latest/torappu-meta.json",
        "版本信息",
      ),
      fetchJson<TorappuItemTable>(
        "assets/gamedata/latest/excel/item_table.json",
        "物品数据",
      ),
    ]);
  const terms: BaseSkillTerms = Object.fromEntries(
    Object.entries(gamedataConst.termDescriptionDict ?? {}).map(
      ([key, term]) => [
        key,
        {
          name: term.termName ?? key,
          ...(term.description ? { definition: term.description } : {}),
        },
      ],
    ),
  );

  return {
    operators: parseTorappuData(
      characterTable,
      buildingData,
      metadata,
      gamedataConst.termDescriptionDict ?? {},
      gamedataConst.richTextStyles ?? {},
    ),
    richTextStyles: gamedataConst.richTextStyles ?? {},
    terms,
    metadata,
    itemTable,
  };
}

function resetAssetState(): void {
  assetPreloadVersion += 1;
  assetsLoading.value = false;
  assetsReady.value = false;
  assetPreloadResult.value = undefined;
}

function startAssetPreload(data: BaseData): void {
  const requestVersion = ++assetPreloadVersion;
  assetsLoading.value = true;
  assetsReady.value = false;
  assetPreloadResult.value = undefined;

  void preloadBaseDataAssets(data)
    .then((result) => {
      if (requestVersion !== assetPreloadVersion) {
        return;
      }

      assetPreloadResult.value = result;
      assetsLoading.value = false;
      assetsReady.value = true;
    })
    .catch(() => {
      if (requestVersion !== assetPreloadVersion) {
        return;
      }

      assetsLoading.value = false;
      assetsReady.value = true;
    });
}

async function load(): Promise<void> {
  if (loadingPromise) {
    return loadingPromise;
  }

  loading.value = true;
  errorMessage.value = "";
  loadingPromise = fetchTorappuData()
    .then((data) => {
      operators.value = data.operators;
      richTextStyles.value = data.richTextStyles;
      terms.value = data.terms;
      metadata.value = data.metadata;
      itemTable.value = data.itemTable;
      ready.value = true;
      startAssetPreload(data);
    })
    .catch((error: unknown) => {
      operators.value = [];
      richTextStyles.value = {};
      terms.value = {};
      metadata.value = undefined;
      itemTable.value = undefined;
      ready.value = false;
      errorMessage.value =
        error instanceof Error ? error.message : "数据读取失败";
    })
    .finally(() => {
      loading.value = false;
      loadingPromise = null;
    });

  return loadingPromise;
}

async function reload(): Promise<void> {
  const currentLoadingPromise = loadingPromise;
  if (currentLoadingPromise) {
    await currentLoadingPromise;
  }

  clearBaseDataAssetCache();
  resetAssetState();
  await load();
}

const result: UseBaseDataResult = {
  operators,
  richTextStyles,
  terms,
  metadata,
  itemTable,
  loading,
  assetsLoading,
  assetsReady,
  assetPreloadResult,
  errorMessage,
  ready,
  reload,
};

export function useBaseData(): UseBaseDataResult {
  if (!ready.value) {
    void load();
  }

  return result;
}
