# Maa 排班 JSON 导出兼容性审计

## 核查信息

- 核查日期：2026-09-20
- 核查范围：当前 Maa JSON 导入、排班文档模型和 `serializeMaaSchedule` 导出链路
- 主要代码：`src/adapters/maaSchedule.ts`、`src/types/schedule.ts`、`src/utils/schedule.ts`
- Maa 参考：[基建排班协议](https://raw.githubusercontent.com/MaaAssistantArknights/MaaAssistantArknights/dev-v2/docs/zh-cn/protocol/base-scheduling-schema.md)、[maa-infra.schema.json](https://raw.githubusercontent.com/MaaAssistantArknights/MaaAssistantArknights/dev-v2/docs/maa-infra.schema.json)

## 结论

当前导出不是按 Maa 字段白名单重新构造 JSON，而是对排班文档执行深拷贝后进行局部清理、映射和补默认值。因此：

- 排班文档中的根级、计划级、房间级和布局条目中的未知字段，原则上都会被原样保留。
- 明确不会原样导出的内容包括：已知设施房间的 `description`、干员数组中的空字符串槽位、项目内部的菲亚梅塔配置、旧版菲亚梅塔设置字段、`StoredDocument` 外层元数据和浏览器本地编辑设置。
- `layout`、`settings`、`operatorStates`、`sourceMaterial`、`training` 以及其他开放字段可能进入输出，但不是 Maa 原生排班协议字段。
- 特殊干员占位符、产物名称和菲亚梅塔配置会被转换，不保证保留项目内部的原始表示。
- Maa 协议正文支持的字段比官方 schema 更完整；`processing`、`description_post`、`groups` 和 `use_operator_groups` 应按协议正文判断为 Maa 字段，而不是项目自定义字段。

## 当前导出流程

`serializeMaaSchedule` 的实际顺序如下：

1. 校验原始 `ScheduleDocument`。
2. 通过 `cloneSchedule` 使用 JSON 深拷贝创建副本，同时删除旧版 `settings.featherFixedOps` 和 `settings.featherTargets`。
3. 将百分比干员和已加载术语干员映射为具体干员名称，并同步迁移对应的 `operatorStates`。
4. 删除根级内部菲亚梅塔字段和计划原有的 `Fiammetta` 字段。
5. 删除已知设施房间的 `description`，压缩 `operators` 中的空字符串；数组为空时删除 `operators` 字段。
6. 从项目内部菲亚梅塔配置为每个计划生成 Maa `Fiammetta`。
7. 为源石碎片制造站补充默认 `sourceMaterial`，再把项目内部中文产物名转换为 Maa 产物名。
8. 再次校验并执行 `JSON.stringify`。

导出入口没有最终字段白名单。`ScheduleDocument`、`Plan`、`RoomAssignment` 和 `LayoutEntry` 都允许开放字段，所以只要字段仍在传入的文档对象中，就可能被写入 JSON。

## 排班表中不会原样导出的数据

### 房间描述

当前类型契约已不再定义 `RoomAssignment.description`，TXT 导入器也会忽略设施队列行中 `|` 后的说明文本。对于旧数据或外部 JSON 中仍存在的字段，Maa 导入和导出都会删除已知设施类型下房间对象的 `description`，包括没有 `operators` 的空房间。

这里的“已知设施类型”指当前 `ROOM_KEYS`：`control`、`trading`、`manufacture`、`power`、`meeting`、`hire`、`processing`、`training`、`dormitory`。未知的 `rooms` 子键不经过这项清理，不能把它们当作 Maa 兼容字段。

### 空槽位位置

内部排班可以用空字符串保留槽位位置：

```json
{
  "operators": ["甲", "", "乙"]
}
```

导出后会变成：

```json
{
  "operators": ["甲", "乙"]
}
```

如果数组中全是空字符串，整个 `operators` 字段会被删除。因此空槽位的位置和“明确没有干员字段”这两种状态不会被 Maa JSON 保留。

### 项目内部菲亚梅塔配置

项目使用根级 `document.fiammetta` 保存模拟器配置，导出时删除该字段，只按当前设置转换为计划级 Maa `Fiammetta`：

- `queue` 模式按计划索引读取对应项的第一个非空干员。
- `direct` 模式按计划索引读取 `direct.operators`，超出计划数量的目标不会导出。
- 没有有效目标时不生成该计划的 `Fiammetta`。
- 生成的字段固定为 `{ "enable": true, "target": "...", "order": "pre" }`。
- 原有计划级 `Fiammetta` 会先删除；如果根级内部配置没有对应目标，原字段也不会恢复。
- 根级 `importFiammetta` 不导出。

因此 Maa 的计划级 `Fiammetta` 字段本身受协议支持，但内部队列结构、额外目标、禁用状态和 `post` 顺序不会按原样保留。

### 旧版内部字段

`cloneSchedule` 会删除以下旧版设置字段，即使它们通过开放字段存在于输入文档中：

- `settings.featherFixedOps`
- `settings.featherTargets`

### 特殊干员占位符

导出时，百分比干员和在效率目录中识别到的术语干员会替换为具体的 Maa 干员名称。对应的 `operatorStates` 键也会同步替换。项目内部的占位符名称和原槽位表示不会出现在最终 JSON 中。

### 外层存储元数据和本地设置

导出函数接收的是 `StoredDocument.document`，不会接收 `StoredDocument` 外层字段，因此以下内容不会进入 Maa JSON：

| 字段                     | 用途                     |
| ------------------------ | ------------------------ |
| `id`                     | 项目内部排班表 ID        |
| `inferredLayout`         | 是否由导入内容推断布局   |
| `sourceFileName`         | 原始文件名               |
| `createdAt`、`updatedAt` | 创建和更新时间           |
| `tags`、`hiddenAutoTags` | 用户标签和隐藏的自动标签 |

模拟器编辑开关等浏览器 `localStorage` 设置也不在 `ScheduleDocument` 内，不会导出。

## 导出到 JSON 但 Maa 协议不支持的内容

### 项目根级字段

| 字段       | 当前作用                                                 | Maa 协议状态           |
| ---------- | -------------------------------------------------------- | ---------------------- |
| `layout`   | 保存设施类型、等级和顺序，用于模拟器布局、电力和容量计算 | 协议未定义，Maa 不依赖 |
| `settings` | 保存计算、菲亚梅塔和无人机策略等项目设置                 | 协议未定义，Maa 不读取 |

当前 `settings` 允许的项目字段为：

```text
clueExchanging
dormFullTreat
fiammettaMode
fiammettaDirectCount
preferMaxJieEfficiency
lmdDroneStrategy
orderProgress
overflowMode
firstItemProgress
```

其中 `lmdDroneStrategy` 是模拟器的龙门币无人机策略，不等价于 Maa 的 `plans[].drones`。项目不会把该设置自动转换成 Maa 无人机配置。

### 房间级项目字段

| 字段             | 当前作用                             | Maa 协议状态                             |
| ---------------- | ------------------------------------ | ---------------------------------------- |
| `operatorStates` | 保存心情、精英化等级和等级等计算输入 | 未定义，Maa 不读取                       |
| `sourceMaterial` | 区分源石碎片配方使用固源岩或装置     | 未定义，Maa 只识别产物 `Originium Shard` |

`sourceMaterial` 对源石碎片制造站缺失时会自动补为 `固源岩`，所以 Maa 导入后再导出可能新增这个项目字段。

### `training` 房间

当前 `ROOM_KEYS` 包含 `training`，布局和计划中的训练室房间会随深拷贝进入输出。Maa 协议正文的房间类型包含 `processing`，不包含 `training`；因此 `training` 是当前项目导出的非 Maa 房间字段，Maa 不应依赖它执行换班。

### 开放字段和未知房间类型

以下对象使用开放字段签名，当前导出器没有白名单过滤：

- 根对象中的未知字段；
- `plans[]` 中的未知字段；
- `layout[]` 条目中的未知字段；
- 已知房间对象中的未知字段；
- `plans[].rooms` 下未知房间类型的数组及其内容。

这些字段只要通过输入校验或没有触发明确清理，就可能被原样导出。它们不能因为当前 JSON 文件能够生成，就被视为 Maa 支持字段。

## Maa 支持且当前会保留的字段

以下列表以 Maa 协议正文为准：

| 位置     | 支持字段                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------- |
| 根级     | `title`、`description`、`plans`                                                                           |
| 计划级   | `name`、`description`、`description_post`、`period`、`duration`、`Fiammetta`、`drones`、`groups`、`rooms` |
| 房间级   | `operators`、`sort`、`skip`、`autofill`、`product`、`candidates`、`use_operator_groups`                   |
| 房间类型 | `control`、`manufacture`、`trading`、`power`、`meeting`、`hire`、`dormitory`、`processing`                |

补充说明：

- `duration` 是 Maa 保留字段，协议正文说明当前没有实际作用。
- `drones.rule` 是 Maa 保留字段，协议正文说明当前没有实际作用。
- `Dualchip` 是 Maa 支持的制造产物。项目当前不参与其制造计算，但适配器不会把它误转换成其他产物，导入后可原样写回。
- 官方 `maa-infra.schema.json` 目前未列出 `processing`、`description_post`、`groups` 和 `use_operator_groups`；协议正文明确列出这些字段，因此本审计以协议正文作为协议兼容性判断依据，同时将 schema 差异视为校验工具的限制。

## Maa 导入后再导出的额外变化

当输入 Maa JSON 缺少项目内部需要的字段时，导入流程会先补齐，再由导出流程写回：

| 输入情况                          | 再导出时的变化                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| 根级没有 `layout`                 | 根据计划房间数量、干员数量和电力规则推断并写出 `layout`，同时补齐推断布局对应的房间数组 |
| 没有 `settings`                   | 导入时创建 `settings.fiammettaMode = "queue"`，再导出该项目字段                         |
| 计划存在 Maa `Fiammetta`          | 导入到根级内部 `fiammetta.queue`，导出时按项目设置重新生成 `Fiammetta`                  |
| 源石碎片房间没有 `sourceMaterial` | 补为 `固源岩` 后导出                                                                    |
| Maa 产物名是 `LMD`、`Orundum` 等  | 导入时转为项目内部中文名，导出时转回 `LMD`、`Orundum` 等；未知产物名保持原值            |

因此，Maa JSON 的“导入后再导出”不是字节级或字段级无损往返；它是经过项目内部排班模型规范化后的重新序列化。

## 代码依据

- [src/adapters/maaSchedule.ts:150](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:150)：Maa JSON 解析入口。
- [src/adapters/maaSchedule.ts:158](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:158)：判断输入是否带有 `layout`。
- [src/adapters/maaSchedule.ts:162](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:162)：缺少 `layout` 时推断布局。
- [src/adapters/maaSchedule.ts:174](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:174)：导入时清理已知房间的 `description`。
- [src/adapters/maaSchedule.ts:175](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:175)：Maa 产物名转换为项目内部名称。
- [src/adapters/maaSchedule.ts:176](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:176)：将计划级菲亚梅塔导入项目内部配置。
- [src/adapters/maaSchedule.ts:177](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:177)：补充源石碎片的默认 `sourceMaterial`。
- [src/adapters/maaSchedule.ts:186](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:186)：特殊干员映射入口。
- [src/adapters/maaSchedule.ts:289](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:289)：Maa JSON 导出入口。
- [src/adapters/maaSchedule.ts:296](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:296)：删除项目内部菲亚梅塔字段。
- [src/adapters/maaSchedule.ts:301](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:301)：清理计划菲亚梅塔并处理房间字段。
- [src/adapters/maaSchedule.ts:311](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:311)：删除房间描述并压缩空槽位。
- [src/adapters/maaSchedule.ts:328](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:328)：生成计划级 Maa `Fiammetta`。
- [src/utils/schedule.ts:860](/D:/Game/明日方舟/基建工具箱/src/utils/schedule.ts:860)：深拷贝排班并删除旧版菲亚梅塔设置。
- [src/types/schedule.ts:1](/D:/Game/明日方舟/基建工具箱/src/types/schedule.ts:1)：当前房间类型列表。
- [src/types/schedule.ts:31](/D:/Game/明日方舟/基建工具箱/src/types/schedule.ts:31)：房间数据契约和开放字段。
- [src/types/schedule.ts:63](/D:/Game/明日方舟/基建工具箱/src/types/schedule.ts:63)：项目排班设置字段。

## 验证

- `npm run test:schedule-import`：通过，覆盖房间描述清理、产物映射、`sourceMaterial` 默认值和特殊干员导出。
- 额外构造包含未知根级、计划级、房间级字段、未知房间类型、`training`、旧版菲亚梅塔设置和缺少 `layout` 的 Maa JSON 进行导入再导出，确认开放字段保留、已知房间描述清理、布局补全、设置补全和训练室输出行为。
- 官方协议正文与 `maa-infra.schema.json` 已重新读取；协议正文列出的 `processing`、`description_post`、`groups`、`use_operator_groups` 在 schema 中缺失，文档已按协议正文归类。
