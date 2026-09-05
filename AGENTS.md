# 明日方舟基建工具箱

> 该项目是将明日方舟基建项目从 HTML + CSS + JS 用 Vue + TypeScript + AntDesignVue 进行的重构

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

## 提交

将对话中的修改部分提交 git
