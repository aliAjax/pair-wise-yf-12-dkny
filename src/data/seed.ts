import type { Product, ProductCode, Station } from "../domain/types";

export const PRODUCTS: Product[] = [
  { code: "P92", name: "92#汽油" },
  { code: "P95", name: "95#汽油" },
  { code: "P0", name: "0#柴油" }
];

export function productName(code: ProductCode): string {
  return PRODUCTS.find((item) => item.code === code)?.name ?? code;
}

/** 初始网点台账：罐容 / 库存 / 安全库存（单位：升） */
export const SEED_STATIONS: Station[] = [
  {
    id: "st-east-1",
    name: "东区一站",
    area: "东区",
    manager: "刘站长",
    tanks: [
      { productCode: "P92", capacity: 50000, stock: 36000, safety: 12000 },
      { productCode: "P95", capacity: 40000, stock: 21000, safety: 10000 },
      { productCode: "P0", capacity: 60000, stock: 42000, safety: 15000 }
    ]
  },
  {
    id: "st-east-2",
    name: "东区二站",
    area: "东区",
    manager: "陈站长",
    tanks: [
      { productCode: "P92", capacity: 40000, stock: 28000, safety: 10000 },
      { productCode: "P95", capacity: 30000, stock: 9500, safety: 8000 },
      { productCode: "P0", capacity: 50000, stock: 31000, safety: 12000 }
    ]
  },
  {
    id: "st-west-1",
    name: "西区中心站",
    area: "西区",
    manager: "赵站长",
    tanks: [
      { productCode: "P92", capacity: 60000, stock: 44000, safety: 15000 },
      { productCode: "P95", capacity: 50000, stock: 33000, safety: 12000 },
      { productCode: "P0", capacity: 80000, stock: 61000, safety: 20000 }
    ]
  },
  {
    id: "st-airport",
    name: "机场快线站",
    area: "机场线",
    manager: "王站长",
    tanks: [
      { productCode: "P92", capacity: 30000, stock: 8000, safety: 9000 },
      { productCode: "P95", capacity: 25000, stock: 6000, safety: 7000 },
      { productCode: "P0", capacity: 40000, stock: 9000, safety: 12000 }
    ]
  }
];
