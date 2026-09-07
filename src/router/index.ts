import { createRouter, createWebHistory } from 'vue-router'

import BasicCalculatorPage from '@/pages/BasicCalculatorPage.vue'
import OperatorSkillsPage from '@/pages/OperatorSkillsPage.vue'
import ScheduleCalculatorPage from '@/pages/ScheduleCalculatorPage.vue'
import ScheduleReferencePage from '@/pages/ScheduleReferencePage.vue'
import SettingsPage from '@/pages/SettingsPage.vue'
import SimulatorPage from '@/pages/SimulatorPage.vue'
import AvatarGeneratorPage from '@/pages/AvatarGeneratorPage.vue'
import MaaSchedulePage from '@/pages/MaaSchedulePage.vue'
import SkillGeneratorPage from '@/pages/SkillGeneratorPage.vue'
import ToolboxPage from '@/pages/ToolboxPage.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/simulator',
    },
    {
      path: '/simulator',
      name: 'simulator',
      component: SimulatorPage,
      meta: { title: '排班模拟器' },
    },
    {
      path: '/schedule-calculator',
      name: 'schedule-calculator',
      component: ScheduleCalculatorPage,
      meta: { title: '排班表计算器' },
    },
    {
      path: '/schedule-reference',
      name: 'schedule-reference',
      component: ScheduleReferencePage,
      meta: { title: '排班表参考' },
    },
    {
      path: '/basic-calculator',
      name: 'basic-calculator',
      component: BasicCalculatorPage,
      meta: { title: '基础计算器' },
    },
    {
      path: '/operator-skills',
      name: 'operator-skills',
      component: OperatorSkillsPage,
      meta: { title: '基建技能一览' },
    },
    {
      path: '/toolbox',
      name: 'toolbox',
      component: ToolboxPage,
      meta: { title: '工具箱' },
    },
    {
      path: '/toolbox/avatar',
      name: 'toolbox-avatar',
      component: AvatarGeneratorPage,
      meta: { title: '头像生成器' },
    },
    {
      path: '/toolbox/skill',
      name: 'toolbox-skill',
      component: SkillGeneratorPage,
      meta: { title: '技能生成器' },
    },
    {
      path: '/toolbox/maa-schedule',
      name: 'toolbox-maa-schedule',
      component: MaaSchedulePage,
      meta: { title: 'Maa 排班表接口' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsPage,
      meta: { title: '通用设置' },
    },
  ],
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : '基建工具箱'
  document.title = `${title} - 基建工具箱`
})

export default router
