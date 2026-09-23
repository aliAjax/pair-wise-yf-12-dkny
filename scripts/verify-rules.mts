import { strict as assert } from "node:assert";
import { SEED_STATIONS } from "../src/data/seed";
import { repository } from "../src/service/repository";
import {
  requestDispatch,
  departOrder,
  receiveOrder,
  rejectOrder,
  cancelOrder
} from "../src/service/transfer";
import {
  checkFeasibility,
  inboundPendingUnload,
  outboundInTransit
} from "../src/domain/inventory";
import type { DBShape } from "../src/service/repository";

function freshDb(): DBShape {
  // 仓储以 localStorage 为后端，这里直接构造内存快照
  return {
    stations: structuredClone(SEED_STATIONS),
    orders: [],
    audit: [],
    seq: 1
  };
}

let passed = 0;
function ok(name: string) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// 场景 1：正常流程——机场快线站 P92 缺油（8000 < 安全 9000），由西区中心站补 10000L
{
  const db = freshDb();
  const from = db.stations.find((s) => s.id === "st-west-1")!;
  const to = db.stations.find((s) => s.id === "st-airport")!;

  const req = requestDispatch(db, {
    fromStationId: from.id,
    toStationId: to.id,
    productCode: "P92",
    planQty: 10000,
    operator: "王站长"
  });
  assert.equal(req.ok, true);
  assert.equal(db.orders.length, 1);
  assert.equal(db.orders[0].status, "pending");
  ok("正常申请通过，生成待发车单");

  // pending 不占仓位
  assert.equal(outboundInTransit(db.orders, from.id, "P92"), 0);
  assert.equal(inboundPendingUnload(db.orders, to.id, "P92"), 0);
  ok("待发车不占用两边仓位");

  const dep = departOrder(db, req.order!.id, "司机");
  assert.equal(dep.ok, true);
  assert.equal(db.orders[0].status, "in_transit");
  assert.equal(outboundInTransit(db.orders, from.id, "P92"), 10000);
  assert.equal(inboundPendingUnload(db.orders, to.id, "P92"), 10000);
  const fromStockBefore = from.tanks.find((t) => t.productCode === "P92")!.stock;
  const toStockBefore = to.tanks.find((t) => t.productCode === "P92")!.stock;
  assert.equal(fromStockBefore, 44000);
  assert.equal(toStockBefore, 8000);
  ok("发车后在途量双向占用，在途期间两边库存不动");

  // 足量签收
  const rec = receiveOrder(db, req.order!.id, { actualQty: 10000, lossReason: "", operator: "王站长" });
  assert.equal(rec.ok, true);
  assert.equal(from.tanks.find((t) => t.productCode === "P92")!.stock, 34000);
  assert.equal(to.tanks.find((t) => t.productCode === "P92")!.stock, 18000);
  ok("足量签收：调出按计划出库、调入按实收入库");
}

// 场景 2：调出站安全库存闸口——机场快线站自己只有 8000，安全 9000，不能调出
{
  const db = freshDb();
  const res = requestDispatch(db, {
    fromStationId: "st-airport",
    toStationId: "st-east-2",
    productCode: "P92",
    planQty: 100,
    operator: "王站长"
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("调出站库存不足")));
  assert.equal(db.orders.length, 0);
  assert.equal(db.stations.find((s) => s.id === "st-airport")!.tanks[0].stock, 8000);
  assert.equal(db.audit.length, 1);
  assert.equal(db.audit[0].action, "dispatch_rejected");
  ok("安全库存不足 → 退回，库存与列表照旧，留退回存证");
}

// 场景 3：调入罐容闸口——机场 P95 罐容 25000、库存 6000、待卸 0，只能接 19000
{
  const db = freshDb();
  const res = requestDispatch(db, {
    fromStationId: "st-west-1",
    toStationId: "st-airport",
    productCode: "P95",
    planQty: 20000,
    operator: "王站长"
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("调入站罐容不足")));
  assert.equal(db.orders.length, 0);
  ok("待卸+计划超罐容 → 退回");
}

// 场景 4：其他在途占用计入——先发一单占掉西区 P92 可调出量，再申请应被卡
{
  const db = freshDb();
  // 西区 P92：44000 - 安全15000 = 可调 29000
  const first = requestDispatch(db, {
    fromStationId: "st-west-1",
    toStationId: "st-airport",
    productCode: "P92",
    planQty: 25000, // 机场 P92 空间 = 30000-8000 = 22000… 这单会因罐容被退回
    operator: "王站长"
  });
  assert.equal(first.ok, false);
  ok("边界：调入空间 22000，申请 25000 被罐容闸口退回");

  const good = requestDispatch(db, {
    fromStationId: "st-west-1",
    toStationId: "st-airport",
    productCode: "P92",
    planQty: 20000,
    operator: "王站长"
  });
  assert.equal(good.ok, true);
  departOrder(db, good.order!.id, "司机");

  // 此时西区 P92：44000 - 在途20000 - 安全15000 = 还能调 9000
  // 机场 P92：30000 - 8000 - 在途20000 = 还剩 2000
  const second = requestDispatch(db, {
    fromStationId: "st-west-1",
    toStationId: "st-east-2",
    productCode: "P92",
    planQty: 10000,
    operator: "王站长"
  });
  assert.equal(second.ok, false);
  assert.ok(second.errors.some((e) => e.includes("最多可调 9000L")));
  ok("扣其他在途后调出可用量正确（29000 → 9000）");

  // 调入侧第二单：另一车往机场发 5000，空间只剩 2000
  const third = requestDispatch(db, {
    fromStationId: "st-east-1",
    toStationId: "st-airport",
    productCode: "P92",
    planQty: 5000,
    operator: "王站长"
  });
  // 东区一站 P92：36000 - 安全12000 = 24000 可调，调出通过；机场只剩 2000，调入不通过
  assert.equal(third.ok, false);
  assert.ok(third.errors.some((e) => e.includes("仅剩 2000L")));
  ok("待卸量计入调入罐容（空间 22000 → 2000）");
}

// 场景 5：短收 + 损耗原因必填，差额释放
{
  const db = freshDb();
  const req = requestDispatch(db, {
    fromStationId: "st-west-1",
    toStationId: "st-airport",
    productCode: "P0",
    planQty: 15000,
    operator: "王站长"
  });
  departOrder(db, req.order!.id, "司机");

  const noReason = receiveOrder(db, req.order!.id, {
    actualQty: 14800,
    lossReason: "",
    operator: "王站长"
  });
  assert.equal(noReason.ok, false);
  assert.ok(noReason.errors.some((e) => e.includes("损耗原因")));
  assert.equal(db.orders[0].status, "in_transit");
  ok("短收无原因被拒，单据仍在途、占用未释放");

  const rec = receiveOrder(db, req.order!.id, {
    actualQty: 14800,
    lossReason: "运输途中正常挥发损耗",
    operator: "王站长"
  });
  assert.equal(rec.ok, true);
  assert.equal(db.orders[0].actualQty, 14800);
  assert.equal(db.orders[0].lossQty, 200);
  const fromTank = db.stations.find((s) => s.id === "st-west-1")!.tanks.find((t) => t.productCode === "P0")!;
  const toTank = db.stations.find((s) => s.id === "st-airport")!.tanks.find((t) => t.productCode === "P0")!;
  assert.equal(fromTank.stock, 61000 - 15000); // 调出按计划
  assert.equal(toTank.stock, 9000 + 14800); // 调入按实收
  assert.equal(outboundInTransit(db.orders, "st-west-1", "P0"), 0);
  assert.equal(inboundPendingUnload(db.orders, "st-airport", "P0"), 0);
  ok("短收签收：调出按计划出库、调入按实收入库，200L 损耗立即释放并留原因");
}

// 场景 6：在途拒收 → 两边释放，库存不动
{
  const db = freshDb();
  const req = requestDispatch(db, {
    fromStationId: "st-west-1",
    toStationId: "st-airport",
    productCode: "P0",
    planQty: 12000,
    operator: "王站长"
  });
  departOrder(db, req.order!.id, "司机");
  const res = rejectOrder(db, req.order!.id, { reason: "到站检测含水超标", operator: "王站长" });
  assert.equal(res.ok, true);
  assert.equal(db.orders[0].status, "rejected");
  assert.equal(db.stations.find((s) => s.id === "st-west-1")!.tanks.find((t) => t.productCode === "P0")!.stock, 61000);
  assert.equal(db.stations.find((s) => s.id === "st-airport")!.tanks.find((t) => t.productCode === "P0")!.stock, 9000);
  assert.equal(outboundInTransit(db.orders, "st-west-1", "P0"), 0);
  assert.equal(inboundPendingUnload(db.orders, "st-airport", "P0"), 0);
  assert.equal(res.audit.detail.reason, "到站检测含水超标");
  assert.ok(res.audit.detail.note);
  ok("在途拒收：原车退回，库存不变，占用全释放，原因留档");

  // 无原因拒收应失败
  const db2 = freshDb();
  const r2 = requestDispatch(db2, {
    fromStationId: "st-west-1",
    toStationId: "st-airport",
    productCode: "P0",
    planQty: 1000,
    operator: "x"
  });
  departOrder(db2, r2.order!.id, "x");
  const bad = rejectOrder(db2, r2.order!.id, { reason: "  ", operator: "x" });
  assert.equal(bad.ok, false);
  ok("拒收无原因被拦截");
}

// 场景 7：在途取消（原车退回）与待发车取消
{
  const db = freshDb();
  const req = requestDispatch(db, {
    fromStationId: "st-west-1",
    toStationId: "st-airport",
    productCode: "P0",
    planQty: 8000,
    operator: "王站长"
  });

  // 待发车取消：无原因可通过，不涉及占用
  assert.equal(cancelOrder(db, req.order!.id, { reason: "", operator: "王站长" }).ok, true);
  assert.equal(db.orders[0].status, "cancelled");

  // 再来一单发车后取消
  const req2 = requestDispatch(db, {
    fromStationId: "st-west-1",
    toStationId: "st-airport",
    productCode: "P0",
    planQty: 8000,
    operator: "王站长"
  });
  departOrder(db, req2.order!.id, "司机");
  const bad = cancelOrder(db, req2.order!.id, { reason: " ", operator: "王站长" });
  assert.equal(bad.ok, false);
  const okc = cancelOrder(db, req2.order!.id, { reason: "道路封闭，原车退回", operator: "王站长" });
  assert.equal(okc.ok, true);
  assert.equal(outboundInTransit(db.orders, "st-west-1", "P0"), 0);
  assert.equal(inboundPendingUnload(db.orders, "st-airport", "P0"), 0);
  ok("取消：待发车无需原因；在途取消必须有原因并释放两边占用");
}

// 场景 8：同站 / 未配置油品 / 非法数量
{
  const db = freshDb();
  assert.equal(
    checkFeasibility({
      from: db.stations[0],
      to: db.stations[0],
      productCode: "P92",
      planQty: 100,
      orders: []
    }).feasible,
    false
  );
  const badQty = requestDispatch(db, {
    fromStationId: "st-west-1",
    toStationId: "st-airport",
    productCode: "P92",
    planQty: 0,
    operator: "x"
  });
  assert.equal(badQty.ok, false);
  assert.ok(badQty.errors.some((e) => e.includes("计划量")));
  ok("同站调拨 / 非法计划量被拦截");
}

// 场景 9：签收超量不允许
{
  const db = freshDb();
  const req = requestDispatch(db, {
    fromStationId: "st-west-1",
    toStationId: "st-airport",
    productCode: "P0",
    planQty: 5000,
    operator: "x"
  });
  departOrder(db, req.order!.id, "司机");
  const over = receiveOrder(db, req.order!.id, { actualQty: 5001, lossReason: "", operator: "x" });
  assert.equal(over.ok, false);
  assert.ok(over.errors.some((e) => e.includes("不能超过计划量")));
  ok("实收不得超过计划量");
}

console.log(`\n全部 ${passed} 项领域规则验证通过`);
