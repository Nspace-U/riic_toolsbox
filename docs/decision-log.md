## 2026-09-08：重构干员技能 JSON 生成链路

- **已完成**：生成器改为只读取当前 Torappu 的 `character_table.json`、`building_data.json`、`gamedata_const.json`，不再读取旧 CSV 或旧控制中枢映射表。
- **已完成**：输出改为 `public/assets/operator-skills/{干员ID}.json`，每名干员独立文件，不生成 `index.json`。
- **已完成**：当前设施 key 统一为 `control`、`trading`、`manufacture`、`power`、`meeting`、`hire`、`dormitory`；加工站和训练室来源技能暂缓且静默跳过。
- **已完成**：控制中枢的 `部分设施`、`其他设施`、`工作场所` 从当前 `gamedata_const.json` 动态展开；玛恩纳、重岳、维什戴尔的特殊比较用 `otherFacRec` 最高值组表达。
- **已完成**：普通技能优先从描述和术语自动解析；望、孑、吽、歌蕾蒂娅、琴柳、摩根等少量无法稳定推导的技能进入 `operator-skill-overrides.mjs`。
- **验证**：生成 345 名干员、661 条当前范围技能，跳过 260 条加工站/训练室来源技能，0 条警告。
- **未完成**：加工站、训练室模拟以及基于该 JSON 的完整效率计算。
