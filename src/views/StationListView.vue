<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { PRODUCTS, productName } from "../data/seed";
import { useDispatchStore } from "../store/dispatch";
import { gotoDispatch } from "../composables/ui";
import { qty } from "../utils/format";

const store = useDispatchStore();
const areaFilter = ref("全部区域");

const areas = computed(() => ["全部区域", ...new Set(store.stations.map((s) => s.area))]);

const visibleStations = computed(() =>
  areaFilter.value === "全部区域"
    ? store.stations
    : store.stations.filter((s) => s.area === areaFilter.value)
);

const shortageCount = computed(
  () => store.shortageStations.reduce((sum, item) => sum + item.short.length, 0)
);
const inTransitCount = computed(() => store.inTransitOrders.length);

function requestReplenish(stationId: string, productCode: (typeof PRODUCTS)[number]["code"]) {
  gotoDispatch(stationId, productCode);
  ElMessage.success("已带入缺油油罐信息，请在调度页选择调出站和计划量");
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>网点库存列表</h2>
        <p class="hint">
          库存低于安全库存标红为「缺油」，站长可直接发起补货调度。在途量同时占用调出与调入仓位，已在下方实时计入。
        </p>
      </div>
      <el-select v-model="areaFilter" style="width: 150px">
        <el-option v-for="area in areas" :key="area" :label="area" :value="area" />
      </el-select>
    </div>

    <div class="summary-strip">
      <el-tag type="danger" effect="light">缺油油罐 {{ shortageCount }} 个</el-tag>
      <el-tag type="warning" effect="light">在途调拨 {{ inTransitCount }} 单</el-tag>
    </div>

    <div v-if="store.shortageStations.length" class="shortage-banner">
      <strong>缺油预警：</strong>
      <el-tag
        v-for="item in store.shortageStations"
        :key="item.station.id"
        type="danger"
        class="short-tag"
      >
        {{ item.station.name }} ·
        {{ item.short.map((t) => productName(t.productCode)).join("、") }}
      </el-tag>
    </div>

    <div class="station-grid">
      <el-card v-for="station in visibleStations" :key="station.id" shadow="never" class="station-card">
        <template #header>
          <div class="card-head">
            <div>
              <span class="station-name">{{ station.name }}</span>
              <span class="area-pill">{{ station.area }}</span>
            </div>
            <span class="manager">{{ station.manager }}</span>
          </div>
        </template>

        <table class="tank-table">
          <thead>
            <tr>
              <th>油品</th>
              <th>库存 / 罐容</th>
              <th>安全库存</th>
              <th>调出占用 / 调入待卸</th>
              <th>最多可调出</th>
              <th>还可接收</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tank in station.tanks" :key="tank.productCode">
              <td>{{ productName(tank.productCode) }}</td>
              <td>
                <strong :class="{ 'stock-low': tank.stock < tank.safety }">{{ qty(tank.stock) }}</strong>
                / {{ qty(tank.capacity) }}
              </td>
              <td>{{ qty(tank.safety) }}</td>
              <td class="occupy">
                <span>{{ qty(store.occupancyOf(station.id, tank.productCode).outbound) }}</span>
                <span class="sep">/</span>
                <span>{{ qty(store.occupancyOf(station.id, tank.productCode).inbound) }}</span>
              </td>
              <td>{{ qty(store.outboundAvailability(station.id, tank.productCode)) }}</td>
              <td>{{ qty(store.inboundRoom(station.id, tank.productCode)) }}</td>
              <td>
                <el-tag v-if="tank.stock < tank.safety" type="danger" size="small">缺油</el-tag>
                <el-tag v-else type="success" size="small">正常</el-tag>
              </td>
              <td>
                <el-button
                  size="small"
                  type="primary"
                  @click="requestReplenish(station.id, tank.productCode)"
                >
                  发起补货
                </el-button>
              </td>
            </tr>
          </tbody>
        </table>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
}
.page-head h2 {
  margin: 0 0 6px;
}
.hint {
  margin: 0;
  color: #5b667a;
  font-size: 13px;
}
.summary-strip {
  display: flex;
  gap: 10px;
  margin: 14px 0;
}
.shortage-banner {
  background: #fef0f0;
  border: 1px solid #fbc4c4;
  border-radius: 8px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  color: #c45656;
}
.short-tag {
  margin-right: 4px;
}
.station-grid {
  display: grid;
  gap: 14px;
}
.station-card {
  border-radius: 10px;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.station-name {
  font-size: 16px;
  font-weight: 700;
  margin-right: 10px;
}
.area-pill {
  background: #eef5fb;
  color: #176b87;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}
.manager {
  color: #69758c;
  font-size: 13px;
}
.tank-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.tank-table th,
.tank-table td {
  text-align: left;
  padding: 9px 10px;
  border-bottom: 1px solid #eef2f7;
  white-space: nowrap;
}
.tank-table th {
  color: #8a94a8;
  font-weight: 600;
  background: #fafbfd;
}
.tank-table tr:last-child td {
  border-bottom: 0;
}
.occupy .sep {
  color: #c0c8d6;
  margin: 0 6px;
}
.stock-low {
  color: #c45656;
}
</style>
