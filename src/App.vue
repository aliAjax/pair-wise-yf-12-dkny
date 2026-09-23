<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { useDispatchStore } from "./store/dispatch";
import { uiState, type TabKey } from "./composables/ui";
import StationListView from "./views/StationListView.vue";
import DispatchView from "./views/DispatchView.vue";
import OrdersView from "./views/OrdersView.vue";
import AuditView from "./views/AuditView.vue";

const store = useDispatchStore();

const tabs: { key: TabKey; label: string; desc: string }[] = [
  { key: "stations", label: "网点库存", desc: "列表与缺油预警" },
  { key: "dispatch", label: "发起补货", desc: "库存/罐容判定" },
  { key: "orders", label: "调度单跟踪", desc: "发车 · 签收 · 拒收 · 取消" },
  { key: "audit", label: "调度存证", desc: "审计流水" }
];

async function resetDemo() {
  try {
    await ElMessageBox.confirm(
      "将恢复初始网点台账，并清空全部调拨单与存证，确定继续？",
      "重置演示数据",
      { confirmButtonText: "重置", cancelButtonText: "取消", type: "warning" }
    );
  } catch {
    return;
  }
  store.resetAll();
  uiState.activeTab = "stations";
  ElMessage.success("演示数据已重置");
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 油站补货调度闭环</p>
          <h1>油站网点补货调度</h1>
          <p class="subtitle">
            缺油站从网点列表发起补货，系统先过「调出安全库存 + 调入罐容」两道闸口；车辆发出在途量双向占仓，
            签收可短收并登记损耗，取消 / 拒收立即释放。库存判定、调度存证、页面三层分离。
          </p>
        </div>
        <div class="topbar-side">
          <div class="stack">
            <span class="tag">Vue3</span>
            <span class="tag">Pinia</span>
            <span class="tag">TypeScript</span>
            <span class="tag">Element Plus</span>
          </div>
          <el-button size="small" plain class="reset-btn" @click="resetDemo">重置演示数据</el-button>
        </div>
      </header>

      <el-card shadow="never" class="nav-card">
        <el-tabs v-model="uiState.activeTab">
          <el-tab-pane v-for="tab in tabs" :key="tab.key" :name="tab.key">
            <template #label>
              <span class="nav-label">
                {{ tab.label }}
                <em class="nav-desc">{{ tab.desc }}</em>
              </span>
            </template>
          </el-tab-pane>
        </el-tabs>
      </el-card>

      <section class="content">
        <StationListView v-if="uiState.activeTab === 'stations'" />
        <DispatchView v-else-if="uiState.activeTab === 'dispatch'" />
        <OrdersView v-else-if="uiState.activeTab === 'orders'" />
        <AuditView v-else />
      </section>
    </div>
  </main>
</template>

<style scoped>
.topbar {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 24px;
  align-items: end;
  margin-bottom: 18px;
}
.topbar-side {
  display: grid;
  gap: 10px;
  justify-items: end;
}
.eyebrow {
  margin: 0 0 8px;
  color: #176b87;
  font-weight: 700;
}
h1 {
  margin: 0;
  font-size: clamp(24px, 3.4vw, 36px);
}
.subtitle {
  margin: 10px 0 0;
  max-width: 780px;
  color: #5b667a;
  line-height: 1.7;
  font-size: 14px;
}
.stack {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.tag {
  border-radius: 999px;
  background: #fff;
  border: 1px solid #d9e2ee;
  color: #445069;
  padding: 6px 10px;
  font-size: 12px;
}
.reset-btn {
  width: fit-content;
}
.nav-card {
  border-radius: 10px;
  margin-bottom: 16px;
}
.nav-card :deep(.el-tabs__header) {
  margin-bottom: 0;
}
.nav-label {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.25;
  font-style: normal;
}
.nav-desc {
  font-size: 11px;
  color: #9aa4b6;
  font-style: normal;
}
.content {
  min-height: 300px;
}
@media (max-width: 860px) {
  .app {
    padding: 18px;
  }
  .topbar {
    grid-template-columns: 1fr;
  }
}
</style>
