// 库存判定层：纯函数，不读存储、不依赖 Vue。
// 所有「能不能调、能调多少、谁占了多少」的规则集中在这里，便于单测与审计复核。

import type { ProductCode, Station, Tank, TransferOrder } from "./types";

export function findTank(station: Station, productCode: ProductCode): Tank | undefined {
  return station.tanks.find((tank) => tank.productCode === productCode);
}

/**
 * 调出站为该油品已承担的「其他在途调拨」占用量。
 * 口径：本单除外、油品相同、状态为在途的计划量之和。
 * （被拒收/取消的单据立即释放，不计入。）
 */
export function outboundInTransit(
  orders: TransferOrder[],
  stationId: string,
  productCode: ProductCode,
  excludeOrderId?: string
): number {
  return orders
    .filter(
      (order) =>
        order.status === "in_transit" &&
        order.fromStationId === stationId &&
        order.productCode === productCode &&
        order.id !== excludeOrderId
    )
    .reduce((sum, order) => sum + order.planQty, 0);
}

/**
 * 调入站为该油品已承担的「待卸量」占用。
 * 口径：本单除外、油品相同、状态为在途的计划量之和（车在路上、到站待卸的都算）。
 */
export function inboundPendingUnload(
  orders: TransferOrder[],
  stationId: string,
  productCode: ProductCode,
  excludeOrderId?: string
): number {
  return orders
    .filter(
      (order) =>
        order.status === "in_transit" &&
        order.toStationId === stationId &&
        order.productCode === productCode &&
        order.id !== excludeOrderId
    )
    .reduce((sum, order) => sum + order.planQty, 0);
}

export interface FeasibilityInput {
  from: Station;
  to: Station;
  productCode: ProductCode;
  planQty: number;
  orders: TransferOrder[];
}

export interface FeasibilityResult {
  feasible: boolean;
  /** 任一规则不过即整体退回，errors 给出全部命中的原因（列表与库存照旧） */
  errors: string[];
  snapshot: {
    fromStock: number;
    fromSafety: number;
    fromOtherInTransit: number;
    fromAvailable: number;
    toStock: number;
    toCapacity: number;
    toPendingUnload: number;
    toRoom: number;
  };
}

/**
 * 补货可行性判定（核心规则）：
 * 1. 调出站：库存 - 其他在途调拨占用 >= 安全库存 + 本次计划量
 *    （即扣掉别人的在途后还要留足安全库存，再装得下本次计划量）
 * 2. 调入站：现有库存 + 已有待卸量 + 本次计划量 <= 罐容
 *    （待卸量与计划量之和不得超出罐容剩余空间）
 * 任一项不足即退回，调用方不得改动任何列表与库存。
 */
export function checkFeasibility(input: FeasibilityInput): FeasibilityResult {
  const { from, to, productCode, planQty, orders } = input;
  const errors: string[] = [];

  if (from.id === to.id) {
    errors.push("调出站与调入站不能是同一个网点");
  }
  if (!Number.isFinite(planQty) || planQty <= 0) {
    errors.push("计划量必须为大于 0 的整数升数");
  }

  const fromTank = findTank(from, productCode);
  const toTank = findTank(to, productCode);

  if (!fromTank) {
    errors.push(`调出站「${from.name}」未配置该油品油罐，无法调出`);
  }
  if (!toTank) {
    errors.push(`调入站「${to.name}」未配置该油品油罐，无法接收`);
  }

  const fromOtherInTransit = outboundInTransit(orders, from.id, productCode);
  const toPendingUnload = inboundPendingUnload(orders, to.id, productCode);

  const fromStock = fromTank?.stock ?? 0;
  const fromSafety = fromTank?.safety ?? 0;
  const fromAvailable = fromStock - fromOtherInTransit - fromSafety;

  const toStock = toTank?.stock ?? 0;
  const toCapacity = toTank?.capacity ?? 0;
  const toRoom = toCapacity - toStock - toPendingUnload;

  if (fromTank && fromStock - fromOtherInTransit - planQty < fromSafety) {
    errors.push(
      `调出站库存不足：当前 ${fromStock}L，扣除其他在途 ${fromOtherInTransit}L、留足安全库存 ${fromSafety}L 后，` +
        `最多可调 ${Math.max(0, fromAvailable)}L，本次申请 ${planQty}L`
    );
  }

  if (toTank && toStock + toPendingUnload + planQty > toCapacity) {
    errors.push(
      `调入站罐容不足：当前库存 ${toStock}L、已有待卸 ${toPendingUnload}L，罐容 ${toCapacity}L，` +
        `仅剩 ${Math.max(0, toRoom)}L 空间，本次计划 ${planQty}L`
    );
  }

  return {
    feasible: errors.length === 0,
    errors,
    snapshot: {
      fromStock,
      fromSafety,
      fromOtherInTransit,
      fromAvailable,
      toStock,
      toCapacity,
      toPendingUnload,
      toRoom
    }
  };
}

/**
 * 发车瞬间二次确认：调度申请可能是早先通过的，发车时重跑一次完整规则，
 * 把「其他在途单」都计入，防止申请通过后仓位被别的车占走仍然发车。
 * 本单仍是 pending，天然不会被在途口径统计，无需排除。
 */
export function canDepart(
  order: TransferOrder,
  from: Station,
  to: Station,
  orders: TransferOrder[]
): boolean {
  if (order.status !== "pending") return false;
  const result = checkFeasibility({
    from,
    to,
    productCode: order.productCode,
    planQty: order.planQty,
    orders
  });
  return result.feasible;
}

/** 签收量合法性：允许少于计划量（损耗），不得多于计划量，不得为负 */
export function validateReceipt(order: TransferOrder, actualQty: number, lossReason: string): string[] {
  const errors: string[] = [];
  if (order.status !== "in_transit") {
    errors.push("仅在途单据可以卸油签收");
  }
  if (!Number.isFinite(actualQty) || actualQty < 0) {
    errors.push("实收量必须为不小于 0 的数字");
  }
  if (actualQty > order.planQty) {
    errors.push(`实收量 ${actualQty}L 不能超过计划量 ${order.planQty}L`);
  }
  if (actualQty < order.planQty && !lossReason.trim()) {
    errors.push("实收少于计划量时，必须填写损耗原因留档");
  }
  return errors;
}
