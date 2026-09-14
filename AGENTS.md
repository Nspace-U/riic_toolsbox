# 明日方舟基建工具箱

> 该项目是将明日方舟基建项目从 HTML + CSS + JS 用 Vue + TypeScript + AntDesignVue 进行的重构
> 基建项目路径 D:\Game\明日方舟\基建

## 目录

- src/assets/：样式、字体声明、图片和文本资源
- src/components/：通用组件
- src/composables/：组合式逻辑
- src/pages/：页面
- src/router/：路由配置
- src/utils/：纯工具函数

## 代码风格

- 使用 AntDesignVue 提供的组件，优先使用 props 控制样式，如 variant，而不是 Tailwind css 类
- 在 Vue 使用组合式 API，按照 linter 要求（vue/attributes-order）来排序属性，例如将 class 放在 label 之前
- 使用基于语义方向的 css 属性，如 margin-inline、margin-block，而不是物理方向的属性，如 margin-left、margin-top
- 总是为具名函数参数和返回值添加类型注解，返回 void 的函数不写返回类型
- 优先使用 function 关键字来定义有名字的函数，而不是使用箭头函数赋值
- 不要在代码中写注释

## 提交

每次任务完成后对增改部分进行提交

Common commit types:

- `feature` - New feature
- `fix` - Bug fix
- `update` - Small updates (text changes, JSON data updates)
- `css` - Style updates
- `optimized` - Code optimization
- `refactor` - Code refactoring

## 项目协作规则

### 文件职责

- `CONTEXT.md`
  - 保存项目稳定的领域概念、术语、业务规则和不可破坏的不变量。
  - 只保留当前仍然有效的内容。
  - 不保存任务流水账、完整修改记录或实现细节。

- `docs/decision-log.md`
  - 保存重要技术决定、变更原因和验证结果。
  - 只记录值得长期保留的决定。
  - 不在每次任务开始时读取全文。
  - 每条记录应包含日期、决定、原因、影响范围和状态。

### 任务开始时

1. 读取 `CONTEXT.md`
2. 根据当前任务确定涉及的模块和关键词
3. 只查询与当前任务相关的历史决定、模块记录和代码
4. 先确认记录内容与实际代码是否一致，再开始修改
5. 启动时不读取完整的 `docs/decision-log.md`

### 任务完成时

- 将关键内容写入 CONTEXT.md，**不写日志**
- 只有发生重要技术取舍时，才追加到 `docs/decision-log.md`
