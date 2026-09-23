// 调度存证：审计流水。任何影响库存 / 仓位占用的动作都必须留一条不可变记录。

export type AuditAction =
  | "dispatch_rejected" // 调度申请因库存/罐容不足被退回
  | "order_created" // 调度单创建（待发车）
  | "order_departed" // 车辆发出，在途量双向占用
  | "order_received" // 卸油签收（含损耗释放）
  | "order_rejected" // 拒收，原车退回释放
  | "order_cancelled"; // 取消，释放占用

export interface AuditEntry {
  id: string;
  /** 关联调度单号，dispatch_rejected 时为"申请时生成的临时号" */
  refCode: string;
  action: AuditAction;
  /** 操作人（演示环境固定，可对接登录态） */
  operator: string;
  at: string;
  /** 机器可读的存证明细：判定快照、数量变动、原因 */
  detail: Record<string, unknown>;
}

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  dispatch_rejected: "调度退回",
  order_created: "创建调度单",
  order_departed: "车辆发出",
  order_received: "卸油签收",
  order_rejected: "拒收退回",
  order_cancelled: "取消释放"
};
