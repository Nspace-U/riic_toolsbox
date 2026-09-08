# 项目上下文

## 项目定位

本项目是用 Vue、TypeScript 和 Ant Design Vue 重构的明日方舟基建工具箱。当前基建效率计算已进入逻辑层实现阶段，前端计算器页面仍可独立接入。

## 干员技能数据

- 生成入口：`scripts/generate-operator-skills.mjs`
- 人工覆盖：`scripts/operator-skill-overrides.mjs`
- 运行命令：`npm run generate:operator-skills`
- 输出目录：`public/assets/operator-skills/`
- 规范：`干员技能JSON规范.md`
- 心情检查表：`public/skill-mood-check.json`

生成器只使用当前项目 `public/assets/gamedata/latest/excel/` 下的 Torappu 三份快照：`character_table.json`、`building_data.json` 和 `gamedata_const.json`。旧项目 CSV 和旧控制中枢人工映射表不属于运行时输入。

当前设施 key 为 `control`、`trading`、`manufacture`、`power`、`meeting`、`hire`、`dormitory`。加工站和训练室来源技能暂不生成，也不输出警告；未来可以在同一中间数据契约上扩展计算器。

控制中枢的 `部分设施`、`其他设施`、`工作场所` 从当前 `gamedata_const.json` 的术语描述动态展开。特殊比较技能使用 `stack: "max"` 与 `maxGroup` 表达逐设施取最高，而不是在生成阶段求值。

## 当前状态

- 已完成当前范围的干员技能 JSON 生成器重构。
- 已生成每名干员独立 JSON，不生成索引文件。
- 已实现富文本术语解析、固定效果、线性效果、条件效果、心情检查标记和控制中枢设施集合展开。
- 已将无法稳定从描述推导的少量规则集中到人工覆盖表。
- 已根据旧项目 Markdown 整理并确认效率计算基础规则：`docs/效率计算基础规则待核对.md`。
- 已新增 `src/types/efficiency.ts`、`src/utils/efficiency/` 纯计算模块和 `docs/效率计算模块使用说明.md`。
- 已实现队列时长、设施基础效率、固定产出、制造站产出、贸易站特殊订单、订单上限联动、技能条件/per/曲线、基地点数、属性层和心情链计算。
- `ScheduleDocument.settings` 已加入计算设置；`OperatorState.level` 已加入供等级解锁和未来训练室扩展使用。
- 加工站、训练室模拟和宿舍自动休整仍不参与第一版计算。

## 风险与下一步

- JSON 是效率计算模块消费的中间表示；生成器与计算器继续只使用当前 Torappu 三份快照及当前项目目录。
- 第一版不模拟库存爆仓、首个物品进度、订单逐单衰减或宿舍自动休整；相关设置字段保留以便后续扩展。
- 新 Torappu 快照增加术语或改变描述句式时，应先运行生成器检查警告，再更新解析规则或覆盖表。
- 前端接入时应遵守 `docs/效率计算模块使用说明.md`，并遵守 `干员技能JSON规范.md` 的 `target`、`stat`、`condition`、`per` 与最高值组语义。
