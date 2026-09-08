# 基建工具箱

明日方舟基建工具箱，使用 Vue 3、TypeScript 和 Ant Design Vue 构建。

## 本地开发

```sh
npm install
npm run dev
```

## 同步 Torappu 数据

默认数据源使用 Torappu 的本地快照。需要更新干员、基建技能和原始头像/技能图标时运行：

```sh
npm run sync:torappu
```

脚本会读取 Torappu 最新的已完成版本，按原始数据层级将每个干员的 `buffChar` 写入 `public/assets/gamedata/latest/excel/character_table.json`，将共享的 `buffs` 写入 `public/assets/gamedata/latest/excel/building_data.json`，将术语定义原样写入 `public/assets/gamedata/latest/excel/gamedata_const.json`，并将指定的 10 个物品写入 `public/assets/gamedata/latest/excel/item_table.json`。物品快照保留官方 `itemId`、名称、图标字段和生产关联，同时记录 `gamedata/latest/excel/item_table.json`、`assets/item_icon` 和 `raw/item_icon` 路径；物品主图标写入 `public/assets/raw/item_icon`。其中无人机使用官方 `base_ap`，信用使用官方字符串 ID `SOCIAL_PT`。脚本还会将原始头像和技能图标写入 `public/assets/raw`，在 `torappu-meta.json` 中记录版本号、revision 和数据路径。应用运行时通过 `buffId` 关联干员的 `buffChar` 和共享 `buffs`，再从 `gamedata_const.termDescriptionDict` 读取术语定义；术语名称仍从基建技能描述标签提取。

## 同步 PRTS WIKI 实装顺序

Torappu 数据同步完成后，运行以下命令从 PRTS WIKI 的干员一览页读取 `data-sortid` 和干员上线时间，并写入本地 `character_table.json`：

```sh
npm run sync:prts
```

页面运行时只读取本地 JSON，不会直接请求 PRTS WIKI。
旧的 `operator-base-skills.csv` 不参与 Torappu 数据的实装顺序或兼容字段读取。

## 构建检查

```sh
npm run build
```
