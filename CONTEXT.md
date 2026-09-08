# 项目上下文

## 项目定位

本项目是用 Vue、TypeScript 和 Ant Design Vue 重构的明日方舟基建工具箱。当前任务涉及基建技能数据生成，不改变前端设施组件和排班模拟器的既有接口。

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
- 已根据旧项目 Markdown 整理效率计算基础规则草稿：`docs/效率计算基础规则待核对.md`，等待用户核对后再实现计算模块。
- 加工站、训练室模拟和完整效率计算仍未实现。

## 风险与下一步

- JSON 是供未来计算器消费的中间表示，当前生成成功不等于所有设施效率已经在模拟器中结算。
- `docs/效率计算基础规则待核对.md` 只记录旧项目来源和待确认口径，不是已生效的计算规范；其中宿舍自动休整、贸易站特殊订单、订单上限联动和爆仓策略仍需确认。
- 新 Torappu 快照增加术语或改变描述句式时，应先运行生成器检查警告，再更新解析规则或覆盖表。
- 后续实现加工站、训练室和效率结算时，应遵守 `干员技能JSON规范.md` 的 `target`、`stat`、`condition`、`per` 与最高值组语义。
