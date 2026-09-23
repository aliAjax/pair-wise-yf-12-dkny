export type Product = "92#汽油" | "95#汽油" | "0#柴油";

export const PRODUCTS: readonly Product[] = ["92#汽油", "95#汽油", "0#柴油"];

export interface Tank {
  product: Product;
  /** 当前库存 L */
  stock: number;
  /** 罐容 L */
  capacity: number;
  /** 安全库存 L */
  safetyStock: number;
}

export interface Station {
  id: string;
  name: string;
  area: string;
  manager: string;
  tanks: Tank[];
}

export type DispatchStatus = "待发出" | "在途" | "已签收" | "已取消" | "已拒收";

export interface DispatchEvent {
  at: string;
  action: string;
  detail: string;
}

export interface DispatchOrder {
  id: string;
  code: string;
  fromStationId: string;
  toStationId: string;
  product: Product;
  plannedQty: number;
  receivedQty: number | null;
  lossQty: number;
  lossReason: string;
  status: DispatchStatus;
  createdAt: string;
  departedAt: string | null;
  closedAt: string | null;
  /** 调度存证：每次状态流转留档 */
  events: DispatchEvent[];
}
