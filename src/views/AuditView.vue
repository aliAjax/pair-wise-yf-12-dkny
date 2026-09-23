<script setup lang="ts">
import { computed, ref } from "vue";
import { AUDIT_ACTION_LABEL, type AuditAction, type AuditEntry } from "../service/audit";
import { productName } from "../data/seed";
import type { ProductCode } from "../domain/types";
import { useDispatchStore } from "../store/dispatch";
import { datetime } from "../utils/format";

const store = useDispatchStore();
const actionFilter = ref<AuditAction | "all">("all");
const keyword = ref("");

const actionOptions = computed(() =>
  (Object.keys(AUDIT_ACTION_LABEL) as AuditAction[]).map((action) => ({
    label: AUDIT_ACTION_LABEL[action],
    value: action
  }))
);

const ACTION_TYPE: Record<AuditAction, "danger" | "info" | "primary" | "success" | "warning"> = {
  dispatch_rejected: "danger",
  order_created: "info",
  order_departed: "warning",
  order_received: "success",
  order_rejected: "danger",
  order_cancelled: "info"
};

const visibleEntries = computed(() =>
  store.audit.filter((entry) => {
    if (actionFilter.value !== "all" && entry.action !== actionFilter.value) return false;
    if (keyword.value.trim()) {
      const kw = keyword.value.trim();
      const hay = `${entry.refCode} ${entry.operator} ${JSON.stringify(entry.detail)}`;
      if (!hay.includes(kw)) return false;
    }
    return true;
  })
);

function summary(entry: AuditEntry): string {
  const d = entry.detail;
  if (entry.action === "dispatch_rejected") {
    const errors = (d.errors as string[]) ?? [];
    return errors.length ? errors[0] : "调度申请被退回";
  }
  if (entry.action === "order_created") {
    const req = d.request as
      | { fromStationId?: string; toStationId?: string; productCode?: ProductCode; planQty?: number }
      | undefined;
    return req
      ? `计划 ${req.planQty ?? 0}L · ${productName(req.productCode as ProductCode)}`
      : "调度单创建";
  }
  if (entry.action === "order_departed") return "在途量开始同时占用两边仓位";
  if (entry.action === "order_received") {
    const s = d.settlement as { actualQty?: number; lossQty?: number; lossReason?: string | null };
    return s
      ? `实收 ${s.actualQty ?? 0}L${s.lossQty ? `，损耗 ${s.lossQty}L：${s.lossReason ?? ""}` : "，无损耗"}`
      : "卸油签收";
  }
  if (entry.action === "order_rejected") return `拒收，占用释放：${d.reason ?? ""}`;
  if (entry.action === "order_cancelled") return `取消，占用释放：${d.reason ?? ""}`;
  return "";
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>调度存证</h2>
      <p class="hint">
        库存/罐容判定、发车、签收、损耗、拒收、取消的每一步都写入不可变流水（含判定快照与数量变动），仅追加、不修改。
      </p>
    </div>

    <div class="audit-toolbar">
      <el-radio-group v-model="actionFilter" size="small">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button v-for="opt in actionOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </el-radio-button>
      </el-radio-group>
      <el-input v-model="keyword" placeholder="搜索单号 / 操作人 / 内容" clearable style="width: 260px" size="small" />
    </div>

    <el-empty v-if="visibleEntries.length === 0" description="暂无存证记录" />

    <el-timeline v-else class="audit-timeline">
      <el-timeline-item
        v-for="entry in visibleEntries"
        :key="entry.id"
        :type="ACTION_TYPE[entry.action]"
        :timestamp="`${datetime(entry.at)} · ${entry.operator}`"
      >
        <el-card shadow="never" class="audit-card">
          <div class="audit-head">
            <el-tag :type="ACTION_TYPE[entry.action]" size="small">{{ AUDIT_ACTION_LABEL[entry.action] }}</el-tag>
            <span class="audit-code">{{ entry.refCode }}</span>
          </div>
          <p class="audit-summary">{{ summary(entry) }}</p>
          <el-collapse>
            <el-collapse-item title="查看完整存证明细（判定快照 / 库存变动 / 原因）">
              <pre class="audit-json">{{ JSON.stringify(entry.detail, null, 2) }}</pre>
            </el-collapse-item>
          </el-collapse>
        </el-card>
      </el-timeline-item>
    </el-timeline>
  </div>
</template>

<style scoped>
.page-head h2 {
  margin: 0 0 6px;
}
.hint {
  margin: 0;
  color: #5b667a;
  font-size: 13px;
}
.audit-toolbar {
  display: flex;
  gap: 12px;
  margin: 16px 0;
  flex-wrap: wrap;
  align-items: center;
}
.audit-timeline {
  padding-left: 4px;
}
.audit-card {
  border-radius: 10px;
}
.audit-head {
  display: flex;
  gap: 10px;
  align-items: center;
}
.audit-code {
  font-weight: 700;
  font-size: 13px;
}
.audit-summary {
  margin: 8px 0 4px;
  font-size: 13px;
  color: #445069;
}
.audit-json {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  margin: 0;
}
</style>
