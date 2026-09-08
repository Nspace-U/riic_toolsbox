export interface TorappuBuildingProduct {
  roomType: string
  formulaId: number | string
}

export interface TorappuItem {
  itemId: string
  name: string
  description?: string
  rarity?: string
  iconId: string
  stackIconId?: string | null
  sortId?: number
  classifyType?: string
  itemType?: string
  buildingProductList?: TorappuBuildingProduct[]
  sourceIconPath: string
  localIconPath: string
  [key: string]: unknown
}

export interface TorappuItemResource {
  itemId: string
  name: string
  kind: 'base_resource'
  sourcePath: string
  sourceIconPath: string
  localIconPath: string
}

export interface TorappuItemTable {
  sourcePath: string
  iconSourcePath: string
  iconLocalPath: string
  items: Record<string, TorappuItem>
  expItems: Record<string, unknown>
  potentialItems: Record<string, unknown>
  apSupplies: Record<string, unknown>
  resources: {
    drone: TorappuItemResource
  }
}
