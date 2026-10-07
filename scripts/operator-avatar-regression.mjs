import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileStyle } from "@vue/compiler-sfc";
import { createServer } from "vite";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import Antd from "ant-design-vue";

const vite = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
});

try {
  const { default: OperatorAvatarDisplay } = await vite.ssrLoadModule(
    "/src/components/OperatorAvatarDisplay.vue",
  );
  const operator = {
    id: "char_103_angel",
    name: "能天使",
    avatars: { elite0: "char_103_angel.png", elite1: "", elite2: "" },
    profession: "SNIPER",
    rarity: 6,
  };
  const operatorAvatar = createSSRApp({
    render: () =>
      h(OperatorAvatarDisplay, {
        eliteLevel: 0,
        operator,
        specialLabel: "能天",
      }),
  });
  operatorAvatar.use(Antd);
  const operatorHtml = await renderToString(operatorAvatar);
  assert.match(operatorHtml, /operator-avatar-base/);
  assert.doesNotMatch(operatorHtml, /operator-avatar-special-label/);

  const specialAvatar = createSSRApp({
    render: () =>
      h(OperatorAvatarDisplay, {
        eliteLevel: 0,
        specialLabel: "能天",
      }),
  });
  specialAvatar.use(Antd);
  const specialHtml = await renderToString(specialAvatar);
  assert.match(specialHtml, /operator-avatar-special-label/);
  assert.doesNotMatch(specialHtml, /operator-avatar-base/);

  const operatorAvatarStyles = compileStyle({
    source: readFileSync(
      new URL("../src/components/styles/operator-avatar.css", import.meta.url),
      "utf8",
    ),
    filename: "OperatorAvatarDisplay.vue",
    id: "data-v-operator-avatar-regression",
    scoped: true,
  }).code;
  const plainNameRule = operatorAvatarStyles.match(
    /\.operator-avatar-display--plain \.operator-avatar-display-name\[data-v-operator-avatar-regression\]\s*\{([^}]*)\}/,
  );
  assert.ok(plainNameRule);
  assert.match(plainNameRule[1], /display:\s*block/);
  assert.match(plainNameRule[1], /text-align:\s*center/);
  console.log("operator avatar regression: passed");
} finally {
  await vite.close();
}
