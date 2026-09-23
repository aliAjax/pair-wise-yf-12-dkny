// 补货调度领域模型：油品、油罐、网点、调拨单
// 数量单位统一为「升」，全部取整数。

export type ProductCode = "P92" | "P95" | "P0";

export interface Product {
  code: ProductCode;
  name: string;
}

/** 单个网点单个油品的油罐台账 */
export interface Tank {
  productCode: ProductCode;
  /** 罐容（升） */
  capacity: number;
  /** 当前实测库存（升） */
  stock: number;
  /** 安全库存（升）：调出后仍须保留的底线 */
  safety: number;
}

export interface Station {
  id: string;
  name: string;
  area: string;
  manager: string;
  /** 未配置某油品油罐 = 该站不经营此油品，不能参与该油品调拨 */
  tanks: Tank[];
}

/**
 * 调拨单状态机：
 * pending 待发车 -> in_transit 在途 -> received 已签收
 *                    ├─> rejected 已拒收
 *                    └─> cancelled 已取消（在途取消按原车退回处理）
 * pending 可直接 cancelled（尚未发车，不占仓位）
 */
export type OrderStatus =
  | "pending"
  | "in_transit"
  | "received"
  | "rejected"
  | "cancelled";

export interface TransferOrder {
  id: string;
  /** 调度单号 */
  code: string;
  fromStationId: string;
  toStationId: string;
  productCode: ProductCode;
  /** 计划量（升） */
  planQty: number;
  status: OrderStatus;

  createdAt: string;
  createdBy: string;

  /** 车辆发出时间，自此在途量同时占用调出 / 调入两边仓位 */
  departedAt?: string;
  departedBy?: string;

  /** 卸油签收：实收允许少于计划，差额（损耗）立即释放调入仓位 */
  actualQty?: number;
  lossQty?: number;
  lossReason?: string;
  receivedAt?: string;
  receivedBy?: string;

  /** 拒收：原车退回，库存与两边占用全部释放 */
  rejectedAt?: string;
  rejectedBy?: string;
  rejectReason?: string;

  /** 取消：待发车直接关闭；在途取消按原车退回处理 */
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
}
