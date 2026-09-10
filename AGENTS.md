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

每次修改完成后对修改部分进行提交

Common commit types:

- `feature` - New feature
- `fix` - Bug fix
- `update` - Small updates (text changes, JSON data updates)
- `css` - Style updates
- `optimized` - Code optimization
- `refactor` - Code refactoring

## 项目协作规则

开始任务前：

- 读取 CONTEXT.md
- 读取 docs/decision-log.md 的最近内容

完成任务后：

- 更新 CONTEXT.md
- 把重要技术决定追加到 docs/decision-log.md
- 明确记录已完成、未完成、风险和下一步
- 不要把未经验证的内容写成已完成
