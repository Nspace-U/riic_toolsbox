## 2026-09-08：重构干员技能 JSON 生成链路

- **已完成**：生成器改为只读取当前 Torappu 的 `character_table.json`、`building_data.json`、`gamedata_const.json`，不再读取旧 CSV 或旧控制中枢映射表。
- **已完成**：输出改为 `public/assets/operator-skills/{干员ID}.json`，每名干员独立文件，不生成 `index.json`。
- **已完成**：当前设施 key 统一为 `control`、`trading`、`manufacture`、`power`、`meeting`、`hire`、`dormitory`；加工站和训练室来源技能暂缓且静默跳过。
- **已完成**：控制中枢的 `部分设施`、`其他设施`、`工作场所` 从当前 `gamedata_const.json` 动态展开；玛恩纳、重岳、维什戴尔的特殊比较用 `otherFacRec` 最高值组表达。
- **已完成**：普通技能优先从描述和术语自动解析；望、孑、吽、歌蕾蒂娅、琴柳、摩根等少量无法稳定推导的技能进入 `operator-skill-overrides.mjs`。
- **验证**：生成 345 名干员、661 条当前范围技能，跳过 260 条加工站/训练室来源技能，0 条警告。
- **未完成**：加工站、训练室模拟以及基于该 JSON 的完整效率计算。

## 2026-09-08：整理并确认效率计算基础规则

- **已完成**：根据旧项目 `基建模拟器文档.md`、`贸易站龙门商法策略.md`、`心情机制.md`、`控制中枢实现记录.md` 和 `干员技能JSON规范.md`，整理当前项目效率计算需要的设施、产出、订单、容量、效率和心情规则。
- **已完成**：新增 `docs/效率计算基础规则待核对.md`，区分基础数据、计算语义和旧项目特殊规则，并记录用户确认结果。
- **当时未完成**：尚未根据整理结果实现效率计算代码；加工站和训练室仍不参与本阶段模拟。
- **已确认**：用户确认全部沿用整理后的基础规则；第一版不模拟库存爆仓、首个物品进度和订单逐单衰减，贸易特殊订单与订单上限联动全部实现，宿舍自动休整暂缓，心情消耗采用后续规则。

## 2026-09-08：实现效率计算逻辑层

- **接口**：以 `calculateEfficiency(document, catalog)` 作为纯计算模块的外部接口，以 `loadEfficiencyCatalog` 作为当前项目独立技能 JSON 的加载适配器。
- **数据边界**：计算器只消费当前项目的排班文档和 `public/assets/operator-skills/{id}.json`；不读取旧 CSV、旧脚本或旧控制中枢映射表。
- **计算顺序**：先解析队列和心情，再求基地点数与技能条件；设施属性独立于效率百分比聚合；贸易站特殊订单和订单上限联动在产出层处理。
- **订单联动**：按 `C -> 锏冠军风采 -> 孑效率扣除 -> X -> 琳琅/孑效率` 的确认顺序实现，订单上限总值保持至少为 1。
- **范围**：加工站、训练室、宿舍自动休整、库存爆仓、首物品进度和逐单订单衰减不进入第一版模拟；`ScheduleSettings` 保留后续扩展字段。
- **验证**：`npm run type-check` 和 `npm run build` 通过；技能目录 345 个独立 JSON 的结构检查通过。

## 2026-09-09：接入 ESLint 与 Prettier

- **决定**：使用 ESLint 9 Flat Config，组合 `@eslint/js`、`typescript-eslint` 和 `eslint-plugin-vue` 的标准推荐配置，覆盖 `src/` 与 `scripts/` 中的 JavaScript、TypeScript 和 Vue 文件。
- **决定**：由 Prettier 单独负责格式化，使用 `eslint-config-prettier` 关闭冲突的 ESLint 格式规则；不使用 `eslint-plugin-prettier`，避免将格式化错误混入语义检查。
- **约束**：不为现有代码增加 ESLint 例外规则或自定义 Prettier 风格；构建产物、依赖、游戏数据快照和生成的干员技能 JSON 不参与检查。
- **命令**：新增 `npm run lint`、`npm run lint:fix`、`npm run format` 和 `npm run format:check`。
- **验证**：`npm run lint`、`npm run format:check`、`npm run type-check`、`npm run build` 和 `npm run generate:operator-skills` 均通过。对默认规则报告的未使用变量、无效赋值、变量声明、空代码块和 Vue 属性顺序问题进行了局部代码修复；未增加规则例外，也未关闭质量检查。

## 2026-09-09：修复隐藏技能折叠状态下的技能分割线

- **问题**：技能行通过 `v-show` 隐藏时仍保留在 DOM 中，且展开/折叠按钮位于技能行之后，导致最后一条可见技能无法命中原有的 `:last-child` 规则，按钮上方错误显示分割线。
- **决定**：`OperatorSkillCard` 使用当前可见技能列表渲染技能行，避免隐藏技能参与末尾元素判断；CSS 改用 `.operator-skill-row:last-of-type`，确保按钮存在时最后一个技能行仍移除下边框。
- **范围**：仅影响基建技能一览页的技能卡片；技能图片生成页不启用隐藏技能展开按钮，不改变其显示逻辑。
- **验证**：`npm run lint`、`npm run format:check`、`npm run type-check` 和 `npm run build` 均通过；构建仅保留既有的大 chunk 警告。
