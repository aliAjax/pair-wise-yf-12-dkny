import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { DispatchOrder, Product, Station } from "../domain/types";
import { findTank, validateDispatch } from "../domain/inventory";

const STORAGE_KEY = "hxwlfront-21-dispatch";

function seedStations(): Station[] {
  return [
    {
      id: "st-east-1",
      name: "东区一站",
      area: "东区",
      manager: "刘站长",
      tanks: [
        { product: "92#汽油", stock: 36000, capacity: 50000, safetyStock: 8000 },
        { product: "0#柴油", stock: 22000, capacity: 40000, safetyStock: 6000 }
      ]
    },
    {
      id: "st-west-2",
      name: "西区二站",
      area: "西区",
      manager: "陈站长",
      tanks: [
        { product: "92#汽油", stock: 18000, capacity: 45000, safetyStock: 7000 },
        { product: "95#汽油", stock: 12000, capacity: 30000, safetyStock: 5000 }
      ]
    },
    {
      id: "st-airport",
      name: "机场快线站",
      area: "机场线",
      manager: "王站长",
      tanks: [
        { product: "0#柴油", stock: 9000, capacity: 35000, safetyStock: 5000 },
        { product: "95#汽油", stock: 15000, capacity: 30000, safetyStock: 6000 }
      ]
    }
  ];
}

function load(): { stations: Station[]; orders: DispatchOrder[] } {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { stations: seedStations(), orders: [] };
  try {
    const parsed = JSON.parse(raw) as { stations: Station[]; orders: DispatchOrder[] };
    return { stations: parsed.stations, orders: parsed.orders };
  } catch {
    return { stations: seedStations(), orders: [] };
  }
}

export interface CreateDispatchInput {
  fromStationId: string;
  toStationId: string;
  product: Product;
  plannedQty: number;
}

export const useDispatchStore = defineStore("dispatch", () => {
  const initial = load();
  const stations = ref<Station[]>(initial.stations);
  const orders = ref<DispatchOrder[]>(initial.orders);

  const inTransitCount = computed(() => orders.value.filter((order) => order.status === "在途").length);
  const totalLossLiters = computed(() =>
    orders.value.reduce((sum, order) => sum + (order.status === "已签收" ? order.lossQty : 0), 0)
  );

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ stations: stations.value, orders: orders.value }));
  }

  function stationById(id: string) {
    return stations.value.find((station) => station.id === id);
  }

  /** 调度存证：每次流转追加一条留档 */
  function record(order: DispatchOrder, action: string, detail: string) {
    order.events.push({ at: new Date().toISOString(), action, detail });
  }

  /** 发起调度：库存判定不通过则退回，列表和库存照旧 */
  function createDispatch(input: CreateDispatchInput): { ok: boolean; failures: string[] } {
    const fromStation = stationById(input.fromStationId);
    const toStation = stationById(input.toStationId);
    if (!fromStation || !toStation) return { ok: false, failures: ["请选择调出站和调入站"] };
    if (fromStation.id === toStation.id) return { ok: false, failures: ["调出站与调入站不能相同"] };

    const fromTank = findTank(fromStation, input.product);
    const toTank = findTank(toStation, input.product);
    if (!fromTank) return { ok: false, failures: [`调出站「${fromStation.name}」没有 ${input.product} 油罐`] };
    if (!toTank) return { ok: false, failures: [`调入站「${toStation.name}」没有 ${input.product} 油罐`] };

    const check = validateDispatch({
      plannedQty: input.plannedQty,
      fromStation,
      fromTank,
      toStation,
      toTank,
      orders: orders.value
    });
    if (!check.ok) return check;

    const order: DispatchOrder = {
      id: crypto.randomUUID(),
      code: `DB${Date.now().toString().slice(-8)}`,
      fromStationId: fromStation.id,
      toStationId: toStation.id,
      product: input.product,
      plannedQty: input.plannedQty,
      receivedQty: null,
      lossQty: 0,
      lossReason: "",
      status: "待发出",
      createdAt: new Date().toISOString(),
      departedAt: null,
      closedAt: null,
      events: []
    };
    record(order, "创建调度", `计划 ${input.product} ${input.plannedQty}L，库存判定通过`);
    orders.value = [order, ...orders.value];
    persist();
    return { ok: true, failures: [] };
  }

  /** 车辆发出：在途量开始同时占用两边仓位，发出前复查库存判定 */
  function depart(orderId: string): string | null {
    const order = orders.value.find((item) => item.id === orderId);
    if (!order || order.status !== "待发出") return "调度单状态已变化";

    const fromStation = stationById(order.fromStationId);
    const toStation = stationById(order.toStationId);
    const fromTank = findTank(fromStation, order.product);
    const toTank = findTank(toStation, order.product);
    if (!fromStation || !toStation || !fromTank || !toTank) return "网点或油罐信息缺失";

    const check = validateDispatch({
      plannedQty: order.plannedQty,
      fromStation,
      fromTank,
      toStation,
      toTank,
      orders: orders.value
    });
    if (!check.ok) return check.failures.join("；");

    order.status = "在途";
    order.departedAt = new Date().toISOString();
    record(order, "车辆发出", `在途 ${order.plannedQty}L 同时占用调出站与调入站仓位`);
    persist();
    return null;
  }

  /** 卸油签收：允许少于计划量，差额立即释放，损耗须写原因留档 */
  function signOff(orderId: string, receivedQty: number, lossReason: string): string | null {
    const order = orders.value.find((item) => item.id === orderId);
    if (!order || order.status !== "在途") return "调度单状态已变化";
    if (!Number.isFinite(receivedQty) || receivedQty < 0) return "签收量必须为非负数字";
    if (receivedQty > order.plannedQty) return `签收量不能超过计划量 ${order.plannedQty}L`;

    const lossQty = order.plannedQty - receivedQty;
    if (lossQty > 0 && !lossReason.trim()) return `差额 ${lossQty}L 计为损耗，必须填写损耗原因`;

    const fromTank = findTank(stationById(order.fromStationId), order.product);
    const toTank = findTank(stationById(order.toStationId), order.product);
    if (!fromTank || !toTank) return "网点或油罐信息缺失";

    fromTank.stock -= order.plannedQty;
    toTank.stock += receivedQty;

    order.status = "已签收";
    order.receivedQty = receivedQty;
    order.lossQty = lossQty;
    order.lossReason = lossQty > 0 ? lossReason.trim() : "";
    order.closedAt = new Date().toISOString();
    record(
      order,
      "卸油签收",
      lossQty > 0
        ? `实收 ${receivedQty}L，损耗 ${lossQty}L 已释放占用，原因：${order.lossReason}`
        : `实收 ${receivedQty}L，足额签收，占用已释放`
    );
    persist();
    return null;
  }

  /** 取消：待发出或在途均可取消，在途占用随之释放 */
  function cancel(orderId: string): string | null {
    const order = orders.value.find((item) => item.id === orderId);
    if (!order || (order.status !== "待发出" && order.status !== "在途")) return "调度单状态已变化";
    const wasInTransit = order.status === "在途";
    order.status = "已取消";
    order.closedAt = new Date().toISOString();
    record(order, "取消调度", wasInTransit ? `在途 ${order.plannedQty}L 占用已释放` : "未发出，无占用");
    persist();
    return null;
  }

  /** 拒收：调入站拒收，释放在途占用 */
  function reject(orderId: string): string | null {
    const order = orders.value.find((item) => item.id === orderId);
    if (!order || order.status !== "在途") return "调度单状态已变化";
    order.status = "已拒收";
    order.closedAt = new Date().toISOString();
    record(order, "调入站拒收", `在途 ${order.plannedQty}L 占用已释放，库存未变动`);
    persist();
    return null;
  }

  return {
    stations,
    orders,
    inTransitCount,
    totalLossLiters,
    createDispatch,
    depart,
    signOff,
    cancel,
    reject
  };
});
