import { reactive } from "vue";
import type { ProductCode } from "../domain/types";

export type TabKey = "stations" | "dispatch" | "orders" | "audit";

/** 跨页面交互：网点列表点「发起补货」后带上下文跳到调度页 */
export const uiState = reactive<{
  activeTab: TabKey;
  dispatchPrefill: { toStationId: string; productCode: ProductCode } | null;
}>({
  activeTab: "stations",
  dispatchPrefill: null
});

export function gotoDispatch(toStationId: string, productCode: ProductCode) {
  uiState.dispatchPrefill = { toStationId, productCode };
  uiState.activeTab = "dispatch";
}
