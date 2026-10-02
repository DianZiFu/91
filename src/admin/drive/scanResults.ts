import type { ScanOutcome } from "../api";

export const scanOutcomeLabels: Record<ScanOutcome, string> = {
  succeeded: "已完成",
  partial: "部分完成",
  failed: "失败",
  canceled: "已取消",
  skipped: "已跳过",
};

export const scanOutcomeClasses: Record<ScanOutcome, string> = {
  succeeded: "idle",
  partial: "cooling",
  failed: "error",
  canceled: "queued",
  skipped: "queued",
};

export function isGenerationBusy(state: string): boolean {
  return ["scanning", "uploading", "generating", "cooling", "queued"].includes(state);
}

export const scanResultMetrics = [
  { key: "scannedCount", label: "已扫描" },
  { key: "addedCount", label: "新增" },
  { key: "updatedCount", label: "更新" },
  { key: "skippedCount", label: "跳过" },
  { key: "cleanedCount", label: "清理" },
  { key: "errorCount", label: "错误" },
] as const;
