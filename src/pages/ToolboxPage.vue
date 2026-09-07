<script setup lang="ts">
import { FileTextOutlined, PictureOutlined, ToolOutlined } from '@ant-design/icons-vue'
import { useRouter } from 'vue-router'

const router = useRouter()

function openAvatarGenerator(): void {
  void router.push('/toolbox/avatar')
}

function openMaaSchedule(): void {
  void router.push('/toolbox/maa-schedule')
}
</script>

<template>
  <div class="page-shell toolbox-page">
    <div class="page-heading">
      <div class="page-heading-icon" aria-hidden="true">
        <ToolOutlined />
      </div>
      <div class="page-heading-copy">
        <a-typography-title :level="2" class="page-title">工具箱</a-typography-title>
        <span class="page-heading-description">收纳基建之外的实用小工具</span>
      </div>
    </div>

    <section class="toolbox-section" aria-labelledby="available-tools-title">
      <div class="section-heading">
        <div>
          <span class="section-kicker">AVAILABLE TOOLS</span>
          <h3 id="available-tools-title">可用工具</h3>
        </div>
        <span class="section-count">02 项</span>
      </div>

      <div class="toolbox-grid">
        <a-card :bordered="false" class="tool-card" @click="openAvatarGenerator">
          <div class="tool-card-icon" aria-hidden="true">
            <PictureOutlined />
          </div>
          <div class="tool-card-content">
            <div class="tool-card-meta">PROFILE · 01</div>
            <h4>头像生成器</h4>
            <p>组合配色、标记与呼号，生成一张属于你的基建工具箱头像。</p>
            <a-button type="primary" @click.stop="openAvatarGenerator">
              <template #icon>
                <PictureOutlined />
              </template>
              打开工具
            </a-button>
          </div>
          <div class="tool-card-index" aria-hidden="true">01</div>
        </a-card>

        <a-card :bordered="false" class="tool-card" @click="openMaaSchedule">
          <div class="tool-card-icon tool-card-icon--maa" aria-hidden="true">
            <FileTextOutlined />
          </div>
          <div class="tool-card-content">
            <div class="tool-card-meta">PROTOCOL · 02</div>
            <h4>Maa 排班表接口</h4>
            <p>查看、编辑和导入导出 Maa 排班表 JSON，保留布局与干员状态信息。</p>
            <a-button type="primary" @click.stop="openMaaSchedule">
              <template #icon>
                <FileTextOutlined />
              </template>
              打开接口
            </a-button>
          </div>
          <div class="tool-card-index" aria-hidden="true">02</div>
        </a-card>
      </div>
    </section>
  </div>
</template>

<style scoped>
.toolbox-page {
  padding-block-end: 32px;
}

.page-heading-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.page-heading-description {
  color: #879294;
  font-size: 13px;
}

.toolbox-section {
  border-block-start: 1px solid #dfe6e4;
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding-block: 20px 16px;
}

.section-kicker {
  color: #7c8c8a;
  font-size: 10px;
  letter-spacing: 0.16em;
}

.section-heading h3 {
  margin-block: 5px 0;
  color: #253238;
  font-size: 18px;
  font-weight: 650;
}

.section-count {
  color: #879294;
  font-size: 12px;
}

.toolbox-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
  gap: 16px;
}

.tool-card {
  position: relative;
  min-height: 230px;
  overflow: hidden;
  border: 1px solid #e0e8e5;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(36, 52, 57, 0.04);
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.tool-card:hover {
  border-color: #aac5bd;
  box-shadow: 0 12px 28px rgba(36, 52, 57, 0.09);
  transform: translateY(-2px);
}

.tool-card :deep(.ant-card-body) {
  display: flex;
  min-height: 230px;
  padding: 24px;
  gap: 18px;
}

.tool-card-icon {
  display: grid;
  flex: 0 0 48px;
  place-items: center;
  width: 48px;
  height: 48px;
  color: #2f605c;
  background: #dcebe8;
  border-radius: 6px;
  font-size: 22px;
}

.tool-card-icon--maa {
  color: #7a5a2d;
  background: #f1e4cf;
}

.tool-card-content {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
}

.tool-card-meta {
  color: #93a09e;
  font-size: 10px;
  letter-spacing: 0.14em;
}

.tool-card h4 {
  margin-block: 7px 8px;
  color: #253238;
  font-size: 19px;
  font-weight: 650;
}

.tool-card p {
  max-width: 360px;
  margin-block: 0 20px;
  color: #748184;
  font-size: 13px;
  line-height: 1.7;
}

.tool-card .ant-btn {
  margin-block-start: auto;
}

.tool-card-index {
  position: absolute;
  inset-block-end: 18px;
  inset-inline-end: 22px;
  color: #e5ecea;
  font-size: 48px;
  font-weight: 700;
  line-height: 1;
}

@media (max-width: 600px) {
  .toolbox-page {
    padding-block-end: 20px;
  }

  .section-heading {
    align-items: flex-start;
  }

  .tool-card :deep(.ant-card-body) {
    min-height: 210px;
    padding: 20px;
  }
}
</style>
