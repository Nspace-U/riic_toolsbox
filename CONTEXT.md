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
- 已将效率计算接入排班模拟器：设施队列小卡片展示组合效率与设施最终效率，独立结果区展示按产物拆分的每日产出与可核对的计算步骤。
- `ScheduleDocument.settings` 已加入计算设置；`OperatorState.level` 已加入供等级解锁和未来训练室扩展使用。
- 已接入 ESLint 与 Prettier：使用 Vue 3、TypeScript 和 JavaScript 的标准推荐配置，构建产物与生成数据目录已排除。
- 已修复基建技能一览中折叠隐藏技能时最后一条可见技能仍显示分割线的问题：技能卡片只渲染当前可见技能，并按最后一个技能元素移除边框。
- 头像生成器已增加页面级“干员已拥有”选项；关闭时仅将头像主体叠加半透明灰色遮罩，分层预览和整合生成保持与心情涣散相同的选项联动，切换干员不自动重置。
- 头像生成器已增加默认关闭的“干员已提升练度”选项；开启时仅将头像主体叠加绿色效果，分层预览和整合生成保持一致。
- 加工站、训练室模拟和宿舍自动休整仍不参与第一版计算。
- 已增加干员练度档案：以干员 ID 为稳定主键，保存名称、拥有状态、精英化等级、等级和稀有度，不保存潜能数据；支持多档案、导入、复制、删除、重置和技能解锁设置持久化。
- 设置页干员列表仍按技能 JSON 中实际存在的基建技能节点筛选；有节点卡片的练度按钮按稀有度提供固定档位，当前练度文字保留 `精英X · Y级` 显示。
- 模拟器练度优先级为排班 JSON 的 `operatorStates[name].elite/level`、档案、设施默认值；缺失字段逐字段回退，`mood` 始终取排班原值。选中档案但未拥有的干员仍按当前设施全部技能解锁状态参与效率计算。
- 未选择档案时，工作设施使用该设施技能节点的最低练度，会客室使用干员最高精英化等级，宿舍、加工站和训练室为 0；“基建技能视为已解锁”只提升有效模拟练度，不修改档案原值。
- 练度设置页的设施、职业、分支、稀有度筛选改为按钮组，设施按钮按基建技能一览的顺序并使用排班模拟器中配置的设施颜色；干员按实装顺序倒序显示，不再按拥有状态排序。
- 练度卡片使用紧凑响应式网格，显示头像、名称、职业、分支、稀有度、当前精英化和重置按钮；未拥有干员当前练度显示为 `—`，不显示拥有文字，头像使用未拥有遮罩，精英化节点不高亮。
- 设置页按稀有度固定档位写入练度；已拥有干员点击当前档位切换为未拥有，未拥有干员点击任意档位后视为已拥有；全部重置恢复当前档案所有干员的导入时状态。
- 头像资源按实际有效精英化等级向低等级回退，设置页、技能一览、头像生成器和排班模拟器共用该规则，头像上的精英化标识仍显示实际等级。

## 本轮练度编辑器更新

- 新增“显示无可编辑节点干员”和“显示未拥有干员”两个默认关闭且持久化的开关；未勾选前隐藏无节点或技能加载失败的干员，勾选后统一显示并保留无节点提示。
- 存在精英1/2节点时显示精英节点；仅有精英0和等级节点的干员改为显示等级节点，1/2 星干员的最低档位显示为 `1级`。已拥有练度显示 `精英X · Y级`。
- 练度卡片头像复用头像生成器的等比例职业、精英化和星级徽标；重置按钮位于节点编辑行行首。未拥有干员在设置页和排班模拟器均使用灰色遮罩。
- 练度卡片桌面端固定为三列显示，窄屏继续使用响应式单列布局。
- 职业筛选固定按先锋、近卫、重装、狙击、术师、医疗、辅助、特种排序；分支按所属职业分组使用稳定业务顺序，新增分支追加到对应职业末尾。

## 本轮效率结果规范化更新

- 计算结果由 `calculateEfficiency` 统一生成，模拟器只消费结果，不在 Vue 页面重复效率或产出公式。
- 计算步骤只保留有产出、容量、技能明细或干员贡献的设施；无贡献设施和无意义步骤不展示。
- 设施结果拆分为基础效率、心情/干员效率、技能/组合效率和最终效率，并展示逐干员贡献、技能明细、心情修正、产出、材料、容量、订单摘要和爆仓状态。
- `skip` 队列按设施类型与同位置向前继承最近一个有干员且非 `skip` 的队列；继承干员与练度，不继承心情覆盖，解析后的 assignment 不再保留 `skip`。
- `firstItemProgress` 支持全局数字或按设施 ID/设施类型回退的 map；`overflowMode: "zero"` 会按容量单位速率截断计划内爆仓后的有效产出，`continue` 保留计划产出。
- 心情计算保留心情为 0 的干员在上下文中，以支持未标记 `moodCheck` 的技能计数；实际效率、消耗和工作状态使用心情大于 0 判定。`moodRecover`/`moodCost` 的 `stack: "max"` 已按最高值组聚合。
- 当前明确未实现精 0 孑订单逐单衰减和 `orderProgress` 动态订单状态；页面提示中的爆仓仅指容量速率和首件进度模型，不代表完整库存模拟。

## 风险与下一步

- JSON 是效率计算模块消费的中间表示；生成器与计算器继续只使用当前 Torappu 三份快照及当前项目目录。
- 尚未实现完整库存过程、精 0 孑逐单订单衰减和 `orderProgress` 动态订单状态；当前只实现容量速率级爆仓时间、首件进度和 `overflowMode` 有效产出截断。宿舍自动休整仍未实现。
- 新 Torappu 快照增加术语或改变描述句式时，应先运行生成器检查警告，再更新解析规则或覆盖表。
- 前端接入时应遵守 `docs/效率计算模块使用说明.md`，并遵守 `干员技能JSON规范.md` 的 `target`、`stat`、`condition`、`per` 与最高值组语义。
- 模拟器效率结果暂只支持 Torappu 数据源；“组合效率”统一表示干员基础贡献与技能/组合贡献之和，每日产出按产物分别汇总。
- 提交前应运行 `npm run lint`、`npm run format:check`、`npm run type-check` 和 `npm run build`；规则升级或新增目录时同步检查忽略范围。Lint 结果按默认规则处理，不为既有代码增加例外。
- 当前验证中，`npm run lint`、`npm run format:check`、`npm run type-check`、`npm run build` 和技能生成命令均已通过；ESLint 报告的未使用变量、无效赋值、变量声明和 Vue 属性顺序问题已按默认规则修复。
- 本次 UI 修复已验证 `npm run lint`、`npm run format:check`、`npm run type-check` 和 `npm run build` 通过；构建仍仅提示既有的大 chunk 警告。
- 排班模拟器新增“编辑布局”“编辑队列”“编辑产物”三个页面开关；开关按排班表文档 ID 独立持久化，不写入排班 JSON，未记录的新文档默认全部开启。
- 关闭编辑布局时仅隐藏设施布局编辑窗口；关闭编辑队列时队列名称、持续时间、描述改为只读并隐藏队列新增/删除/复制；关闭编辑产物时产物和源石碎片原料改为只读。干员、干员练度、心情、跳过状态仍可编辑。
- 本轮排班模拟器编辑开关已验证 `npm run lint`、`npm run format:check`、`npm run type-check`、`npm run build` 和 `git diff --check` 通过；构建仍仅提示既有的大 chunk 警告。
- 通用设置已增加清除本地数据入口；确认后清空当前浏览器 localStorage 并刷新页面，使排班表、练度和其他设置恢复默认状态。
- 通用设置的干员练度档案已增加改名入口；通过弹窗编辑当前档案名称，沿用档案层的空名回退、重名去重和 localStorage 持久化规则。
- 设施布局编辑区改为设施小卡片：每张卡片只显示设施名称、等级和删除操作；卡片显示按 `ROOM_ORDER` 稳定排序，同类设施保持原有相对顺序，不改变布局数组及队列索引绑定。添加设施改为铺开全部 9 类设施，沿用现有建造前置、数量上限和核心设施总数校验，不可添加的设施卡片禁用并显示原因；设施类型不再通过已有卡片直接切换。控制中枢保留禁用删除按钮，删除建造链前置设施且存在后续设施时先确认级联删除；布局卡片复用设施自定义颜色。
- 设施布局编辑区的添加设施卡片位于已建造设施卡片上方，添加设施卡片保持单行显示并统一缩窄宽度；已建造设施固定分为六行：控制中枢、贸易站、制造站、发电站、会客室/办公室/加工站/训练室、宿舍。点击会客室、加工站、办公室或训练室时按建造链自动补建缺失前置，新增房间保持跳过状态并使用设施最高等级，已有设施实例及其队列索引不移动；已建造设施卡片内部为名称行和等级/删除操作行，设施名称不截断。
- 设施布局编辑区增加六行数字批量输入：第 1 至 4 行和第 6 行的每个数字分别表示对应设施实例等级，第 5 行按会客室、加工站、办公室、训练室解释，使用 `0` 表示该功能设施不建造。用户停止修改数字后自动应用布局，应用前自动补齐功能设施建造链，并按合法建造顺序更新布局、按同类型位置保留已有队列房间数据；输入非法或超出数量上限时拒绝更新。布局编辑卡片之间恢复 14px 外部间距，移除布局区内部多余分割线。
- 排班模拟器右侧主编辑区的工具栏、信息卡、布局卡、设施运行区和计算结果区统一使用 14px 外部间距；卡片内部内边距与设施栅格 gutter 保持不变。

## 本轮右键菜单扁平化与会客室练度规则

- **菜单结构**：设施区干员右键菜单取消心情和练度二级菜单，一级直接显示心情 `0/12/24（默认）`、练度档位和可用的“恢复默认练度”，心情与练度之间使用菜单分割线；当前生效心情和练度用勾选图标标记。
- **练度规则**：会客室效率与干员精英化等级相关，右键菜单按干员最高精英化等级显示 `精英0` 至可用最高等级；其他设施统一按当前设施技能 JSON 中真实存在的节点生成菜单，不按设施名称增加特殊分支。
- **关闭行为**：右键菜单点击外部、点击菜单项、按 `Escape`、鼠标滚轮、页面或嵌套滚动容器滚动、窗口尺寸变化时关闭；滚动监听使用捕获阶段覆盖页面内部滚动区域。
- **兼容性**：心情 `24` 继续删除房间心情覆盖；练度选项继续写入房间 `operatorStates[name].elite/level`，恢复默认练度只清除练度字段；既有档案和排班状态不主动迁移。
- **验证状态**：本轮 `vue-tsc`、本轮文件定向 ESLint、Prettier 和 `git diff --check` 通过；浏览器验证一级菜单、分割线、当前项勾选和滚轮关闭。全仓 ESLint/Prettier 仍受工作区其他未提交效率计算改动中的既有问题影响，未在本轮修改这些文件。

## 本轮默认产物更新

- 新生成的贸易站房间默认设置产物为 `LMD`（龙门币），新生成的制造站房间默认设置产物为 `Pure Gold`（赤金），并保留 `skip: true` 的未排班状态。
- 默认值统一由 `createDefaultRoomAssignment` 提供，覆盖模拟器布局补齐、新增队列、编辑补齐、Maa 排班页同类生成和无布局导入时的房间推断补齐。
- 已有房间不会因本次逻辑自动覆盖产物；用户主动清空产物后仍保持未指定状态。
- 未完成：仓库没有排班房间生成逻辑的自动化测试，本轮依赖类型检查、Lint、格式检查、构建和差异检查验证。
- 风险与下一步：后续新增房间生成入口应继续调用 `createDefaultRoomAssignment`，避免默认产物规则分散。
- 排班模拟器设施区干员改为零间距头像网格；头像、名称和空槽位点击后在原位进入紧凑名称补全，失焦或回车提交，Escape 取消，并沿用重复干员校验。
- 设施区移除常驻心情、精英和等级输入框；头像右键提供初始心情 `0/12/24` 快捷项、当前设施真实技能节点对应的练度档位和“恢复默认练度”。24 表示删除房间心情覆盖，恢复默认练度只删除房间 `elite/level` 覆盖。
- 通用设置保留设施筛选和“显示无可用技能干员”开关，有技能节点干员改用固定档位按钮：1/2 星为 `1级/30级`，3 星为 `精英0/精英1`，4-6 星为 `精英0/精英1/精英2`；当前练度文字和无节点提示保持原样。
- 共享练度工具按当前设施技能链节点生成模拟器菜单；低星精0节点投影为 `1级`，真实等级节点投影为 `30级`，会客室等级节点不再被特殊逻辑排除。既有档案和房间状态不主动迁移。
- 本轮验证通过 `npm run lint`、`npm run format:check`、`npm run type-check`、`npm run build` 和 `git diff --check`；浏览器验证了空槽位/头像名称编辑、旧状态输入移除和右键菜单打开。开发环境视口异常导致子菜单无法用真实坐标 hover，已用 DOM 事件验证渲染。

## 本轮头像等比缩小输出宽度

- 头像生成器新增「输出尺寸 → 输出宽度」数字输入框：留空表示原始尺寸，`:min="1"`、`:max="180"`，输入框下方说明「按原始尺寸 180px 等比缩小，最大 180px；留空表示原始尺寸。」
- 等比参数落在共享层 `src/utils/operatorAvatarLayout.ts`：新增 `OPERATOR_AVATAR_SOURCE_WIDTH`、`normalizeOperatorAvatarOutputWidth`、`getOperatorAvatarScale`、`getScaledOperatorAvatarLength`、`getOperatorAvatarProportionalNameMetrics`；`OperatorAvatarRenderOptions` 与 `OperatorAvatarGenerationOptions` 新增可选 `outputWidth`，缺省即原始尺寸，当前只有头像生成器传值。
- 生成语义为严格等比：先在素材原始尺寸合成完整画布（含名称栏、遮罩、职业/精英化/星级徽标），再整块画布按 `outputWidth / naturalWidth` 重采样；目标宽度等于素材宽度时跳过重采样，输出与改动前完全一致。
- 分层预览与整合预览显示要求完全一致：都按输出宽度 1:1 显示，不再写死 180；`OperatorAvatarDisplay` 新增默认关闭的 `proportionalLayout`，开启时名称栏高度、字号、水平内边距与三类徽标尺寸改为「按素材宽度取整后再乘缩放比」，绕开 `nameMinHeight` 与 `nameMinFontSize` 下限，与 Canvas 结果几何一致；该开关默认关闭，未开启时渲染算法与改动前完全一致。
- 预览元信息新增「输出 宽 × 高 px」；下载文件名在精英化与心情之后追加宽度（如 `能天使-精英2-96.png`），留空时文件名保持原样。
- 未做：放大输出（素材仅 180×180）、把宽度参数接入技能生成器或其他 DOM 调用方、修正 `prts`/`yuanyuan3060` 数据源缺失头像目录的问题。
- 风险：页面预览尺寸与界面标签按常量 `OPERATOR_AVATAR_SOURCE_WIDTH = 180` 推算，Canvas 与分层预览本身按真实 `naturalWidth` 缩放；素材尺寸若变化需同步该常量与标签。宽度为 1 至 2 时分层名称栏受最小高度下限影响，与导出高度相差 1px。
- 已验证 `npm run lint`、`npm run format:check`、`npm run type-check`、`npm run build`、`git diff --check` 通过（构建仅保留既有大 chunk 警告）；等比换算经 Node 脚本核对，宽度 ≥ 3 时 Canvas 输出高度与分层预览高度逐像素相等。浏览器界面未在本轮实测。
- 环境记录：本沙箱下 `npm run build` 因 Vite `windowsSafeRealPathSync` 经管道派生 `cmd` 被拒（spawn EPERM），需更宽权限执行；用 PowerShell `Get-Content -Raw` + `Set-Content` 回写文件会破坏中文编码，本轮曾损坏 `AvatarGeneratorPage.vue` 并从 git 恢复，后续统一使用编辑工具修改文件。
- 三处其他头像显示调用点已统一启用等比渲染（方案 B）：`src/components/OperatorSkillCard.vue`（`size=112`）、`src/pages/SettingsPage.vue`（`size=56`）、`src/pages/SimulatorPage.vue`（`size=72`）各增加 `:proportional-layout="true"`，尺寸数字与 CSS 均未修改。
- 可见变化：技能卡与设置页只显示徽标，取整方式变化但视觉几乎无差异；模拟器槽位显示干员名称，名称栏由固定 36px 变为 14px、字号由约 25px 变为约 10px，槽位高度由 72×108 变为 72×86。
- 未采用：三处共用一个输出宽度值会与既有「宽度参数不持久化」决策冲突，且一个值无法同时适配 72px 槽位与 112px 卡片网格；尺寸可配置需要新增设置项、存储与区间钳制。二者将来若实施，必须先处理 `main.css` 中写死的容器：`.simulator-slot` 72px（`1761-1766`）、`.operator-card .ant-card-body` 网格 112px（`959-961`）、`.operator-avatar-placeholder` 112px（`983`）、窄屏 144px（`2442-2444`）。
- 提交注意：`SimulatorPage.vue` 工作区仍有其他未提交改动，本次仅把本行通过 `git apply --cached` 定向暂存后提交，未连带提交他人改动。

## 本轮头像显示尺寸可配置

- 新增共享设置 `src/composables/useAvatarDisplaySizes.ts`：以 `riic-tools:avatar-display-sizes:v1` 持久化三个显示宽度，默认 56（设置页练度卡片）、90（排班模拟器设施槽位）、112（基建技能一览与技能生成器卡片）；读取时逐字段做类型与区间校验，非法值回退默认，写入失败时保留内存值。
- 通用设置页新增「头像显示尺寸」卡片（位于「设施背景颜色」与「本地数据」之间）：三个 `a-input-number`（`addon-after="px"`，`:min`/`:max` 取自选项表）与「恢复默认尺寸」按钮，清空输入回落到该处默认值，说明文字标注每处默认值与可设置区间。
- 可设置区间：练度卡片 40–96、模拟器槽位 48–120、技能卡 72–144，超出即钳制，避免撑坏固定容器。
- 容器同步：`OperatorAvatarDisplay` 的 `:size` 与容器尺寸都由该设置驱动；`main.css` 中 `.operator-card .ant-card-body` 首个网格轨道、`.operator-avatar-placeholder`、窄屏覆盖、`.simulator-slot` 与 `.simulator-slot-input` 改用 `var(--operator-card-avatar-size, 112px)` 与 `var(--simulator-slot-size, 90px)`，变量由 `OperatorSkillCard.vue` 与 `SimulatorPage.vue` 的 `.simulator-slot-grid` 内联提供，沿用既有 `--simulator-column-width` 模式。
- 关键修复：模拟器设施卡片宽度原先由 TS 常量 `SIMULATOR_SLOT_WIDTH = 72` 计算并写入 `--simulator-column-width`，而设施卡片带 `overflow: hidden`；只改 CSS 槽位宽度会让末尾槽位被裁切。现 `facilityCardWidth` 直接读取当前设置的槽位宽度，该常量已删除。
- 行为变化：技能卡窄屏（≤600px）原先把头像图片强制为 144px，与 112px 画框叠加造成横向拉伸；现改为跟随配置值，拉伸消失，窄屏默认回到 112px。
- 保存与清除：该设置随「清除本地数据」一并清除（该按钮调用 `localStorage.clear()`），清除后恢复 56/90/112。
- 未做：不提供「三处共用一个宽度」模式；不改头像生成器的导出宽度（仍由该页「输出宽度」单独控制）；不加数值以外的预设档位。
- 风险：模拟器槽位宽度直接影响设施卡片宽度与横向滚动范围，超过 120 会明显挤压同排设施；技能卡宽度超过 144 会挤压干员名与技能列。基建技能一览与技能生成器共用同一组件，因此技能生成器导出的卡片布局也会随该设置变化。
- 已验证 `npm run lint`、`npm run format:check`、`npm run type-check`、`npm run build` 通过（构建仅保留既有大 chunk 警告）；浏览器界面未在本轮实测。

## 本轮名称栏显示下限

- 背景：等比渲染后名称栏高度随宽度缩小（模拟器槽位 72 时为 14px），头像底边到名字的距离由约 10.75px 降到 2.5px，观感上像名字贴在头像上。
- 实测：用 Headless Edge 以 4× 渲染模拟器真实 DOM 并逐像素扫描，确认文字在其框内**本来就是居中的**（中心偏差 ≤0.75px，且略偏下）；改用 flex 居中与 `line-height` 居中结果逐像素相同。因此问题在框体高度，不在居中方式。
- 决定：名称栏高度与字号增加输出空间下限，`OPERATOR_AVATAR_LAYOUT` 新增 `nameOutputMinHeight: 24` 与 `nameOutputMinFontSize: 12`；头像主体仍严格等比，两个下限只作用于名称栏。
- 实现：共享层新增 `getOperatorAvatarNameMinBandMetrics`（框高与默认字号）与 `getOperatorAvatarNameMaxTextWidth`；`getOperatorAvatarProportionalNameMetrics` 复用前者并对实测字号取下限。Canvas 端由「整体合成后重采样」改为「头像主体等比重采样 + 名称栏按输出尺度单独绘制」，使下限在导出图上同样生效并与 DOM 几何一致；`drawOperatorAvatarName` 改为接收输出空间的名称度量。
- 数值：输出宽度/槽位 48–120 时名称栏恒为 24px、字号 12–17px；144 时 29px/20px；180（原始尺寸）时 36px/25px，与改动前完全一致。DOM 总高与 Canvas 总高在所有宽度上相等。
- 兼容性影响：模拟器槽位总高由 86px 变为 96px；头像生成器输出高度随之变化（96 宽由 96×115 变为 96×120），预览元信息标签同步为 `宽 × 高 px`。
- 已知差异：字号触到 12px 下限后长名字更容易超出可用宽度，此时 Canvas 横向压缩字形、DOM 显示省略号，该既有差异未在本轮处理。
- 已验证 `npm run lint`、`npm run format:check`、`npm run type-check`、`npm run build` 通过（构建仅保留既有大 chunk 警告）；Headless Edge 4× 像素测量确认两条路径文字中心偏差均为 +0.5px，槽位 72 时上下留白 6.75/5.75px（Canvas 7/6px）。

## 本轮名称最大字号规则

- 名称最大字号改为按宽度决定：`max(12, round(宽度 / 6))`，即 180px 输出时 30px、正好放下 6 个中文字符；字符更多时沿用原有逐像素收缩（源尺度测量），直到 12px 下限。
- 新增常量 `OPERATOR_AVATAR_LAYOUT.nameFitCharacterCount: 6`，替换原 `nameFontRatio: 0.7`（原规则把最大字号绑在名称栏高度上，180px 时只有 25px）。`getOperatorAvatarNameFontSize` 的入参由名称栏高度改为宽度。
- 收缩的可用宽度由「宽度 − 24px 内边距」改为整幅宽度：6 个字在 30px 下正好等于 180px，内边距会把它判为放不下。因此 `nameHorizontalPadding` 已删除，`getOperatorAvatarNameMaxTextWidth` 不再需要，Canvas 直接以输出宽度作为 `fillText` 的压缩上限。
- 收缩结果（180px 输出，中文按 1em 计算）：1–6 字 = 30px；7 字 = 25；8 字 = 22；9 字 = 20；12 字 = 15；14 字起 = 12（下限）；16 字以上放不下，Canvas 压缩字形、DOM 显示省略号。
- 其他宽度的最大字号：96 → 16、120 → 20、144 → 24、180 → 30；48/56/72 → 12（受 12px 下限保护）。名称栏高度不受本次改动影响（仍为 180 时 36px、小宽度下限 24px）。
- 实测（Headless Edge 4× 像素扫描）：6 字在 180px 输出下 Canvas 与 DOM 的墨迹均为高 28.75px、宽 178px、左右各 1px 留白、无省略号；对照把同一名字放到 31px 时 DOM 出现 4.5px 的省略号空隙，说明检测有效。
- 已验证 `npm run lint`、`npm run format:check`、`npm run type-check`、`npm run build` 通过（构建仅保留既有大 chunk 警告）。

## 本轮名称收缩与边距修正（覆盖前两节的字号与边距规则）

- 修正「长名字出现省略号、字号不缩小」：名称栏与字号此前各有 12px 下限（`nameMinFontSize`、`nameOutputMinFontSize`），当下限大于「放得下所需字号」时名字必然溢出（例如 72px 槽位里 7 个字的可用宽度只有 62.4px，而 12px 字号需要 84px），于是 DOM 显示省略号、字号也停在下限不再缩小。现删除这两个字号下限，收缩循环一路降到 1px，任何长度都能放下、不再出现省略号。
- 恢复左右边距设置：重新加入 `OPERATOR_AVATAR_LAYOUT.nameHorizontalPadding: 24`（左右合计）并恢复 `getOperatorAvatarNameMaxTextWidth`；可用文字宽 = `输出宽度 − 24 × 缩放比`。DOM 名称 span 增加同比例的 `padding-inline`（项目全局 `box-sizing: border-box`，外框宽度不变），使 DOM 与 Canvas 的可用宽度与左右留白一致。
- 字号改为完全在输出尺度计算：`getOperatorAvatarProportionalNameMetrics` 直接用输出宽度取上限 `round(宽度 / 6)` 并在输出尺度测量收缩，去掉了「源尺度测量 → 缩放 → 取整」这一步，避免取整造成的偶发溢出。名称栏高度下限 `nameOutputMinHeight: 24` 保留不变。
- 数值（中文按 1em）：180px 输出下 1–5 字 30px、6 字 26px、7 字 22px、8 字 19px、12 字 13px、20 字 7px；72px 槽位下 1–5 字 12px、6 字 10px、7 字 8px、12 字 5px。两者都满足「放得下」。
- 代价：名字很长时字号很小，而名称栏高度下限不变，因此上下留白会变大（180px 输出、20 字时为 7px 字号、上下各约 14.7px）。**已确认：接受名字很长时字号很小，名称栏高度下限 `nameOutputMinHeight: 24` 保持不变、不跟随字号。**
- 实测（Headless Edge 4× 像素扫描）：180px 输出 8 字，DOM 与 Canvas 墨迹分别为高 18.25/18px、宽 151/150.25px，左右留白 14.5/14.5 与 14.75/15，均无省略号；72px 槽位 7 字为 8px 字号、左右留白 8.25/8.5、无省略号；对照（180px 下把 8 字强行放到 22px）出现左侧 12.75/右侧 19.5 的不对称留白与 271.5px 处的空隙，确认省略号检测有效。
- 已验证 `npm run lint`、`npm run format:check`、`npm run type-check`、`npm run build` 通过（构建仅保留既有大 chunk 警告）。

## 本轮设施区队列卡片与干员槽位改造

- 队列小卡片不再常驻产物/原料下拉与「跳过」勾选框，三者全部移入右键菜单，卡片只保留「干员头像 + 名称 + 效率」；删除 `min-height: 224px`，卡片高度贴合内容并天然等高。
- 右键菜单合并为一个浮层：干员槽位右键先显示「心情 `0/12/24（默认）`、练度档位、恢复默认练度」，再用分割线接上该槽位所在房间的设施项「跳过、产物、原料」；设施区空白处（卡片底部留白、效率行）与空槽位右键只显示设施项。发电站合并卡片按房间分组，组标题为「发电站 1」…，只有一个房间时用 `.simulator-context-menu--flat` 隐藏组标题。
- 设施项受「编辑产物」开关约束：关闭时菜单只保留「跳过」；「跳过」不受开关限制。产物项沿用 `productOptions()`（贸易站 龙门币/合成玉，制造站 赤金/作战记录/源石碎片），原料项仅在产物为源石碎片时出现。
- 卡片宽度改为「干员槽位总宽 + 留白」，删除 `SIMULATOR_FACILITY_MIN_WIDTH = 224`；留白与产物图标样式由通用设置新增的「设施卡片」卡片控制（`riic-tools:facility-card-settings:v1`，默认「宽松 40px + 右下角小图标」）。紧凑档位同时把 `.simulator-facility-queues` 内边距收到 2px，否则槽位总宽会超过卡片被 `overflow: hidden` 裁切。
- 卡片背景产物图标：贸易站/制造站取 `room.product`，发电站固定无人机、会客室固定信用点、办公室固定招聘许可，宿舍与控制中枢不显示；图标取自 `public/assets/raw/item_icon/`，映射表为 `src/utils/schedule.ts` 的 `PRODUCT_ITEM_ICONS` / `ROOM_ITEM_ICONS`，三种呈现（右下角 0.8 倍 15%、居中水印 2 倍 8%、左上角 24px 30%）由设置选择，以 `z-index: -1` 位于槽位内容之下。
- 「跳过」表现：房间被跳过且该房间至少有一名干员时，`OperatorAvatarDisplay` 新增的 `skipped` 覆盖层（`z-index: 3`，高于徽标）连同星级/精英化/职业徽标一起变灰，头像中央显示白字黑底「跳过」；该房间的空槽位把「空槽位」替换为「跳过」。默认未排班房间仍显示「空槽位」，避免新文档里 `skip: true` 覆盖空槽位提示。
- 效率行改为卡片内居中（去掉右对齐与上方分割线，上内边距 8px → 2px），数值写法 `+x / y%` 与 16px 字号不变。
- 干员名称改为原地编辑：点击槽位后头像保持显示，名称位置叠加无圆角输入框（`a-auto-complete`，白底 1px 边框，几何与名称栏一致），自动聚焦并全选现有名称；补全按已输入文字子串过滤（`filterOperatorOption`），选中补全项立即提交（`selectOperatorName`，修正原实现点选补全项后不提交的问题）；回车/失焦提交、Escape 取消、重复干员校验沿用原实现。`OperatorAvatarDisplay` 新增 `nameEditing` 隐藏名称文字避免与输入文字重叠。
- 空槽位不再使用 `a-avatar`：改为普通容器（无圆角、`padding-inline: 4px`、灰色底），文字单行省略号，字号按 `getOperatorAvatarNameFontSize(槽位尺寸)`（72px 槽位为 12px）与干员名一致。
- 设施卡标题：控制中枢与发电站不再显示等级标签（等级固定 5/3），发电站「合并显示」标签删除，其他设施保留 Lv 标签；标题按可用宽度估算缩小字号（下限 11px），仍放不下时标题行允许换行（等级标签折到下一行）再由省略号兜底。
- 布局编辑：控制中枢、发电站等级改为只读文本「Lv5」「Lv3」；其他设施等级输入框 `:min` 改用 `roomLevelRange().min`（原为硬编码 `1`，可点出非法等级再报错）；`MaaSchedulePage.vue` 两处硬编码 `control/dormitory ? 5 : 3` 统一到 `roomLevelRange()`。
- 读取历史排班文档时先按固定等级归一化（`normalizeLayoutLevels`，含结构防御）再校验，避免 `control≠5` / `power≠3` 的旧文档被 `isStoredDocument` 静默丢弃，并显示「已把 N 份排班表中…修正为固定等级」提示。
- 已知未修（用户决定）：产物↔设施约束仍只在 UI 层，计算层不校验；手改或导入 JSON 把贸易站设成制造站产物会静默按龙门币计算，把制造站设成龙门币/合成玉会静默无产出。
- 已知差异：`MaaSchedulePage.vue` 切换产物时不清 `sourceMaterial`、`productOptions` 缺少「未指定产物」空选项，与模拟器页不一致（对非源石碎片产物的计算无影响）。
- 风险：产物图标是背景水印，「右下角小图标」档位会被不透明的空槽位方块遮住大半，需要「居中水印」档位才能看清全貌。
- 验证：`npm run lint`、`npm run format:check`、`npm run type-check`、`npm run build` 通过（构建仅保留既有大 chunk 警告）；Playwright 浏览器实测覆盖卡片宽度与标题字号、效率居中、空槽位外观、三种图标档位、合并右键菜单、发电站分组菜单、原地编辑与补全过滤、跳过灰显、编辑产物开关联动、固定等级归一化提示。

## 本轮设施区卡片尺寸校正与右键菜单收敛

- 新建房间不再写 `skip: true`：`createDefaultRoomAssignment` 只保留产物、`createEmptySchedule` 的控制中枢房间改为 `{}`、`MaaSchedulePage` 房间类型切换回退改为 `{}`；因此「跳过」展示条件回归为 `room.skip === true`，删除了上一轮为规避默认 `skip` 而加的「且房间有干员」补丁。
- 右键菜单移除「未指定产物」与「未指定原料」两项，产物只列该设施可选项（`productOptions()` 过滤掉空值项）。
- 右键菜单尺寸与对齐：菜单项 40px → 28px、字号 14px → 12px、去掉 antd 的 4px 外边距、菜单宽度 156px → 140px；干员项与设施项统一使用 `.simulator-context-menu-marker`（固定 14px + 6px 间隔）作为行首，内边距统一 10px，分组项内边距需用 `.simulator-context-menu .ant-menu .ant-menu-item-group-list .ant-menu-item` 覆盖 antd 的 `padding-inline-start: 28px`（同级特异性会被 antd 运行时样式覆盖）。
- 右键菜单不再超出视口底部：`clampContextMenuPosition()` 在菜单渲染后按真实高度把顶部夹到 `innerHeight - height - 8`（实测 562px 高菜单顶部被正确夹到 224px）。
- 卡片宽度改为固定开销：`FACILITY_CARD_HORIZONTAL_OVERHEAD = 29`（列 gutter 10 + 队列区 16px 内边距 + 边框），删除「卡片宽度留白」设置与 `paddingKey`/`queuesPadding` 参数及 `--simulator-facility-queues-padding` 变量；右侧空白条由 11.33px 收到 0.33px。
- 卡片等高：新增 `--simulator-queue-min-height`（槽位高度 + 名称栏 24 + 39）同时作用于 `.simulator-facility-queue` 与 `.simulator-queue-info`，删除 224px 最小高度；效率行改为始终渲染并给 `.simulator-efficiency-summary-line` 加 `min-height: 25px`，使无计算结果的卡片也有同样高度。实测队列信息卡与所有设施队列卡均为 135px、设施卡均为 197.33px。
- 空槽位改为「方形框体 + 下方名称栏」：框体 72×72、无圆角、`padding` 取消；名称栏与干员名同高（24px）同字号（12px）并与名称输入框几何一致；点击框体或名称栏都可进入原地编辑，修掉「点击空槽位下方无法编辑」的问题。
- 设施卡标题不再换行：`flex-wrap: nowrap`，可用宽度改为 `卡片宽度 − 34`（卡头内边距 24 + 列 gutter 10，上一轮漏算 gutter 导致窄卡仍被截断）；放不下时依次缩小字号（下限 11px）、压缩与等级标签的间距（下限 4px）、把等级标签从 12px/10px/9px 逐档缩小；同时清除 antd tag 自带的 `margin-inline-end: 8px`（否则宽度永远差 8px 被截断）。实测办公室、加工站为 11px 标题 + 9px 标签，恰好放下且无截断。
- 删除产物图标「左上角」档位与 `fixedSize` 参数，剩余「右下角小图标」「居中水印」两档（`useFacilityCardSettings` 只保留 `iconStyle`）。
- 已知行为：清空某设施全部干员时仍会写 `skip: true`（既有逻辑），此时该房间空槽位显示「跳过」。
- 验证：`npm run lint`、`npm run format:check`、`npm run type-check`、`npm run build` 通过（构建仅保留既有大 chunk 警告）；Playwright 实测卡片宽度/高度/标题截断、空槽位点击进入编辑、菜单项集合与行首对齐、菜单底部夹取、通用设置只剩两档图标样式、新建设施房间不含 `skip`。

## 本轮空槽位跳过表现与卡片高度再压缩

- 空槽位框体保持无文字的灰色方块（曾短暂在框内显示「空槽位」，已按要求撤销）；房间被跳过时框体使用与干员完全相同的表现——复用 `OperatorAvatarDisplay` 的 `.operator-avatar-skipped-overlay` 覆盖层与 `.operator-avatar-skipped-label`（白字黑底「跳过」）标签，名称栏统一显示「空槽位」，与干员「头像显示跳过、名称显示姓名」的结构保持一致。
- 跳过标签字号抽到共享层 `getOperatorAvatarSkippedLabelFontSize`，`OperatorAvatarDisplay` 与模拟器空槽位共用，避免公式重复。
- 效率行压缩：`.simulator-efficiency-summary` 上内边距 2px → 0、`.simulator-efficiency-summary-line` 的 `min-height` 25px → 20px 并设 `line-height: 1.2`、队列卡内容 gap 4px → 2px；`QUEUE_MIN_HEIGHT_EXTRA` 39 → 30，队列卡高度 135px → 126px。
- 修掉行高不一致的真实原因：左侧「队列信息」内卡片的内容天生比设施队列卡高 5.28px（把 `.simulator-queue-info` 内边距 10px → 8px、gap 6px → 5px 后落回共用的 `--simulator-queue-min-height` 内），此前它会把同排的设施卡一起撑高（控制中枢卡 193.61px 而其他排 188.33px）；实测队列信息卡与 7 张设施队列卡全部 126px，外层卡片全部 188.33px（改动前 197.33px）。
- 验证：`npm run lint`、`npm run format:check`、`npm run type-check`、`npm run build` 通过；浏览器实测点击框内「空槽位」文字与被跳过空槽位的「跳过」标签都能进入原地编辑。
- 按要求清理了本会话在代码里写的解释性注释（`AGENTS.md` 规定不在代码中写注释），说明性内容统一放在 `CONTEXT.md` 与 `docs/decision-log.md`；仅保留 3 处 `catch` 块内的注释（`SimulatorPage.vue`、`useFacilityCardSettings.ts`、`useScheduleDocuments.ts`），因为 ESLint 的 `no-empty` 不允许空 `catch` 块。

## 本轮效率显示格式更新

- 已完成：设施队列卡片干员下方的效率改为「组合效率% / 总效率%」；非负数不显示 `+`，负数显示 `-`，并通过 `formatEfficiencyNumber` 处理 `-0` 边界。
- 已完成：计算步骤中的「组合效率」同步补上 `%` 并使用相同的无正号格式；其他材料、技能明细和容量增量仍保留原有的 `signedNumber` 展示规则。
- 已完成：效率汇总文本设置 `white-space: nowrap`、可收缩宽度和溢出隐藏，并根据当前队列槽位总宽与格式化后的文本长度动态缩小字号，默认 16px，最小 8px。
- 未完成：仓库没有现成的效率显示自动化测试，本轮未新增测试文件；已用本地浏览器检查实际卡片文本与计算步骤，并完成静态检查和生产构建。
- 风险：极端超长的效率数值达到 8px 最小字号时仍可能因实际字体宽度与估算值存在差异而接近或触发裁切；正常效率范围已通过当前卡片布局验证。
- 验证：`npm run lint`、`npm run format:check`、`npm run type-check`、`npm run build` 和 `git diff --check` 均通过；构建仅保留既有的大 chunk 警告。下一步如效率数值范围扩大，应补充长数字和负数的浏览器自动化覆盖。

## 本轮排班模拟器设施槽位默认尺寸

- 已完成：排班模拟器设施槽位的默认显示宽度由 72px 调整为 90px，允许范围保持 48–120px。
- 已完成：首次读取、恢复默认尺寸和清除本地数据后均使用 90px；已保存的用户自定义槽位尺寸不主动覆盖。
- 未完成：未新增自动化测试。
- 风险与下一步：90px 会按现有逻辑同步增加设施卡片宽度、槽位高度和横向滚动范围，无额外已知风险。
- 验证：`npm run lint`、`npm run format:check`、`npm run type-check`、`npm run build` 和 `git diff --check` 均通过；构建仅保留既有的大 chunk 警告。

## 本轮排班模拟器队列信息显示更新

- 队列信息改为固定三行：第一行队列名称，第二行队列持续时间，第三行队列描述；移除原先编辑态的分钟输入和额外小时摘要行。
- 页面显示与编辑统一使用小时，范围为 1–24 小时，不设置固定小数位；`Plan.duration` 继续以分钟保存，输入值保存时四舍五入为整分钟，兼容既有排班 JSON、Maa 导入导出和效率计算。
- 编辑态和只读态的对应字段统一使用相同字号、字重和颜色；编辑态保留输入框边界和队列操作按钮，关闭编辑时隐藏交互和操作按钮。
- 空名称和空描述继续分别显示「未命名队列」和「未填写描述」；本轮未修改 Maa 排班页面。
- 风险与下一步：既有超出 1–24 小时范围的分钟数据不会在读取时主动迁移，进入编辑并提交后才按页面范围钳制；当前仓库没有针对队列 UI 和时长换算的自动化测试。
- 验证：`npm run lint`、`npm run format:check`、`npm run type-check`、`npm run build` 和 `git diff --check` 通过；浏览器实测三行布局、编辑/只读切换、`8.5` 小时显示和对应文字样式，构建仅保留既有的大 chunk 警告。

## 本轮小时输入格式修正

- 已删除小时输入的固定 `precision` 和 `step` 设置；输入不补零，回显时对整分钟换算结果最多保留两位小数，避免出现 `12.666666...`，输入 `12` 显示 `12`，输入 `7.5` 显示 `7.5`。
- 小数小时仍按现有 `Plan.duration` 分钟字段保存，提交时只将小时换算并四舍五入到整分钟，不限制用户输入的小数位数。
- 当小时值无法精确换算为整分钟时，页面弹出警告并明确显示最终保存的分钟数。
- 验证：浏览器重新加载后实测输入框真实值为 `12` 和 `7.5`，均无尾随零；`12.67` 会提示将按 760 分钟保存并回显为 `12.67`，`12.5` 不会误报；类型检查、构建和差异检查通过，Lint/格式检查受当前工作区其他未提交操作员批量操作改动影响，构建仅保留既有的大 chunk 警告。

## 当前工作区验证状态

- 本轮队列小时修正已提交为 `a1fdbad`；本次提交未包含操作员批量操作或槽位样式的未提交改动。
- 当前工作区的 `npm run type-check` 未通过，错误位于未暂存的操作员撤销/重做代码：`OperatorHistoryEntry` 与 `ScheduleDocument` 在 `SimulatorPage.vue:2409`、`SimulatorPage.vue:2418` 不匹配；本轮队列时长改动不在这些差异中。
- `npm run build` 的 Vite 构建阶段成功，但因并行的 `type-check` 失败而整体退出；`git diff --cached --check` 和提交前的 `git diff --check` 通过。
- 下一步：修正操作员历史类型后重新运行完整类型检查、Lint 和格式检查；该问题不影响本轮已提交的整分钟转换警告逻辑。
