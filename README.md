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

脚本会读取 Torappu 最新的已完成版本，裁剪为应用实际使用的字段后写入 `public/assets/gamedata/latest`，并将原始头像和技能图标写入 `public/assets/raw`，同时在 `torappu-meta.json` 中记录版本号与 revision。现有 CSV、术语文件和旧资源目录会保留，作为兼容数据。

## 同步 PRTS WIKI 实装时间

Torappu 数据同步完成后，运行以下命令从 PRTS WIKI 读取干员上线时间，并写入本地 `character_table.json`：

```sh
npm run sync:prts
```

页面运行时只读取本地 JSON，不会直接请求 PRTS WIKI。

## 构建检查

```sh
npm run build
```
