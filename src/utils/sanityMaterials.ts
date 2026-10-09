import type { TorappuItem, TorappuItemTable } from "@/types/torappu";

interface SanityMaterialDefaultsFile {
  source: "https://ark.yituliu.cn/material/value";
  field: "itemValueAp";
  capturedAt: string;
  values: Record<string, number>;
}

let sanityMaterialDefaultsPromise: Promise<Record<string, number>> | undefined;

function parseSanityMaterialDefaults(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("材料理智默认值格式无效");
  }
  const candidate = value as Partial<SanityMaterialDefaultsFile>;
  if (
    candidate.source !== "https://ark.yituliu.cn/material/value" ||
    candidate.field !== "itemValueAp" ||
    typeof candidate.capturedAt !== "string" ||
    typeof candidate.values !== "object" ||
    candidate.values === null ||
    Array.isArray(candidate.values)
  ) {
    throw new Error("材料理智默认值格式无效");
  }

  const values = Object.fromEntries(
    Object.entries(candidate.values).map(([itemId, sanity]) => {
      if (
        !/^\d+$/.test(itemId) ||
        typeof sanity !== "number" ||
        !Number.isFinite(sanity) ||
        sanity < 0
      ) {
        throw new Error("材料理智默认值包含无效条目");
      }
      return [itemId, sanity];
    }),
  );
  if (Object.keys(values).length === 0) {
    throw new Error("材料理智默认值为空");
  }
  return values;
}

export function loadSanityMaterialDefaults(): Promise<Record<string, number>> {
  sanityMaterialDefaultsPromise ??= fetch(
    `${import.meta.env.BASE_URL}assets/sanity-material-defaults.json`,
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error(`材料理智默认值读取失败（HTTP ${response.status}）`);
      }
      return response.json() as Promise<unknown>;
    })
    .then(parseSanityMaterialDefaults)
    .catch((error: unknown) => {
      sanityMaterialDefaultsPromise = undefined;
      throw error;
    });
  return sanityMaterialDefaultsPromise;
}

export function sanityMaterialItems(
  itemTable: TorappuItemTable | undefined,
): TorappuItem[] {
  return Object.values(itemTable?.items ?? {}).filter(
    (item) =>
      item.itemType === "MATERIAL" &&
      item.classifyType === "MATERIAL" &&
      item.sortId !== undefined &&
      item.sortId >= 100001 &&
      item.sortId <= 100060,
  );
}
