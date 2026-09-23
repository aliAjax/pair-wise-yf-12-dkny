<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { productName } from "../data/seed";
import type { OrderStatus, TransferOrder } from "../domain/types";
import { useDispatchStore } from "../store/dispatch";
import { qty, datetime } from "../utils/format";

const store = useDispatchStore();

type Tab = "pending" | "in_transit" | "closed";
const tab = ref<Tab>("pending");

const tabs: { key: Tab; label: string; count: () => number }[] = [
  { key: "pending", label: "待发车", count: () => store.pendingOrders.length },
  { key: "in_transit", label: "在途（双向占仓）", count: () => store.inTransitOrders.length },
  { key: "closed", label: "已办结", count: () => store.closedOrders.length }
];

const list = computed<TransferOrder[]>(() => {
  if (tab.value === "pending") return store.pendingOrders;
  if (tab.value === "in_transit") return store.inTransitOrders;
  return store.closedOrders;
});

const STATUS_META: Record<OrderStatus, { label: string; type: "info" | "warning" | "success" | "danger" }> = {
  pending: { label: "待发车", type: "info" },
  in_transit: { label: "在途", type: "warning" },
  received: { label: "已签收", type: "success" },
  rejected: { label: "已拒收", type: "danger" },
  cancelled: { label: "已取消", type: "info" }
};

function route(order: TransferOrder): string {
  return `${store.stationById(order.fromStationId)?.name ?? "未知站"} → ${
    store.stationById(order.toStationId)?.name ?? "未知站"
  }`;
}

function failMessage(errors: string[], fallback: string) {
  if (errors.length) {
    ElMessage.error(errors[0]);
    if (errors.length > 1) ElMessage.warning(`另有 ${errors.length - 1} 项未通过，见调度存证`);
  } else {
    ElMessage.error(fallback);
  }
}

// ---- 发车 ----
function depart(order: TransferOrder) {
  const result = store.depart(order.id);
  if (result.ok) {
    ElMessage.success(`车辆已发出，在途 ${qty(order.planQty)} 同时占用两边仓位`);
  } else {
    failMessage(result.errors, "发车失败");
  }
}

// ---- 取消 ----
async function cancel(order: TransferOrder) {
  let reason = "";
  try {
    if (order.status === "in_transit") {
      const { value } = await ElMessageBox.prompt("在途取消按原车退回处理，请填写退回说明", "取消调拨", {
        confirmButtonText: "确认取消",
        cancelButtonText: "返回",
        inputType: "textarea",
        inputPlaceholder: "如：道路封闭无法送达，原车退回",
        inputValidator: (v) => (v && v.trim() ? true : "在途取消必须填写原因")
      });
      reason = value;
    } else {
      const { value } = await ElMessageBox.prompt("备注（可不填）", "取消待发车调拨", {
        confirmButtonText: "确认取消",
        cancelButtonText: "返回",
        inputType: "textarea"
      });
      reason = value || "";
    }
  } catch {
    return; // 用户点「返回」
  }
  const result = store.cancel(order.id, reason);
  if (result.ok) {
    ElMessage.success(order.status === "in_transit" ? "已取消，两边占用已释放（原车退回）" : "待发车单已取消");
  } else {
    failMessage(result.errors, "取消失败");
  }
}

// ---- 拒收 ----
const rejectVisible = ref(false);
const rejectForm = reactive<{ id: string; reason: string }>({ id: "", reason: "" });

function openReject(order: TransferOrder) {
  rejectForm.id = order.id;
  rejectForm.reason = "";
  rejectVisible.value = true;
}

function confirmReject() {
  const result = store.reject(rejectForm.id, rejectForm.reason);
  if (result.ok) {
    rejectVisible.value = false;
    ElMessage.success("已拒收，原车退回，两边占用立即释放");
  } else {
    failMessage(result.errors, "拒收失败");
  }
}

// ---- 签收 ----
const receiveVisible = ref(false);
const receiveForm = reactive<{ id: string; actualQty: number; lossReason: string }>({
  id: "",
  actualQty: 0,
  lossReason: ""
});
const activeOrder = ref<TransferOrder | null>(null);

function openReceive(order: TransferOrder) {
  activeOrder.value = order;
  receiveForm.id = order.id;
  receiveForm.actualQty = order.planQty;
  receiveForm.lossReason = "";
  receiveVisible.value = true;
}

const receiptLoss = computed(() => {
  if (!activeOrder.value) return 0;
  return Math.max(0, activeOrder.value.planQty - Number(receiveForm.actualQty || 0));
});

const receiveErrors = computed<string[]>(() => {
  if (!activeOrder.value) return [];
  const errors: string[] = [];
  const q = Number(receiveForm.actualQty);
  if (!Number.isFinite(q) || q < 0) errors.push("实收量必须为不小于 0 的数字");
  if (activeOrder.value && q > activeOrder.value.planQty) errors.push("实收量不能超过计划量");
  if (receiptLoss.value > 0 && !receiveForm.lossReason.trim()) errors.push("实收少于计划量时，必须填写损耗原因留档");
  return errors;
});

function confirmReceive() {
  if (!activeOrder.value) return;
  const result = store.receive(receiveForm.id, {
    actualQty: Math.round(Number(receiveForm.actualQty)),
    lossReason: receiveForm.lossReason
  });
  if (result.ok) {
    receiveVisible.value = false;
    ElMessage.success(
      receiptLoss.value > 0
        ? `签收完成：实收 ${qty(activeOrder.value.actualQty!)}，损耗 ${qty(receiptLoss.value)} 已释放并留档`
        : "签收完成，库存已结算"
    );
  } else {
    failMessage(result.errors, "签收失败");
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>调度单跟踪</h2>
      <p class="hint">
        车辆发出后在途量同时占用调出站可调出量与调入站罐容；签收允许少于计划量，差额立即释放并登记损耗原因；取消或拒收同样释放占用。
      </p>
    </div>

    <el-radio-group v-model="tab" class="tab-group">
      <el-radio-button v-for="item in tabs" :key="item.key" :value="item.key">
        {{ item.label }}（{{ item.count() }}）
      </el-radio-button>
    </el-radio-group>

    <el-empty v-if="list.length === 0" description="暂无该状态的调拨单" />

    <div v-else class="order-list">
      <el-card v-for="order in list" :key="order.id" shadow="never" class="order-card">
        <div class="order-main">
          <div class="order-info">
            <div class="order-head">
              <span class="order-code">{{ order.code }}</span>
              <el-tag :type="STATUS_META[order.status].type" size="small">{{ STATUS_META[order.status].label }}</el-tag>
            </div>
            <p class="route">{{ route(order) }}</p>
            <p class="meta-line">
              {{ productName(order.productCode) }} · 计划量 <strong>{{ qty(order.planQty) }}</strong>
            </p>
            <p class="meta-line dim">创建：{{ datetime(order.createdAt) }} · {{ order.createdBy }}</p>
            <p v-if="order.departedAt" class="meta-line dim">发车：{{ datetime(order.departedAt) }}</p>

            <div v-if="order.status === 'received'" class="settle">
              <el-tag type="success" size="small">实收 {{ qty(order.actualQty!) }}</el-tag>
              <el-tag v-if="order.lossQty" type="warning" size="small">
                损耗 {{ qty(order.lossQty) }} · {{ order.lossReason }}
              </el-tag>
              <span class="dim">签收：{{ datetime(order.receivedAt) }} · {{ order.receivedBy }}</span>
            </div>
            <div v-else-if="order.status === 'rejected'" class="settle">
              <el-tag type="danger" size="small">拒收：{{ order.rejectReason }}</el-tag>
              <span class="dim">{{ datetime(order.rejectedAt) }}</span>
            </div>
            <div v-else-if="order.status === 'cancelled'" class="settle">
              <el-tag size="small" type="info">取消：{{ order.cancelReason }}</el-tag>
              <span class="dim">{{ datetime(order.cancelledAt) }}</span>
            </div>
          </div>

          <div class="order-actions">
            <template v-if="order.status === 'pending'">
              <el-button type="primary" size="small" @click="depart(order)">车辆发出</el-button>
              <el-button size="small" @click="cancel(order)">取消</el-button>
            </template>
            <template v-else-if="order.status === 'in_transit'">
              <el-button type="success" size="small" @click="openReceive(order)">卸油签收</el-button>
              <el-button type="warning" size="small" @click="openReject(order)">拒收</el-button>
              <el-button size="small" @click="cancel(order)">取消（原车退回）</el-button>
            </template>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 签收对话框 -->
    <el-dialog v-model="receiveVisible" title="卸油签收" width="520px">
      <template v-if="activeOrder">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="调度单号">{{ activeOrder.code }}</el-descriptions-item>
          <el-descriptions-item label="路线">{{ route(activeOrder) }}</el-descriptions-item>
          <el-descriptions-item label="计划量">{{ qty(activeOrder.planQty) }}</el-descriptions-item>
        </el-descriptions>
        <el-form label-position="top" class="dialog-form">
          <el-form-item label="实收量（升）" required>
            <el-input-number v-model="receiveForm.actualQty" :min="0" :max="activeOrder.planQty" :step="100" style="width: 100%" />
          </el-form-item>
          <el-form-item label="损耗原因（实收少于计划量时必填并留档）" :required="receiptLoss > 0">
            <el-input
              v-model="receiveForm.lossReason"
              type="textarea"
              :rows="3"
              :placeholder="receiptLoss > 0 ? '如：运输途中挥发损耗 / 罐底残留，差异 ' + qty(receiptLoss) : '足量签收可不填'"
            />
          </el-form-item>
        </el-form>
        <el-alert
          v-if="receiptLoss > 0"
          :title="`本次损耗 ${qty(receiptLoss)}：调出站按计划量出库，调入站按实收量入库，差额立即释放调入仓位`"
          type="warning"
          :closable="false"
          show-icon
        />
        <ul v-if="receiveErrors.length" class="dialog-errors">
          <li v-for="(err, i) in receiveErrors" :key="i">{{ err }}</li>
        </ul>
      </template>
      <template #footer>
        <el-button @click="receiveVisible = false">返回</el-button>
        <el-button type="primary" :disabled="!!receiveErrors.length" @click="confirmReceive">确认签收</el-button>
      </template>
    </el-dialog>

    <!-- 拒收对话框 -->
    <el-dialog v-model="rejectVisible" title="拒收（原车退回）" width="520px">
      <el-alert
        title="拒收后车辆原车退回，调出站与调入站的在途占用立即释放，库存不变。"
        type="warning"
        :closable="false"
        show-icon
        class="dialog-alert"
      />
      <el-form label-position="top">
        <el-form-item label="拒收原因（必填并留档）" required>
          <el-input v-model="rejectForm.reason" type="textarea" :rows="3" placeholder="如：到站检测含水超标，整车拒收" />
        </el-form-item>
      </el-form>
      <p v-if="!rejectForm.reason.trim()" class="dialog-errors-text">必须填写拒收原因</p>
      <template #footer>
        <el-button @click="rejectVisible = false">返回</el-button>
        <el-button type="warning" :disabled="!rejectForm.reason.trim()" @click="confirmReject">确认拒收</el-button>
      </template>
    </el-dialog>
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
.tab-group {
  margin: 16px 0;
}
.order-list {
  display: grid;
  gap: 12px;
}
.order-card {
  border-radius: 10px;
}
.order-main {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
}
.order-head {
  display: flex;
  gap: 10px;
  align-items: center;
}
.order-code {
  font-weight: 700;
  font-size: 15px;
}
.route {
  margin: 8px 0 4px;
  font-size: 15px;
}
.meta-line {
  margin: 3px 0;
  font-size: 13px;
  color: #445069;
}
.dim {
  color: #8a94a8;
}
.settle {
  margin-top: 10px;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 12px;
}
.order-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.dialog-form {
  margin-top: 14px;
}
.dialog-errors {
  color: #c45656;
  font-size: 13px;
  margin: 10px 0 0;
  padding-left: 18px;
}
.dialog-errors-text {
  color: #c45656;
  font-size: 13px;
  margin: 6px 0 0;
}
.dialog-alert {
  margin-bottom: 14px;
}
</style>
