// 调度服务：编排「库存判定 → 状态流转 → 库存结算 → 存证」。
// 服务只操作传入的数据快照，不关心 Vue 和持久化；store 负责调用并落盘。
//
// 关键台账约定（库存判定与库存结算是两套口径，互不重复计算）：
// - Tank.stock 始终表示「本站实测库存」，在途期间两边 stock 都不变；
// - 在途对两边仓位的占用由在途调拨单实时推导（见 domain/inventory.ts）；
// - 签收时一次性结算：调出站按计划量出库，调入站按实收量入库，差额（损耗）当场释放。

import { canDepart, checkFeasibility, findTank, validateReceipt } from "../domain/inventory";
import type { ProductCode, TransferOrder } from "../domain/types";
import type { AuditEntry } from "./audit";
import type { DBShape } from "./repository";

export interface ActionResult {
  ok: boolean;
  errors: string[];
  audit: AuditEntry;
  order?: TransferOrder;
}

interface OperatorParam {
  operator: string;
}

export interface DispatchRequest extends OperatorParam {
  fromStationId: string;
  toStationId: string;
  productCode: ProductCode;
  planQty: number;
}

export interface ReceiptParam extends OperatorParam {
  actualQty: number;
  lossReason: string;
}

export interface CloseParam extends OperatorParam {
  reason: string;
}

function nextCode(seq: number): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}`;
  return `DB${ymd}-${String(seq).padStart(4, "0")}`;
}

function makeAudit(refCode: string, action: AuditEntry["action"], operator: string, detail: AuditEntry["detail"]): AuditEntry {
  return {
    id: crypto.randomUUID(),
    refCode,
    action,
    operator,
    at: new Date().toISOString(),
    detail
  };
}

function findStation(db: DBShape, id: string) {
  return db.stations.find((station) => station.id === id);
}

/**
 * 发起补货调度。
 * 任一项不足：仅追加一条「调度退回」存证，网点列表、库存、单据列表全部照旧。
 */
export function requestDispatch(db: DBShape, param: DispatchRequest): ActionResult {
  const code = nextCode(db.seq);
  db.seq += 1;

  const from = findStation(db, param.fromStationId);
  const to = findStation(db, param.toStationId);
  const errors: string[] = [];
  if (!from) errors.push("调出站不存在或已停用");
  if (!to) errors.push("调入站不存在或已停用");

  let snapshot: ReturnType<typeof checkFeasibility>["snapshot"] | undefined;
  if (from && to) {
    const result = checkFeasibility({
      from,
      to,
      productCode: param.productCode,
      planQty: param.planQty,
      orders: db.orders
    });
    snapshot = result.snapshot;
    errors.push(...result.errors);
  }

  if (errors.length > 0) {
    const audit = makeAudit(code, "dispatch_rejected", param.operator, {
      request: { ...param },
      snapshot,
      errors
    });
    db.audit.unshift(audit);
    return { ok: false, errors, audit };
  }

  const now = new Date().toISOString();
  const order: TransferOrder = {
    id: crypto.randomUUID(),
    code,
    fromStationId: param.fromStationId,
    toStationId: param.toStationId,
    productCode: param.productCode,
    planQty: param.planQty,
    status: "pending",
    createdAt: now,
    createdBy: param.operator
  };
  db.orders.unshift(order);

  const audit = makeAudit(code, "order_created", param.operator, {
    orderId: order.id,
    request: { ...param },
    snapshot,
    note: "待发车，尚未占用仓位"
  });
  db.audit.unshift(audit);
  return { ok: true, errors: [], audit, order };
}

/** 车辆发出：二次复校两边仓位；通过后转在途，在途量同时占用调出 / 调入仓位。 */
export function departOrder(db: DBShape, orderId: string, operator: string): ActionResult {
  const order = db.orders.find((item) => item.id === orderId);
  const code = order?.code ?? "-";
  if (!order) {
    const audit = makeAudit(code, "dispatch_rejected", operator, { stage: "depart", errors: ["调度单不存在"] });
    db.audit.unshift(audit);
    return { ok: false, errors: ["调度单不存在"], audit };
  }
  if (order.status !== "pending") {
    return {
      ok: false,
      errors: [`当前状态「${order.status}」不能发车`],
      audit: makeAudit(code, "dispatch_rejected", operator, {
        stage: "depart",
        orderId: order.id,
        errors: ["单据不在待发车状态"]
      })
    };
  }

  const from = findStation(db, order.fromStationId);
  const to = findStation(db, order.toStationId);
  const errors: string[] = [];
  if (!from) errors.push("调出站不存在");
  if (!to) errors.push("调入站不存在");
  if (from && to && !canDepart(order, from, to, db.orders)) {
    const result = checkFeasibility({
      from,
      to,
      productCode: order.productCode,
      planQty: order.planQty,
      orders: db.orders
    });
    errors.push(...result.errors);
  }
  if (errors.length > 0) {
    const audit = makeAudit(code, "dispatch_rejected", operator, {
      stage: "depart",
      orderId: order.id,
      errors
    });
    db.audit.unshift(audit);
    return { ok: false, errors, audit };
  }

  order.status = "in_transit";
  order.departedAt = new Date().toISOString();
  order.departedBy = operator;

  const audit = makeAudit(code, "order_departed", operator, {
    orderId: order.id,
    occupancy: {
      side: "both",
      stationIds: [order.fromStationId, order.toStationId],
      productCode: order.productCode,
      qty: order.planQty,
      note: "在途量同时占用调出站可调出量与调入站罐容"
    }
  });
  db.audit.unshift(audit);
  return { ok: true, errors: [], audit, order };
}

/**
 * 卸油签收：实收允许少于计划量。
 * - 调出站按计划量出库；
 * - 调入站按实收量入库；
 * - 差额（损耗）立即释放调入仓位，并强制留原因。
 */
export function receiveOrder(db: DBShape, orderId: string, param: ReceiptParam): ActionResult {
  const order = db.orders.find((item) => item.id === orderId);
  const code = order?.code ?? "-";
  if (!order) {
    const audit = makeAudit(code, "order_received", param.operator, { errors: ["调度单不存在"] });
    db.audit.unshift(audit);
    return { ok: false, errors: ["调度单不存在"], audit };
  }

  const actualQty = Math.round(Number(param.actualQty));
  const errors = validateReceipt(order, actualQty, param.lossReason);
  if (errors.length > 0) {
    const audit = makeAudit(code, "order_received", param.operator, { orderId: order.id, rejected: true, errors });
    db.audit.unshift(audit);
    return { ok: false, errors, audit };
  }

  const lossQty = order.planQty - actualQty;
  const from = findStation(db, order.fromStationId);
  const to = findStation(db, order.toStationId);
  const fromTank = from ? findTank(from, order.productCode) : undefined;
  const toTank = to ? findTank(to, order.productCode) : undefined;

  if (!fromTank || !toTank) {
    const audit = makeAudit(code, "order_received", param.operator, {
      orderId: order.id,
      rejected: true,
      errors: ["网点油罐台账缺失，无法结算"]
    });
    db.audit.unshift(audit);
    return { ok: false, errors: ["网点油罐台账缺失，无法结算"], audit };
  }

  const fromBefore = fromTank.stock;
  const toBefore = toTank.stock;
  fromTank.stock = Math.max(0, fromTank.stock - order.planQty);
  toTank.stock = toTank.stock + actualQty;

  order.status = "received";
  order.actualQty = actualQty;
  order.lossQty = lossQty;
  order.lossReason = lossQty > 0 ? param.lossReason.trim() : undefined;
  order.receivedAt = new Date().toISOString();
  order.receivedBy = param.operator;

  const audit = makeAudit(code, "order_received", param.operator, {
    orderId: order.id,
    settlement: {
      productCode: order.productCode,
      planQty: order.planQty,
      actualQty,
      lossQty,
      lossReason: order.lossReason ?? null,
      releasedOccupancy: lossQty,
      from: { stationId: from!.id, before: fromBefore, after: fromTank.stock, outbound: order.planQty },
      to: { stationId: to!.id, before: toBefore, after: toTank.stock, inbound: actualQty }
    }
  });
  db.audit.unshift(audit);
  return { ok: true, errors: [], audit, order };
}

/** 拒收：仅在途可拒收，原车退回；两边占用立即释放，库存不动。 */
export function rejectOrder(db: DBShape, orderId: string, param: CloseParam): ActionResult {
  const order = db.orders.find((item) => item.id === orderId);
  const code = order?.code ?? "-";
  const errors: string[] = [];
  if (!order) errors.push("调度单不存在");
  else if (order.status !== "in_transit") errors.push("仅在途单据可以拒收");
  if (!param.reason.trim()) errors.push("拒收必须填写原因留档");

  if (errors.length > 0 || !order) {
    const audit = makeAudit(code, "order_rejected", param.operator, { orderId, rejected: true, errors });
    db.audit.unshift(audit);
    return { ok: false, errors, audit };
  }

  order.status = "rejected";
  order.rejectedAt = new Date().toISOString();
  order.rejectedBy = param.operator;
  order.rejectReason = param.reason.trim();

  const audit = makeAudit(code, "order_rejected", param.operator, {
    orderId: order.id,
    released: { side: "both", qty: order.planQty },
    reason: order.rejectReason,
    note: "原车退回，库存不变，调出/调入占用同步释放"
  });
  db.audit.unshift(audit);
  return { ok: true, errors: [], audit, order };
}

/**
 * 取消：待发车可直接取消（本未占仓）；在途取消按原车退回处理（释放两边占用，库存不动）。
 */
export function cancelOrder(db: DBShape, orderId: string, param: CloseParam): ActionResult {
  const order = db.orders.find((item) => item.id === orderId);
  const code = order?.code ?? "-";
  const errors: string[] = [];
  if (!order) errors.push("调度单不存在");
  else if (order.status !== "pending" && order.status !== "in_transit") {
    errors.push("仅待发车 / 在途单据可以取消");
  } else if (order.status === "in_transit" && !param.reason.trim()) {
    errors.push("在途取消必须填写原车退回说明");
  }

  if (errors.length > 0 || !order) {
    const audit = makeAudit(code, "order_cancelled", param.operator, { orderId, rejected: true, errors });
    db.audit.unshift(audit);
    return { ok: false, errors, audit };
  }

  const wasInTransit = order.status === "in_transit";
  order.status = "cancelled";
  order.cancelledAt = new Date().toISOString();
  order.cancelledBy = param.operator;
  order.cancelReason = param.reason.trim() || "待发车取消，未发生占用";

  const audit = makeAudit(code, "order_cancelled", param.operator, {
    orderId: order.id,
    wasInTransit,
    released: wasInTransit ? { side: "both", qty: order.planQty } : { side: "none", qty: 0 },
    reason: order.cancelReason
  });
  db.audit.unshift(audit);
  return { ok: true, errors: [], audit, order };
}
