<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { DispatchOrder, Product, Station } from "./domain/types";
import { inTransitInLiters, inTransitOutLiters, receiverFreeLiters, sourceAvailableLiters } from "./domain/inventory";
import { useDispatchStore } from "./stores/dispatch";

const store = useDispatchStore();

const project = {
  title: "油站补货调度",
  subtitle: "缺油网点从现有网点列表发起调拨：调出站扣在途后留足安全库存，调入站待卸量不超罐容，签收差额即时释放并留档。",
  industry: "石油",
  stack: ["Vue3", "Vite", "TypeScript", "Element Plus", "Pinia"],
  metricLabels: ["网点数", "在途调拨", "累计损耗L"]
} as const;

const statuses = ["待发出", "在途", "已签收", "已取消", "已拒收"] as const;

const form = reactive({
  toStationId: "",
  product: "" as Product | "",
  fromStationId: "",
  plannedQty: 0
});
const formErrors = ref<string[]>([]);
const actionError = ref("");

const signingId = ref<string | null>(null);
const signQty = ref(0);
const signLossReason = ref("");
const signError = ref("");

const stations = computed(() => store.stations);
const orders = computed(() => store.orders);

const toStation = computed(() => stations.value.find((station) => station.id === form.toStationId));
const fromStation = computed(() => stations.value.find((station) => station.id === form.fromStationId));

const productOptions = computed(() => toStation.value?.tanks.map((tank) => tank.product) ?? []);

const fromOptions = computed(() =>
  stations.value.filter(
    (station) => station.id !== form.toStationId && station.tanks.some((tank) => tank.product === form.product)
  )
);

const fromTank = computed(() => fromStation.value?.tanks.find((tank) => tank.product === form.product));
const toTank = computed(() => toStation.value?.tanks.find((tank) => tank.product === form.product));

const sourceAvailable = computed(() =>
  fromStation.value && fromTank.value ? sourceAvailableLiters(fromTank.value, orders.value, fromStation.value.id) : null
);
const receiverFree = computed(() =>
  toStation.value && toTank.value ? receiverFreeLiters(toTank.value, orders.value, toStation.value.id) : null
);

const metrics = computed(() => [stations.value.length, store.inTransitCount, store.totalLossLiters]);

const chartRows = computed(() =>
  statuses.map((status) => ({ status, value: orders.value.filter((order) => order.status === status).length }))
);
const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));

function fmt(value: number) {
  return value.toLocaleString("zh-CN");
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function stationName(id: string) {
  return stations.value.find((station) => station.id === id)?.name ?? "未知网点";
}

function stationStatus(station: Station) {
  return station.tanks.some((tank) => tank.stock < tank.safetyStock) ? "库存紧张" : "营业中";
}

function tankInOut(station: Station, product: Product) {
  return {
    out: inTransitOutLiters(orders.value, station.id, product),
    incoming: inTransitInLiters(orders.value, station.id, product)
  };
}

/** 从网点列表发起补货：预填调入站 */
function startReplenish(station: Station) {
  form.toStationId = station.id;
  form.product = station.tanks[0]?.product ?? "";
  form.fromStationId = "";
  formErrors.value = [];
}

function onToStationChange() {
  form.product = productOptions.value[0] ?? "";
  form.fromStationId = "";
}

function submit() {
  formErrors.value = [];
  const result = store.createDispatch({
    fromStationId: form.fromStationId,
    toStationId: form.toStationId,
    product: form.product as Product,
    plannedQty: Number(form.plannedQty)
  });
  if (!result.ok) {
    formErrors.value = result.failures;
    return;
  }
  form.plannedQty = 0;
}

function run(action: () => string | null) {
  actionError.value = action() ?? "";
}

function openSign(order: DispatchOrder) {
  signingId.value = order.id;
  signQty.value = order.plannedQty;
  signLossReason.value = "";
  signError.value = "";
}

const signLoss = computed(() => {
  const order = orders.value.find((item) => item.id === signingId.value);
  return order ? Math.max(0, order.plannedQty - Number(signQty.value || 0)) : 0;
});

function confirmSign() {
  if (!signingId.value) return;
  const error = store.signOff(signingId.value, Number(signQty.value), signLossReason.value);
  if (error) {
    signError.value = error;
    return;
  }
  signingId.value = null;
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ project.industry }}行业前端最小闭环</p>
          <h1>{{ project.title }}</h1>
          <p class="subtitle">{{ project.subtitle }}</p>
        </div>
        <div class="stack">
          <span v-for="item in project.stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="(label, index) in project.metricLabels" :key="label" class="metric">
          <span>{{ label }}</span>
          <strong>{{ fmt(metrics[index]) }}</strong>
        </article>
      </section>

      <section class="workspace">
        <form class="panel" @submit.prevent="submit">
          <h2>发起补货调度</h2>
          <div class="form-grid">
            <label>
              调入站（缺油网点）
              <select v-model="form.toStationId" required @change="onToStationChange">
                <option value="">请选择</option>
                <option v-for="station in stations" :key="station.id" :value="station.id">{{ station.name }}</option>
              </select>
            </label>
            <label>
              油品
              <select v-model="form.product" required @change="form.fromStationId = ''">
                <option value="">请选择</option>
                <option v-for="product in productOptions" :key="product" :value="product">{{ product }}</option>
              </select>
            </label>
            <label>
              调出站
              <select v-model="form.fromStationId" required>
                <option value="">请选择</option>
                <option v-for="station in fromOptions" :key="station.id" :value="station.id">{{ station.name }}</option>
              </select>
            </label>
            <label>
              计划量（L）
              <input v-model.number="form.plannedQty" type="number" min="1" step="1" required />
            </label>

            <div v-if="sourceAvailable !== null || receiverFree !== null" class="hints">
              <p v-if="sourceAvailable !== null">调出站可调出：<strong>{{ fmt(sourceAvailable) }}L</strong>（已扣安全库存与在途调拨）</p>
              <p v-if="receiverFree !== null">调入站可接收：<strong>{{ fmt(receiverFree) }}L</strong>（罐容扣库存与待卸量）</p>
            </div>

            <div v-if="formErrors.length" class="failures">
              <p>库存判定未通过，已退回，列表和库存照旧：</p>
              <ul>
                <li v-for="failure in formErrors" :key="failure">{{ failure }}</li>
              </ul>
            </div>

            <button type="submit">提交调度（先判定库存）</button>
          </div>
        </form>

        <section class="list-panel">
          <div class="toolbar">
            <h2>网点库存</h2>
          </div>
          <div class="record-grid">
            <article v-for="station in stations" :key="station.id" class="record">
              <div class="record-head">
                <p class="record-title">{{ station.name }} / {{ station.area }} · {{ station.manager }}</p>
                <span class="status" :class="{ warn: stationStatus(station) === '库存紧张' }">{{ stationStatus(station) }}</span>
              </div>
              <table class="tank-table">
                <thead>
                  <tr><th>油品</th><th>库存/罐容</th><th>安全库存</th><th>在途出</th><th>待卸入</th></tr>
                </thead>
                <tbody>
                  <tr v-for="tank in station.tanks" :key="tank.product" :class="{ shortage: tank.stock < tank.safetyStock }">
                    <td>{{ tank.product }}</td>
                    <td>{{ fmt(tank.stock) }} / {{ fmt(tank.capacity) }}L</td>
                    <td>{{ fmt(tank.safetyStock) }}L</td>
                    <td>{{ fmt(tankInOut(station, tank.product).out) }}L</td>
                    <td>{{ fmt(tankInOut(station, tank.product).incoming) }}L</td>
                  </tr>
                </tbody>
              </table>
              <div class="actions">
                <button type="button" class="secondary" @click="startReplenish(station)">缺油补货</button>
              </div>
            </article>
          </div>
        </section>
      </section>

      <section class="list-panel orders-panel">
        <div class="toolbar">
          <h2>调度单</h2>
          <span v-if="actionError" class="action-error">{{ actionError }}</span>
        </div>
        <div class="record-grid">
          <div v-if="orders.length === 0" class="empty">暂无调度单</div>
          <article v-for="order in orders" :key="order.id" class="record">
            <div class="record-head">
              <p class="record-title">
                {{ order.code }}：{{ stationName(order.fromStationId) }} → {{ stationName(order.toStationId) }}
              </p>
              <span class="status" :class="{ warn: order.status === '在途', muted: order.status === '已取消' || order.status === '已拒收' }">{{ order.status }}</span>
            </div>
            <div class="details">
              <span>油品：{{ order.product }}</span>
              <span>计划量：{{ fmt(order.plannedQty) }}L</span>
              <span v-if="order.receivedQty !== null">实收：{{ fmt(order.receivedQty) }}L</span>
              <span v-if="order.lossQty > 0">损耗：{{ fmt(order.lossQty) }}L（{{ order.lossReason }}）</span>
            </div>

            <div v-if="signingId === order.id" class="sign-panel">
              <label>
                实收量（L，可少于计划量）
                <input v-model.number="signQty" type="number" min="0" :max="order.plannedQty" step="1" />
              </label>
              <label v-if="signLoss > 0">
                损耗 {{ fmt(signLoss) }}L 原因（必填留档）
                <input v-model="signLossReason" type="text" placeholder="如：运输蒸发损耗 / 罐车计量差" />
              </label>
              <p v-if="signError" class="action-error">{{ signError }}</p>
              <div class="actions">
                <button type="button" @click="confirmSign">确认签收</button>
                <button type="button" class="secondary" @click="signingId = null">返回</button>
              </div>
            </div>

            <div v-else class="actions">
              <template v-if="order.status === '待发出'">
                <button type="button" @click="run(() => store.depart(order.id))">车辆发出</button>
                <button type="button" class="danger" @click="run(() => store.cancel(order.id))">取消</button>
              </template>
              <template v-else-if="order.status === '在途'">
                <button type="button" @click="openSign(order)">卸油签收</button>
                <button type="button" class="danger" @click="run(() => store.reject(order.id))">拒收</button>
                <button type="button" class="secondary" @click="run(() => store.cancel(order.id))">取消</button>
              </template>
            </div>

            <ul class="events">
              <li v-for="(event, index) in order.events" :key="index">
                <strong>{{ event.action }}</strong> · {{ fmtTime(event.at) }} · {{ event.detail }}
              </li>
            </ul>
          </article>
        </div>

        <div class="mini-chart">
          <div v-for="row in chartRows" :key="row.status" class="bar">
            <span>{{ row.status }}</span>
            <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
            <strong>{{ row.value }}</strong>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
