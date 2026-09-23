import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  findTank,
  inboundPendingUnload,
  outboundInTransit
} from "../domain/inventory";
import type { ProductCode, Station, TransferOrder } from "../domain/types";
import { repository } from "../service/repository";
import {
  cancelOrder,
  departOrder,
  receiveOrder,
  rejectOrder,
  requestDispatch,
  type ActionResult,
  type DispatchRequest,
  type ReceiptParam,
  type CloseParam
} from "../service/transfer";
import type { AuditEntry } from "../service/audit";

const OPERATOR = "值班站长";

export const useDispatchStore = defineStore("dispatch", () => {
  const initial = repository.load();
  const stations = ref<Station[]>(initial.stations);
  const orders = ref<TransferOrder[]>(initial.orders);
  const audit = ref<AuditEntry[]>(initial.audit);
  const seq = ref(initial.seq);

  function persist() {
    repository.save({
      stations: stations.value,
      orders: orders.value,
      audit: audit.value,
      seq: seq.value
    });
  }

  /** 服务都在同一个可变快照上操作，落盘一次，保证单据与存证原子写入 */
  function commit(result: ActionResult): ActionResult {
    persist();
    return result;
  }

  // ---- 页面视图模型：占用与余量（从在途单实时推导，不冗余存储） ----

  function stationById(id: string): Station | undefined {
    return stations.value.find((station) => station.id === id);
  }

  /** 调出视角：库存 - 其他在途 - 安全库存 = 当前最多可调出量 */
  function outboundAvailability(stationId: string, productCode: ProductCode): number {
    const station = stationById(stationId);
    const tank = station && findTank(station, productCode);
    if (!tank) return 0;
    const other = outboundInTransit(orders.value, stationId, productCode);
    return Math.max(0, tank.stock - other - tank.safety);
  }

  /** 调入视角：罐容 - 库存 - 已有待卸 = 当前还能接多少 */
  function inboundRoom(stationId: string, productCode: ProductCode): number {
    const station = stationById(stationId);
    const tank = station && findTank(station, productCode);
    if (!tank) return 0;
    const pending = inboundPendingUnload(orders.value, stationId, productCode);
    return Math.max(0, tank.capacity - tank.stock - pending);
  }

  function occupancyOf(stationId: string, productCode: ProductCode) {
    return {
      outbound: outboundInTransit(orders.value, stationId, productCode),
      inbound: inboundPendingUnload(orders.value, stationId, productCode)
    };
  }

  const pendingOrders = computed(() => orders.value.filter((order) => order.status === "pending"));
  const inTransitOrders = computed(() => orders.value.filter((order) => order.status === "in_transit"));
  const closedOrders = computed(() =>
    orders.value.filter((order) =>
      ["received", "rejected", "cancelled"].includes(order.status)
    )
  );

  const shortageStations = computed(() =>
    stations.value
      .map((station) => ({
        station,
        short: station.tanks.filter((tank) => tank.stock < tank.safety)
      }))
      .filter((item) => item.short.length > 0)
  );

  // ---- 动作 ----

  function dispatch(param: DispatchRequest): ActionResult {
    return commit(requestDispatch(snapshot(), { ...param, operator: param.operator || OPERATOR }));
  }
  function depart(orderId: string): ActionResult {
    return commit(departOrder(snapshot(), orderId, OPERATOR));
  }
  function receive(orderId: string, param: Omit<ReceiptParam, "operator">): ActionResult {
    return commit(receiveOrder(snapshot(), orderId, { ...param, operator: OPERATOR }));
  }
  function reject(orderId: string, reason: string): ActionResult {
    return commit(rejectOrder(snapshot(), orderId, { reason, operator: OPERATOR }));
  }
  function cancel(orderId: string, reason: string): ActionResult {
    return commit(cancelOrder(snapshot(), orderId, { reason, operator: OPERATOR }));
  }

  function snapshot() {
    // 数组传引用（服务会直接变更），seq 用访问器保证自增能回写
    return {
      get stations() {
        return stations.value;
      },
      get orders() {
        return orders.value;
      },
      get audit() {
        return audit.value;
      },
      get seq() {
        return seq.value;
      },
      set seq(value: number) {
        seq.value = value;
      }
    } as ReturnType<typeof repository.load>;
  }

  function resetAll() {
    const db = repository.reset();
    stations.value = db.stations;
    orders.value = db.orders;
    audit.value = db.audit;
    seq.value = db.seq;
  }

  return {
    stations,
    orders,
    audit,
    pendingOrders,
    inTransitOrders,
    closedOrders,
    shortageStations,
    stationById,
    outboundAvailability,
    inboundRoom,
    occupancyOf,
    dispatch,
    depart,
    receive,
    reject,
    cancel,
    resetAll
  };
});
