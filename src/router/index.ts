import { createRouter, createWebHistory } from "vue-router";
import type { RouteLocationNormalizedLoaded } from "vue-router";

import BasicCalculatorPage from "@/pages/BasicCalculatorPage.vue";
import EfficiencyCalculatorPage from "@/pages/EfficiencyCalculatorPage.vue";
import EfficiencyRankingPage from "@/pages/EfficiencyRankingPage.vue";
import OperatorSkillsPage from "@/pages/OperatorSkillsPage.vue";
import ScheduleReferencePage from "@/pages/ScheduleReferencePage.vue";
import SettingsPage from "@/pages/SettingsPage.vue";
import SimulatorPage from "@/pages/SimulatorPage.vue";
import AvatarGeneratorPage from "@/pages/AvatarGeneratorPage.vue";
import SkillGeneratorPage from "@/pages/SkillGeneratorPage.vue";
import ToolboxPage from "@/pages/ToolboxPage.vue";

function simulatorRouteProps(route: RouteLocationNormalizedLoaded): {
  initialDocumentId?: string;
} {
  const documentId = route.query.scheduleId;
  return {
    initialDocumentId: typeof documentId === "string" ? documentId : undefined,
  };
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      redirect: "/simulator",
    },
    {
      path: "/simulator",
      name: "simulator",
      component: SimulatorPage,
      props: simulatorRouteProps,
      meta: { title: "排班模拟器" },
    },
    {
      path: "/schedule-reference",
      name: "schedule-reference",
      component: ScheduleReferencePage,
      meta: { title: "排班表参考" },
    },
    {
      path: "/calculators/combination",
      name: "combination-calculator",
      component: BasicCalculatorPage,
      meta: { title: "组合计算器" },
    },
    {
      path: "/calculators/efficiency",
      name: "efficiency-calculator",
      component: EfficiencyCalculatorPage,
      meta: { title: "效率计算器" },
    },
    {
      path: "/calculators/ranking",
      name: "efficiency-ranking",
      component: EfficiencyRankingPage,
      meta: { title: "效率排名" },
    },
    {
      path: "/calculators/overflow",
      name: "overflow-calculator",
      component: BasicCalculatorPage,
      props: { mode: "overflow" },
      meta: { title: "爆仓计算器" },
    },
    {
      path: "/operator-skills",
      name: "operator-skills",
      component: OperatorSkillsPage,
      meta: { title: "基建技能一览" },
    },
    {
      path: "/toolbox",
      name: "toolbox",
      component: ToolboxPage,
      meta: { title: "工具箱" },
    },
    {
      path: "/toolbox/avatar",
      name: "toolbox-avatar",
      component: AvatarGeneratorPage,
      meta: { title: "头像生成器" },
    },
    {
      path: "/toolbox/skill",
      name: "toolbox-skill",
      component: SkillGeneratorPage,
      meta: { title: "技能生成器" },
    },
    {
      path: "/settings",
      name: "settings",
      component: SettingsPage,
      meta: { title: "通用设置" },
    },
  ],
});

router.afterEach((to) => {
  const title =
    typeof to.meta.title === "string" ? to.meta.title : "基建工具箱";
  document.title = `${title} - 基建工具箱`;
});

export default router;
