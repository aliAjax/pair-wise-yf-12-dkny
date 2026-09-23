import type { DispatchOrder, Product, Station, Tank } from "./types";

export function findTank(station: Station | undefined, product: Product): Tank | undefined {
  return station?.tanks.find((tank) => tank.product === product);
}

/** 在途调出量：车辆发出后占用调出站仓位 */
export function inTransitOutLiters(orders: DispatchOrder[], stationId: string, product: Product): number {
  return orders
    .filter((order) => order.status === "在途" && order.fromStationId === stationId && order.product === product)
    .reduce((sum, order) => sum + order.plannedQty, 0);
}

/** 待卸量：在途调入占用调入站罐容 */
export function inTransitInLiters(orders: DispatchOrder[], stationId: string, product: Product): number {
  return orders
    .filter((order) => order.status === "在途" && order.toStationId === stationId && order.product === product)
    .reduce((sum, order) => sum + order.plannedQty, 0);
}

/** 调出站可调配余量：现有库存扣掉安全库存和其他在途调拨 */
export function sourceAvailableLiters(tank: Tank, orders: DispatchOrder[], stationId: string): number {
  return tank.stock - tank.safetyStock - inTransitOutLiters(orders, stationId, tank.product);
}

/** 调入站可接收空间：罐容扣掉当前库存和待卸在途量 */
export function receiverFreeLiters(tank: Tank, orders: DispatchOrder[], stationId: string): number {
  return tank.capacity - tank.stock - inTransitInLiters(orders, stationId, tank.product);
}

export interface DispatchCheckInput {
  plannedQty: number;
  fromStation: Station;
  fromTank: Tank;
  toStation: Station;
  toTank: Tank;
  orders: DispatchOrder[];
}

export interface DispatchCheckResult {
  ok: boolean;
  failures: string[];
}

/** 库存判定：任一项不足即退回，调用方不得改动列表和库存 */
export function validateDispatch(input: DispatchCheckInput): DispatchCheckResult {
  const { plannedQty, fromStation, fromTank, toStation, toTank, orders } = input;
  const failures: string[] = [];

  if (!Number.isFinite(plannedQty) || plannedQty <= 0) {
    failures.push("计划量必须为大于 0 的数字");
    return { ok: false, failures };
  }

  const available = sourceAvailableLiters(fromTank, orders, fromStation.id);
  if (plannedQty > available) {
    failures.push(
      `调出站「${fromStation.name}」${fromTank.product}可调出 ${available}L（已扣安全库存 ${fromTank.safetyStock}L 与在途调拨），不足计划量 ${plannedQty}L`
    );
  }

  const free = receiverFreeLiters(toTank, orders, toStation.id);
  if (plannedQty > free) {
    failures.push(
      `调入站「${toStation.name}」${toTank.product}可接收 ${free}L（罐容 ${toTank.capacity}L 扣当前库存与待卸量），不足计划量 ${plannedQty}L`
    );
  }

  return { ok: failures.length === 0, failures };
}
