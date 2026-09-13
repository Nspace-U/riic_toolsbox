# 干员技能 JSON 规范

本文件定义当前项目的干员基建技能中间数据格式。生成器把 Torappu 的技能描述解析成可供未来效率计算器消费的结构化效果；它不是旧项目 JSON 的兼容层。

## 1. 生成方式

运行：

```bash
npm run generate:operator-skills
```

生成脚本为 `scripts/generate-operator-skills.mjs`，覆盖表为 `scripts/operator-skill-overrides.mjs`。

脚本只读取当前项目的 Torappu 三份快照：

| 数据           | 文件                                                       | 用途                                  |
| -------------- | ---------------------------------------------------------- | ------------------------------------- |
| 干员与技能引用 | `public/assets/gamedata/latest/excel/character_table.json` | 干员名、技能槽、解锁条件、技能定义 ID |
| 技能描述       | `public/assets/gamedata/latest/excel/building_data.json`   | 房间、技能名、富文本描述              |
| 术语           | `public/assets/gamedata/latest/excel/gamedata_const.json`  | 阵营、基地点数、设施集合、技能集合    |
| 心情检查       | `public/skill-mood-check.json`                             | 按技能下发 `moodCheck: true`          |

旧项目的 CSV、`ctrl-skill-map.js`、旧项目 `index.json` 均不参与运行。

输出目录为 `public/assets/operator-skills/`。每名有当前范围技能的干员生成一个 `{干员ID}.json`，不生成 `index.json`。再次生成时会清理该目录中的 JSON 后重建。

加工站和训练室技能作为**来源房间**暂不生成，也不会为此输出警告。控制中枢技能跨设施作用到训练室的效果可以保留在 JSON 中，供未来训练室模块使用。

## 2. 顶层结构

```json
{
  "id": "char_4064_mlynar",
  "name": "玛恩纳",
  "chains": [
    {
      "slot": 2,
      "room": "control",
      "stages": [
        {
          "unlock": { "type": "elite", "value": 2 },
          "name": "公事公办",
          "effects": []
        }
      ]
    }
  ]
}
```

### 2.1 顶层字段

| 字段     | 类型   | 说明                                       |
| -------- | ------ | ------------------------------------------ |
| `id`     | string | Torappu 干员 ID，例如 `char_4064_mlynar`   |
| `name`   | string | 干员中文名，仅用于展示和人工阅读           |
| `chains` | array  | 技能链列表。每个 `(room, slot)` 对应一条链 |

### 2.2 chain 字段

| 字段     | 类型   | 说明                                 |
| -------- | ------ | ------------------------------------ |
| `slot`   | number | 技能槽位，从 1 开始                  |
| `room`   | string | 技能的来源设施，使用当前项目设施 key |
| `stages` | array  | 同一槽位按解锁条件排序的阶段         |

当前项目设施 key：

| key           | 设施              |
| ------------- | ----------------- |
| `control`     | 控制中枢          |
| `trading`     | 贸易站            |
| `manufacture` | 制造站            |
| `power`       | 发电站            |
| `meeting`     | 会客室            |
| `hire`        | 办公室/人力办公室 |
| `dormitory`   | 宿舍              |

`processing`（加工站）和 `training`（训练室）已保留为数据层可识别的设施 key，但当前不会作为来源房间生成技能链。

### 2.3 stage 字段

| 字段      | 类型   | 说明                                                         |
| --------- | ------ | ------------------------------------------------------------ |
| `unlock`  | object | 解锁条件                                                     |
| `name`    | string | 技能名，来自当前 Torappu 快照                                |
| `effects` | array  | 该阶段解析出的效果；没有可计算数值但有可展示语义时也应有记录 |

`unlock.type` 当前为：

- `elite`：`value` 为精英阶段，`0`、`1`、`2`。
- `level`：`value` 为等级，例如 `30`。

## 3. effect 通用结构

一个效果至少包含 `target` 和 `stat`，然后在 `value`、`per`、`curve` 三者中选择一种数值形式。条件和叠加规则按需要附加。

```json
{
  "target": "trading",
  "stat": "tradeSpd",
  "value": 25,
  "condition": {
    "type": "opInBase",
    "op": "伺夜"
  }
}
```

### 3.1 target

`target` 表示效果最终作用的设施，不一定等于所在 chain 的 `room`。

允许值为当前设施 key，以及：

- `any`：不限制作用设施，由 `facilities`、`scope` 或计算器上下文进一步限定。
- `training`：控制中枢技能对未来训练室模块的跨设施效果。

当 `target` 是 `any` 且效果只对一组设施生效时，使用 `facilities` 数组。控制中枢的 `部分设施`、`其他设施`、`工作场所` 数组从 `gamedata_const.json` 的术语描述动态展开，不从旧项目映射表读取。

### 3.2 stat

当前生成器使用的属性包括：

| stat               | 含义                  | 备注                                        |
| ------------------ | --------------------- | ------------------------------------------- |
| `tradeSpd`         | 贸易站订单获取效率    | 百分比数值                                  |
| `manuProd`         | 制造站生产力          | 百分比数值，可带 `recipe`                   |
| `clueSpeed`        | 会客室线索搜集速度    | 百分比数值                                  |
| `clueChance`       | 线索获取倾向/概率语义 | 仅展示，不参与百分比效率                    |
| `hireSpd`          | 办公室联络速度        | 百分比数值                                  |
| `droneCharge`      | 发电站无人机充能速度  | 百分比数值                                  |
| `orderLimit`       | 贸易站订单上限        | 数值，非百分比                              |
| `storageCap`       | 制造站仓库容量        | 格数                                        |
| `moodRecover`      | 心情恢复速度          | 每小时                                      |
| `moodCost`         | 心情消耗修正          | 正数表示额外消耗，负数表示减少消耗          |
| `facilityCount`    | 设施数量计数          | 不改变实际设施，只供其他效果读取            |
| `basePointGain`    | 基地点数产出          | 必须配 `term`                               |
| `basePointConvert` | 基地点数派生增益      | 使用 `from`、`to`、`rate`；保留 `from` 点数 |
| `tradeOrder`       | 贸易站订单规则        | 使用 `order` 对象                           |
| `zeroOpMood`       | 消除技能心情消耗      | 由未来心情计算器解释                        |
| `zeroOpBonus`      | 其他干员效率归零      | 可配 `except`                               |
| `facBase`          | 设施基础效率层效果    | 当前主要由未来训练室跨设施效果使用          |
| `abyssalBoost`     | 深海猎人特殊制造加成  | 歌蕾蒂娅特殊规则                            |
| `moodSwap`         | 心情互换规则          | 记录规则，不直接换算效率                    |
| `skillTagConvert`  | 技能类别转换          | 使用 `tagFrom`、`tagTo`                     |

`clueChance` 效果只表达线索倾向，不参与效率百分比计算。派系线索倾向使用 `cluePreference` 保存线索编号；尚未拥有和已经拥有的线索分别使用字符串值 `unowned` 与 `owned`。`text` 保存统一后的显示文案：

```json
{
  "target": "meeting",
  "stat": "clueChance",
  "text": "更容易获得线索1",
  "cluePreference": 1
}
```

```json
{
  "target": "meeting",
  "stat": "clueChance",
  "text": "更容易获得尚未拥有的线索",
  "cluePreference": "unowned"
}
```

```json
{
  "target": "meeting",
  "stat": "clueChance",
  "text": "更容易获得已经拥有的线索",
  "cluePreference": "owned"
}
```

线索编号固定为：莱茵生命 1、企鹅物流 2、黑钢国际 3、乌萨斯学生自治团 4、格拉斯哥帮 5、喀兰贸易 6、罗德岛制药 7。办公室等其他设施来源的线索效果同样统一为会客室的 `clueChance` 展示效果。

### 3.3 value、per、curve

固定效果使用 `value`：

```json
{ "target": "trading", "stat": "tradeSpd", "value": 25 }
```

线性效果使用 `per`：

```json
{
  "target": "meeting",
  "stat": "clueSpeed",
  "per": {
    "per": 1,
    "value": 4,
    "cap": 20,
    "capUnit": "value",
    "source": "opGroupInBase",
    "group": "cc.g.minos"
  }
}
```

| per 字段    | 说明                                                                                    |
| ----------- | --------------------------------------------------------------------------------------- |
| `per`       | 每多少个单位触发一次                                                                    |
| `value`     | 每档数值                                                                                |
| `cap`       | 可选上限                                                                                |
| `capUnit`   | `count` 表示计数上限；`value` 表示最终加成上限                                          |
| `source`    | 计数来源，见下表                                                                        |
| `group`     | 阵营/标签术语 key                                                                       |
| `term`      | 基地点数或其他术语 key                                                                  |
| `facility`  | 计数所查设施；具体 `target` 的 `same` 为目标设施，`any` 的 `same` 为施放者设施          |
| `stat`      | `source` 为 `stat`/`facCap` 时所读取的属性                                              |
| `other`     | 是否排除技能拥有者自身                                                                  |
| `floor`     | 是否按完整档位取整；普通 `per` 默认取整，`source=facCap` 默认连续比例，需用 `true` 覆盖 |
| `moodCheck` | 该计数是否只统计心情大于 0 的干员                                                       |

当前出现的 `source` 包括：

| source                       | 含义                                       |
| ---------------------------- | ------------------------------------------ |
| `basePoint`                  | 按某个 `term` 的基地点数存量计数           |
| `baseFacilityWithGroup`      | 基建内包含某阵营干员的设施数量             |
| `facilityCount`              | 某类设施数量                               |
| `facilityLevel`              | 某类设施等级总和                           |
| `facilityLevelTotal`         | 全基建设施等级总和                         |
| `ownLevel`                   | 当前设施等级                               |
| `trainLevel`                 | 训练室等级                                 |
| `dormLevel`                  | 宿舍等级总和                               |
| `dormHere` / `dormOccupants` | 宿舍人数                                   |
| `recruitSlots`               | 办公室招募位数量，不含初始招募位           |
| `opCount`                    | 设施内干员数量                             |
| `opGroupInBase`              | 基建内某阵营干员数量                       |
| `opGroupInFacility`          | 某设施内某阵营干员数量                     |
| `skillOwners`                | 当前 `cc.c.skill` 术语列出的技能拥有者数量 |
| `skillTagCount`              | 当前设施内某技能类别数量                   |
| `stat`                       | 读取其他干员提供的属性总量                 |
| `facCap` / `capTier`         | 按仓库容量加成计数                         |
| `manuRecipes`                | 当前加工中的制造配方类别数                 |
| `moodDrop`                   | 自身心情落差                               |
| `orderCount`                 | 当前贸易站订单数，孑的特殊技能使用         |
| `orderLimitNet`              | 贸易站订单上限净增量                       |
| `droneLimit`                 | 无人机上限                                 |
| `abyssalBoost`               | 深海猎人特殊加成计数                       |

时间曲线使用 `curve`：

```json
{
  "target": "manufacture",
  "stat": "manuProd",
  "curve": {
    "type": "ramp",
    "startValue": 0,
    "startHours": 1,
    "step": 1,
    "cap": 15
  }
}
```

`ramp` 的第 `h` 小时值为 `min(startValue + (h - startHours) * step, cap)`，具体平均工作时长和跨队列累计规则由未来计算器实现。

### 3.4 设施、范围和叠加

这些字段描述“效果给谁”和“效果怎么合并”：

| 字段         | 取值/说明                                                     |
| ------------ | ------------------------------------------------------------- |
| `scope`      | `self` 自身、`room` 同设施、`op` 指定干员；缺省由效果类型决定 |
| `op`         | `scope: op` 时的干员名                                        |
| `scopeGroup` | 受影响的阵营术语 key                                          |
| `facilities` | 作用设施集合。通常与 `target: any` 搭配                       |
| `exclude`    | 从基建计数中排除的设施 key                                    |
| `subjects`   | 宿舍效果的 `single` 单体或 `spread` 均摊                      |
| `other`      | 受众/计数是否排除自身                                         |
| `stack`      | `max` 表示同组取最高；缺省表示累加                            |
| `maxGroup`   | `stack: max` 的显式分组名                                     |
| `baseValue`  | 与 `per` 共存的固定基础值，最终值为基础值加线性值             |
| `recipe`     | 制造站配方类别，例如 `贵金属`                                 |

`stack: "max"` 的含义是：先按每个目标设施、条件和 `per` 计算候选值，再在相同 `maxGroup` 中取满足条件的最大值；不能把标记为 `max` 的效果与普通效果混为一组。玛恩纳、重岳、维什戴尔针对 `部分设施/其他设施` 的心情恢复使用 `maxGroup: "otherFacRec"`，由每个设施分别取最高。

## 4. condition

条件满足时效果才生效：

```json
{
  "type": "opAtFacility",
  "op": "魔王",
  "facility": "control"
}
```

当前生成器会产生以下条件类型：

| type                     | 说明                               | 常用字段                                |
| ------------------------ | ---------------------------------- | --------------------------------------- |
| `opAtFacility`           | 指定干员在指定设施                 | `op`, `facility`, `assist`, `moodCheck` |
| `opInBase`               | 指定干员在基建内                   | `op`, 可选 `facilities`                 |
| `opInFacilityAndTarget`  | 指定干员所在设施同时是效果目标设施 | `op`, `facility`                        |
| `opGroupInFacility`      | 某阵营干员在设施内                 | `group`, `facility`, `other`            |
| `opGroupNotInFacility`   | 某阵营干员不在设施内               | `group`, `facility`                     |
| `opGroupCountInFacility` | 某设施内阵营人数达到下限           | `group`, `facility`, `min`              |
| `opGroupCountInBase`     | 基建内阵营人数达到下限             | `group`, `min`, `exclude`, `negate`     |
| `opCountInFacility`      | 某设施存在指定数量干员             | `facility`, `min`                       |
| `onlySelf`               | 设施内只有自身处于工作状态         | 无                                      |
| `clueExchanging`         | 会客室处于线索交流                 | 无                                      |
| `moodCmp`                | 自身心情比较                       | `value`, `op`                           |
| `moodDrop`               | 自身心情落差比较                   | `value`                                 |
| `termCmp`                | 两个基地点数或术语值比较           | `a`, `b`, `op`                          |
| `statCmp`                | 属性值比较                         | `stat`, `value`, `op`                   |
| `workHours`              | 工作时长达到条件                   | `value`                                 |

条件可以带 `moodCheck: true`。它表示被检查的干员心情必须大于 0；该标记只由 `public/skill-mood-check.json` 自动下发，不应在普通覆盖表中重复手写。

## 5. 术语和基地点数

技能描述中的 `<$term>名称</>` 会被清理为可读文本，同时保留术语 key。例如：

```json
{
  "target": "any",
  "stat": "basePointGain",
  "term": "cc.bd_b1",
  "per": {
    "per": 20,
    "value": 0.05,
    "source": "basePoint",
    "term": "cc.bd_b1"
  }
}
```

术语 key 必须来自当前 `gamedata_const.json`；生成器会优先使用描述中的标记，并在没有标记时按术语名反查。`basePointGain` 是直接产出，`basePointConvert` 是根据 `from` 点数按 `rate` 向 `to` 追加的派生增益，来源点数不会减少；`per.source: "basePoint"` 是消费侧。它们只记录基地点数关系，不直接当作设施百分比相加。多个派生规则按依赖顺序计算，派生结果可以继续作为下一条规则的来源。

控制中枢的设施集合术语由当前快照动态读取：

- `cc.c.room1`：部分设施。
- `cc.c.room2`：其他设施。
- `cc.c.room3`：工作场所。
- `cc.c.skill`：部分技能拥有者。

因此不应在覆盖表中为玛恩纳、重岳、维什戴尔或摆渡人重复写设施集合。

## 6. 人工覆盖边界

覆盖表只处理技能描述无法稳定表达、或者需要多个效果联合建模的规则。当前人工维护项为：

| 干员/技能             | 原因                                                       |
| --------------------- | ---------------------------------------------------------- |
| 望·权变               | 同时生成“外势/实地”设施数量点数，并在两种结果之间二选一    |
| 孑·市井之道           | 同时读取其他干员效率和当前订单数，改变订单上限与效率       |
| 吽·坚毅随和           | 描述省略了鲤氏额外恢复的数值和作用范围                     |
| 歌蕾蒂娅·潮汐守望     | 深海猎人计数、宿舍满心情计数和反向条件需要联合表达         |
| 歌蕾蒂娅·集群狩猎·α/β | 深海猎人特殊制造加成没有直接数值结构                       |
| 琴柳·感染力           | 需要先比较办公室已有联络速度，再决定是否加入最高值组       |
| 摩根·头号陪练         | “某个干员”与格拉斯哥帮受众、同设施推进之王条件需要组合表达 |

摆渡人、贝洛内、娜斯提不在覆盖表：它们的效果可以从当前技能描述、术语和普通 `per`/`condition` 规则稳定生成。

## 7. 校验要求

提交生成结果前至少执行：

```bash
node --check scripts/generate-operator-skills.mjs
npm run generate:operator-skills
```

应满足：

- 退出码为 0，警告为 0；
- 输出目录存在 345 个当前快照干员 JSON（数量随快照变化）；
- 不存在 `public/assets/operator-skills/index.json`；
- 来源 `room` 不包含 `processing` 或 `training`；
- `moodCheck` 只来自 `public/skill-mood-check.json`；
- 控制中枢设施集合使用当前快照术语展开，且效果 key 使用当前项目命名。
