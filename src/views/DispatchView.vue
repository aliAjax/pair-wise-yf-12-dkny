<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { PRODUCTS, productName } from "../data/seed";
import { checkFeasibility, findTank } from "../domain/inventory";
import type { ProductCode } from "../domain/types";
import { useDispatchStore } from "../store/dispatch";
import { uiState } from "../composables/ui";
import { qty } from "../utils/format";

const store = useDispatchStore();

const form = reactive<{
  fromStationId: string;
  toStationId: string;
  productCode: ProductCode | "";
  planQty: number | null;
}>({
  fromStationId: "",
  toStationId: "",
  productCode: "",
  planQty: null
});

// 从网点列表「发起补货」带入的上下文
watch(
  () => uiState.dispatchPrefill,
  (prefill) => {
    if (prefill) {
      form.toStationId = prefill.toStationId;
      form.productCode = prefill.productCode;
      form.fromStationId = "";
      form.planQty = null;
      uiState.dispatchPrefill = null;
    }
  },
  { immediate: true }
);

const toStation = computed(() => store.stationById(form.toStationId));
const fromStation = computed(() => store.stationById(form.fromStationId));

/** 调入站经营的油品（没配罐的油品不能接收） */
const toProductOptions = computed(() =>
  toStation.value
    ? PRODUCTS.filter((p) => findTank(toStation.value!, p.code))
    : PRODUCTS
);

const fromStationOptions = computed(() =>
  store.stations.filter(
    (station) => station.id !== form.toStationId && form.productCode && findTank(station, form.productCode)
  )
);

const preview = computed(() => {
  if (!fromStation.value || !toStation.value || !form.productCode) return null;
  return checkFeasibility({
    from: fromStation.value,
    to: toStation.value,
    productCode: form.productCode,
    planQty: Number(form.planQty ?? 0),
    orders: store.orders
  });
});

const maxPlanHint = computed(() => {
  if (!preview.value) return null;
  const cap = Math.min(
    Math.max(0, preview.value.snapshot.fromAvailable),
    Math.max(0, preview.value.snapshot.toRoom)
  );
  return cap;
});

const submitErrors = ref<string[]>([]);
const submitting = ref(false);

function submit() {
  submitErrors.value = [];
  if (!form.fromStationId || !form.toStationId || !form.productCode) {
    submitErrors.value = ["请完整选择调出站、调入站和油品"];
    return;
  }
  submitting.value = true;
  // 判定完全在服务端复核；前端预览仅用于辅助输入
  const result = store.dispatch({
    fromStationId: form.fromStationId,
    toStationId: form.toStationId,
    productCode: form.productCode,
    planQty: Math.round(Number(form.planQty ?? 0)),
    operator: ""
  });
  submitting.value = false;

  if (!result.ok) {
    // 需求约定：任一项不足即退回，列表和库存照旧——服务没有改动任何台账
    submitErrors.value = result.errors;
    ElMessage.error("调度申请未通过，已退回，网点列表与库存保持不变");
    return;
  }
  ElMessage.success(`调度单 ${result.order?.code} 已创建（待发车）`);
  form.fromStationId = "";
  form.planQty = null;
  uiState.activeTab = "orders";
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>发起补货调度</h2>
      <p class="hint">
        选择调出站、油品和计划量。系统先校验调出站「扣其他在途后留足安全库存」与调入站「待卸量 +
        计划量不超罐容」，任一项不足立即退回，不改动任何列表与库存。
      </p>
    </div>

    <el-card shadow="never" class="form-card">
      <el-form label-position="top" :model="form" class="dispatch-form">
        <el-form-item label="调入站（缺油站）" required>
          <el-select v-model="form.toStationId" placeholder="选择缺油网点" style="width: 100%">
            <el-option
              v-for="station in store.stations"
              :key="station.id"
              :label="`${station.name}（${station.area}）`"
              :value="station.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="油品" required>
          <el-select v-model="form.productCode" placeholder="选择油品" style="width: 100%">
            <el-option v-for="p in toProductOptions" :key="p.code" :label="p.name" :value="p.code" />
          </el-select>
          <span v-if="toStation && form.productCode && !findTank(toStation, form.productCode)" class="field-warn">
            调入站未配置该油品油罐
          </span>
        </el-form-item>

        <el-form-item label="调出站" required>
          <el-select
            v-model="form.fromStationId"
            :placeholder="form.toStationId ? '选择有可调出量的网点' : '请先选择调入站'"
            style="width: 100%"
          >
            <el-option
              v-for="station in fromStationOptions"
              :key="station.id"
              :label="`${station.name}（可调 ${qty(store.outboundAvailability(station.id, form.productCode as ProductCode))}）`"
              :value="station.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="计划量（升）" required>
          <el-input-number
            v-model="form.planQty"
            :min="1"
            :step="1000"
            style="width: 100%"
            placeholder="输入计划补货升数"
          />
          <span v-if="maxPlanHint !== null" class="field-hint">
            受两边仓位限制，本次最多可申请 <strong>{{ qty(maxPlanHint) }}</strong>
          </span>
        </el-form-item>
      </el-form>

      <el-alert
        v-for="(err, index) in submitErrors"
        :key="index"
        :title="err"
        type="error"
        :closable="false"
        show-icon
        class="error-alert"
      />

      <div v-if="preview" class="rule-panel" :class="{ pass: preview.feasible, fail: !preview.feasible }">
        <p class="rule-title">
          实时校验（提交时服务端还会再复核一次）
          <el-tag :type="preview.feasible ? 'success' : 'danger'" size="small">
            {{ preview.feasible ? "规则通过" : "规则不通过" }}
          </el-tag>
        </p>
        <div class="rule-grid">
          <div class="rule-item">
            <span class="rule-label">调出站口径</span>
            <p>
              库存 {{ qty(preview.snapshot.fromStock) }} − 其他在途
              {{ qty(preview.snapshot.fromOtherInTransit) }} − 安全库存
              {{ qty(preview.snapshot.fromSafety) }}
            </p>
            <p :class="preview.feasible ? 'ok' : 'bad'">
              扣完后最多可调出 {{ qty(preview.snapshot.fromAvailable) }}
            </p>
          </div>
          <div class="rule-item">
            <span class="rule-label">调入站口径</span>
            <p>
              罐容 {{ qty(preview.snapshot.toCapacity) }} − 库存
              {{ qty(preview.snapshot.toStock) }} − 已有待卸
              {{ qty(preview.snapshot.toPendingUnload) }}
            </p>
            <p :class="preview.feasible ? 'ok' : 'bad'">
              罐内剩余空间 {{ qty(preview.snapshot.toRoom) }}
            </p>
          </div>
        </div>
        <ul v-if="!preview.feasible && preview.errors.length" class="rule-errors">
          <li v-for="(err, i) in preview.errors" :key="i">{{ err }}</li>
        </ul>
      </div>

      <div class="form-actions">
        <el-button type="primary" :loading="submitting" @click="submit">提交补货调度</el-button>
        <span class="field-hint">提交通过后生成「待发车」调度单；车辆发出前不占用仓位。</span>
      </div>
    </el-card>
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
.form-card {
  margin-top: 16px;
  border-radius: 10px;
  max-width: 880px;
}
.dispatch-form {
  margin-top: 6px;
}
.field-warn {
  color: #c45656;
  font-size: 12px;
  margin-top: 4px;
  display: inline-block;
}
.field-hint {
  color: #8a94a8;
  font-size: 12px;
  margin-left: 12px;
}
.error-alert {
  margin-bottom: 10px;
}
.rule-panel {
  border-radius: 10px;
  padding: 14px 16px;
  margin-top: 6px;
  border: 1px solid;
}
.rule-panel.pass {
  background: #f0f9eb;
  border-color: #c2e7b0;
}
.rule-panel.fail {
  background: #fef0f0;
  border-color: #fbc4c4;
}
.rule-title {
  margin: 0 0 10px;
  font-weight: 700;
  display: flex;
  gap: 10px;
  align-items: center;
}
.rule-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.rule-item p {
  margin: 4px 0;
  font-size: 13px;
  color: #536078;
}
.rule-label {
  font-size: 12px;
  color: #8a94a8;
}
.ok {
  color: #14724f !important;
  font-weight: 700;
}
.bad {
  color: #c45656 !important;
  font-weight: 700;
}
.rule-errors {
  margin: 10px 0 0;
  padding-left: 18px;
  color: #c45656;
  font-size: 13px;
}
.rule-errors li {
  margin: 3px 0;
}
.form-actions {
  margin-top: 16px;
  display: flex;
  align-items: center;
}
</style>
