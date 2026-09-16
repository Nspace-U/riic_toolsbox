# Maa 排班 JSON 导出兼容性审计

## 核查信息

- 核查日期：2026-09-17
- 核查范围：当前项目的 `ScheduleDocument`、`StoredDocument` 和 `serializeMaaSchedule`
- 主要代码：`src/adapters/maaSchedule.ts`、`src/types/schedule.ts`、`src/utils/schedule.ts`
- Maa 参考：[基建排班协议](https://raw.githubusercontent.com/MaaAssistantArknights/MaaAssistantArknights/dev-v2/docs/zh-cn/protocol/base-scheduling-schema.md)、[maa-infra.schema.json](https://raw.githubusercontent.com/MaaAssistantArknights/MaaAssistantArknights/dev-v2/docs/maa-infra.schema.json)

## 结论

当前 Maa 导出采用“深拷贝排班文档，再删除和转换少数字段”的策略，不是按 Maa 协议白名单重新构造 JSON。因此：

- 排班文档中的大部分未知字段都会被原样带入导出文件。
- 明确不会导出的主要是房间描述、空槽位占位、菲亚梅塔内部配置和部分外层存储元数据。
- `layout`、计算用 `settings`、`operatorStates`、`sourceMaterial` 和 `training` 等内容会进入导出文件，但不属于 Maa 原生基建排班协议。
- Maa schema 与协议文档并不完全一致，`processing`、`description_post`、`groups` 等字段虽然未完整出现在 schema 中，但协议文档明确说明了它们的用途。

## 导出流程

`serializeMaaSchedule` 的处理顺序如下：

1. 校验原始 `ScheduleDocument`。
2. 使用 `cloneSchedule` 深拷贝文档。
3. 将百分比干员和术语干员映射为 Maa 可识别的真实干员名称。
4. 删除内部菲亚梅塔字段和部分房间字段。
5. 将项目内部的中文产物名转换为 Maa 产物名。
6. 对处理后的对象执行 `JSON.stringify`。

因为没有最终字段白名单，`ScheduleDocument`、`Plan` 和 `RoomAssignment` 中的开放字段都会参与导出。

## 未导出的排班数据

### 房间描述

房间描述由 TXT 导入器写入 `room.description`，Maa 协议没有房间级描述字段。

当前序列化行为有一个条件边界：

- 房间存在 `operators` 数组时，`room.description` 会被删除。
- 房间没有 `operators` 数组时，序列化代码会提前返回，`room.description` 不会被删除，仍可能进入 JSON。

因此，“有干员的房间描述通常不导出”，但“只有描述、没有干员字段的房间描述”目前仍可能导出。

### 空槽位占位

内部排班允许使用空字符串保存槽位位置，例如：

```json
{
  "operators": ["甲", "", "乙"]
}
```

导出时会过滤空字符串，结果变为：

```json
{
  "operators": ["甲", "乙"]
}
```

如果过滤后没有干员，`operators` 字段也会被删除。Maa 文件只保存紧凑的干员列表，不保存内部空槽位位置。

### 菲亚梅塔内部配置

当前项目使用根级 `document.fiammetta` 保存模拟器内部配置，导出时会删除该字段，并转换成每个计划的 Maa `Fiammetta` 字段。

转换不是完整无损的：

- 按队列模式每个计划只读取对应队列中的第一个非空目标。
- 直接模式按计划序号读取目标，超过计划数量的目标不会导出。
- 导出的 `Fiammetta.order` 固定为 `"pre"`。
- 没有有效目标时不写入计划级 `Fiammetta`。
- `importFiammetta` 临时标记不会导出。
- 旧版 `settings.featherFixedOps` 和 `settings.featherTargets` 会在克隆时删除。

计划级 `Fiammetta` 本身是 Maa 协议支持的字段；丢失的是当前项目的内部结构、额外目标以及非 `pre` 的配置。

### `StoredDocument` 外层元数据

以下字段位于 `StoredDocument`，不在 `StoredDocument.document` 内，因此不会进入 Maa JSON：

| 字段             | 用途                   |
| ---------------- | ---------------------- |
| `id`             | 项目内部排班表 ID      |
| `inferredLayout` | 是否由导入内容推断布局 |
| `sourceFileName` | 原始文件名             |
| `createdAt`      | 创建时间               |
| `updatedAt`      | 修改时间               |
| `tags`           | 用户标签               |
| `hiddenAutoTags` | 隐藏的自动标签         |

模拟器编辑开关和通用设置保存在独立的浏览器 `localStorage` 中，也不属于 Maa JSON。

## 导出但 Maa 原生协议不支持的数据

### 根级字段

| 字段       | 当前用途                                                 | Maa 协议状态                 |
| ---------- | -------------------------------------------------------- | ---------------------------- |
| `layout`   | 保存设施类型、等级、顺序，供当前模拟器布局和电力计算使用 | 协议未定义，Maa 不依赖该字段 |
| `settings` | 保存当前项目的效率计算设置                               | 协议未定义，Maa 不会使用     |

当前 `settings` 中可能出现的项目专用字段包括：

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

其中 `lmdDroneStrategy` 是当前计算器的龙门币无人机策略，不等价于 Maa 支持的 `plans[].drones`。将它写入 `settings` 不会让 Maa 执行该策略。

### 房间字段

| 字段             | 当前用途                                   | Maa 协议状态                                          |
| ---------------- | ------------------------------------------ | ----------------------------------------------------- |
| `operatorStates` | 保存干员的心情、精英化等级、等级等计算输入 | 协议未定义，Maa 不会读取                              |
| `sourceMaterial` | 区分源石碎片配方使用固源岩或装置           | 协议未定义，Maa 只识别 `Originium Shard` 产物         |
| `description`    | 保存设施组合描述                           | 房间级描述未定义；通常会在有 `operators` 数组时被删除 |

### 训练室

当前项目的 `ROOM_KEYS` 包含 `training`，因此训练室布局和计划中的训练室房间会被深拷贝并导出。

但 Maa 基建排班协议文档列出的房间类型包含 `processing`，没有 `training`。因此 `training` 是当前项目导出的非 Maa 原生房间字段，Maa 不应依赖它执行换班。

## Maa 协议支持且当前会保留的字段

以下字段不应误判为项目自定义字段：

| 位置     | 字段                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------- |
| 根级     | `title`、`description`、`plans`                                                                           |
| 计划级   | `name`、`description`、`description_post`、`period`、`duration`、`Fiammetta`、`drones`、`groups`、`rooms` |
| 房间级   | `operators`、`sort`、`skip`、`autofill`、`product`、`candidates`、`use_operator_groups`                   |
| 房间类型 | `control`、`trading`、`manufacture`、`power`、`meeting`、`hire`、`dormitory`、`processing`                |

补充说明：

- `duration` 在 Maa 协议中是保留字段，当前 Maa 文档说明暂时没有实际作用。
- `drones.rule` 也是保留字段，当前协议文档说明暂时没有实际作用。
- `Dualchip` 是 Maa 支持的制造产物。当前项目不参与其制造计算，但导入后会原样保留并导出。
- 官方 schema 没有列出 `processing`、`description_post`、`groups` 和 `use_operator_groups`，但协议文档明确列出这些字段，因此以协议文档作为兼容性判断依据。

## 未列入 schema 但可能被原样保留的字段

解析器使用根对象展开创建 `ScheduleDocument`，序列化器又对文档进行深拷贝。因此，从其他 Maa 文件导入的未知根级字段也可能被原样写回。

本机 Maa 自带的 `resource/custom_infrast` 文件中可见以下元数据：

```text
author
id
buildingType
planTimes
scheduleType
```

这些字段没有出现在协议的完整字段示例或 schema 中，但确实存在于 Maa 自带排班文件中，更适合归类为 Maa 文件元数据或兼容字段，而不是直接判定为当前项目私自导出的不支持字段。

## 代码依据

- [src/adapters/maaSchedule.ts:272](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:272)：导出入口。
- [src/adapters/maaSchedule.ts:279](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:279)：删除内部菲亚梅塔字段。
- [src/adapters/maaSchedule.ts:283](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:283)：删除计划级旧菲亚梅塔并清理房间。
- [src/adapters/maaSchedule.ts:294](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:294)：删除房间描述并压缩空槽位。
- [src/adapters/maaSchedule.ts:303](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:303)：生成计划级菲亚梅塔配置。
- [src/adapters/maaSchedule.ts:312](/D:/Game/明日方舟/基建工具箱/src/adapters/maaSchedule.ts:312)：转换内部产物名为 Maa 产物名。
- [src/types/schedule.ts:1](/D:/Game/明日方舟/基建工具箱/src/types/schedule.ts:1)：当前设施类型列表。
- [src/types/schedule.ts:31](/D:/Game/明日方舟/基建工具箱/src/types/schedule.ts:31)：房间数据契约及开放字段。
- [src/types/schedule.ts:63](/D:/Game/明日方舟/基建工具箱/src/types/schedule.ts:63)：项目专用排班设置。

## 验证

- `npm run test:schedule-import`：通过。
- 额外构造包含 `layout`、`settings`、`operatorStates`、`sourceMaterial`、`training`、房间描述和菲亚梅塔配置的排班文档进行序列化，确认上述字段保留、删除和转换行为。
