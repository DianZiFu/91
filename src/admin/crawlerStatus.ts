import type { AdminCrawler, CrawlerDryRunResult, DriveGenerationStatus } from "./api";
import { isGenerationBusy } from "./drive/scanResults";

export type CrawlerAction = "run" | "upload" | "stop" | "pause";
export type CrawlerDisplayStatus = {
  text: string;
  tone: "idle" | "queued" | "generating";
};

const idleStatus: CrawlerDisplayStatus = { text: "空闲", tone: "idle" };
const waitingStatus: CrawlerDisplayStatus = { text: "等待中", tone: "queued" };

function activityStatus(state: string | undefined, activeText = "进行中"): CrawlerDisplayStatus {
  if (state === "queued" || state === "cooling") return waitingStatus;
  if (state === "running" || isGenerationBusy(state ?? "")) {
    return { text: activeText, tone: "generating" };
  }
  return idleStatus;
}

export function crawlerGenerationStatus(status?: DriveGenerationStatus): CrawlerDisplayStatus {
  return activityStatus(status?.state);
}

function taskActive<T extends { state: string }>(task: T | undefined): task is T & { state: "queued" | "running" } {
  return task?.state === "queued" || task?.state === "running";
}

export function crawlerBusy(crawler: AdminCrawler) {
  return taskActive(crawler.currentTask) || taskActive(crawler.lastUploadResult) || [
    crawler.scanGenerationStatus,
    crawler.thumbnailGenerationStatus,
    crawler.previewGenerationStatus,
    crawler.fingerprintGenerationStatus,
    crawler.uploadGenerationStatus,
  ].some(status => isGenerationBusy(status?.state ?? ""));
}

export function crawlerTaskStatus(crawler: AdminCrawler): CrawlerDisplayStatus {
  const task = crawler.currentTask;
  if (taskActive(task)) {
    const text = task.stopRequested ? "收尾中"
      : task.stage === "generation" ? "生成中"
      : task.stage === "upload" ? crawler.uploadDriveId ? "上传中" : "处理中"
      : "抓取中";
    return activityStatus(task.state, text);
  }
  return activityStatus(crawler.scanGenerationStatus?.state, "抓取中");
}

// Generation and upload keep the pipeline busy after acquisition has ended.
// The crawl card reports acquisition activity separately from the row badge.
export function crawlerCrawlStatus(crawler: AdminCrawler): CrawlerDisplayStatus {
  const task = crawler.currentTask;
  if (taskActive(task)) {
    if (task.state === "running" && (task.stage === "generation" || task.stage === "upload")) return idleStatus;
    return activityStatus(task.state);
  }
  if (taskActive(crawler.lastUploadResult) || isGenerationBusy(crawler.uploadGenerationStatus?.state ?? "")) {
    return idleStatus;
  }
  return crawlerGenerationStatus(crawler.scanGenerationStatus);
}

// Active uploads may not have a target ID until their final result is saved.
// Historical results for a different target must not describe the current one.
export function crawlerUploadResult(crawler: AdminCrawler) {
  const result = crawler.lastUploadResult;
  if (!result) return undefined;
  if (taskActive(result)) return result;
  if (!crawler.uploadDriveId) return undefined;
  return !result.targetDriveId || result.targetDriveId === crawler.uploadDriveId ? result : undefined;
}

export function crawlerUploadStatus(crawler: AdminCrawler): CrawlerDisplayStatus {
  const live = crawler.uploadGenerationStatus?.state;
  if (isGenerationBusy(live ?? "")) return activityStatus(live);
  const result = crawlerUploadResult(crawler);
  if (taskActive(result)) return activityStatus(result.state);
  if (crawler.uploadDriveId && taskActive(crawler.currentTask)) return waitingStatus;
  return idleStatus;
}

export function crawlerActivity(crawler: AdminCrawler): CrawlerDisplayStatus | undefined {
  if (taskActive(crawler.currentTask)) return crawlerTaskStatus(crawler);
  if (isGenerationBusy(crawler.uploadGenerationStatus?.state ?? "")) {
    return activityStatus(crawler.uploadGenerationStatus?.state, "上传中");
  }
  if (taskActive(crawler.lastUploadResult)) return activityStatus(crawler.lastUploadResult.state, "上传中");
  const generation = [crawler.thumbnailGenerationStatus, crawler.previewGenerationStatus, crawler.fingerprintGenerationStatus]
    .map(crawlerGenerationStatus);
  if (generation.some(status => status.tone === "generating")) {
    return { text: "生成中", tone: "generating" };
  }
  if (generation.some(status => status.tone === "queued")) return waitingStatus;
  if (isGenerationBusy(crawler.scanGenerationStatus?.state ?? "")) return crawlerTaskStatus(crawler);
  return undefined;
}

export function crawlerActionReasons(crawler: AdminCrawler, options: {
  pending?: CrawlerAction;
  maintenanceBusy: boolean;
  uploadTargetAvailable: boolean;
}) {
  const busyReason = options.pending ? "操作处理中，请稍候"
    : crawlerBusy(crawler) ? "当前任务尚未结束，请稍后重试"
    : options.maintenanceBusy ? "后台批量任务正在进行，请稍后重试" : "";
  return {
    run: busyReason || (crawler.scriptError ? "脚本不可用，请查看日志" : "") || (!crawler.scriptPath ? "请先导入爬虫脚本" : ""),
    upload: busyReason || (!crawler.uploadDriveId ? "请先配置上传网盘"
      : !options.uploadTargetAvailable ? "上传目标不可用，请检查网盘配置" : ""),
  };
}

export function crawlerTestSummary(result: CrawlerDryRunResult) {
  if (!result.ok) return "脚本测试失败";
  const protocol = result.validated.includes("protocol");
  const media = result.validated.includes("media_probe");
  if (protocol && media) return "协议与媒体检查通过";
  if (protocol) return "协议检查通过";
  if (media) return "媒体检查通过";
  return "未确认验证范围";
}
