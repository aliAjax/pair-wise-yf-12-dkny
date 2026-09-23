// 持久化仓储：localStorage 读写，后续可无缝替换为 HTTP 接口实现。
// 页面和服务只依赖这个接口，不直接碰 localStorage。

import type { AuditEntry } from "./audit";
import { SEED_STATIONS } from "../data/seed";
import type { Station, TransferOrder } from "../domain/types";

const STATIONS_KEY = "hxwlfront-21:stations";
const ORDERS_KEY = "hxwlfront-21:orders";
const AUDIT_KEY = "hxwlfront-21:audit";
const SEQ_KEY = "hxwlfront-21:seq";

function read<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export interface DBShape {
  stations: Station[];
  orders: TransferOrder[];
  audit: AuditEntry[];
  seq: number;
}

export const repository = {
  load(): DBShape {
    return {
      stations: read<Station[]>(STATIONS_KEY, SEED_STATIONS),
      orders: read<TransferOrder[]>(ORDERS_KEY, []),
      audit: read<AuditEntry[]>(AUDIT_KEY, []),
      seq: read<number>(SEQ_KEY, 1)
    };
  },
  save(db: DBShape): void {
    write(STATIONS_KEY, db.stations);
    write(ORDERS_KEY, db.orders);
    write(AUDIT_KEY, db.audit);
    write(SEQ_KEY, db.seq);
  },
  /** 演示用：恢复种子网点并清空全部单据与存证 */
  reset(): DBShape {
    localStorage.removeItem(STATIONS_KEY);
    localStorage.removeItem(ORDERS_KEY);
    localStorage.removeItem(AUDIT_KEY);
    localStorage.removeItem(SEQ_KEY);
    return { stations: structuredClone(SEED_STATIONS), orders: [], audit: [], seq: 1 };
  }
};
