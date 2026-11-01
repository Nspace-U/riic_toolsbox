# 基建工具箱

明日方舟基建工具箱，使用 Vue 3、TypeScript 和 Ant Design Vue 构建。

## 本地开发

```sh
npm install
npm run dev
```

## 同步游戏数据与 Torappu 图片

需要更新干员 Excel、基建技能和 Torappu 原始头像/技能图标时运行：

```sh
npm run sync:torappu
npm run generate:operator-skills
```

脚本临时按 `Kengxxiao/ArknightsGameData` 的 `master` 最新提交读取 `zh_CN/gamedata/excel/` 中的 JSON，写入 `public/assets/gamedata/latest/excel/`。Torappu 仍提供干员头像、基建技能图标、物品图标和头像徽标；提交 SHA 与 Torappu 资源版本记录在 `torappu-meta.json`。本地技能生成器和效率计算 package 使用这些快照，暂不读取 PRTS 实装顺序。

## 可选：同步 PRTS WIKI 实装顺序

需要补充 PRTS WIKI 实装顺序时，可运行以下命令从干员一览页读取 `data-sortid` 和干员上线时间，并写入本地 `character_table.json`。当前 Kengxxiao Excel 数据同步不会调用此命令：

```sh
npm run sync:prts
```

页面运行时只读取本地 JSON，不会直接请求 PRTS WIKI。
旧的 `operator-base-skills.csv` 不参与数据同步或兼容字段读取。

## 构建检查

```sh
npm run build
```
