import { Activity } from "lucide-react";
import * as api from "../api";
import { DriveGenerationActions } from "./DriveGenerationActions";
import {
  generationStateLabel,
  generationStateClass,
  generationDetail,
  generationTitle,
} from "./constants";

export function GenerationCounts({
  ready,
  pending,
  failed,
}: {
  ready?: number;
  pending?: number;
  failed?: number;
}) {
  return (
    <div className="admin-generation-counts">
      <span className="admin-drive-teaser__metric is-ready">
        就绪 {ready ?? 0}
      </span>
      <span className="admin-drive-teaser__metric is-pending">
        待生成 {pending ?? 0}
      </span>
      <span className="admin-drive-teaser__metric is-failed">
        失败 {failed ?? 0}
      </span>
    </div>
  );
}

export function GenerationStatusLine({
  label,
  status,
}: {
  label: string;
  status?: api.DriveGenerationStatus;
}) {
  const state = status?.state || "idle";
  const queueLength = status?.queueLength ?? 0;
  const detail = generationDetail(status);
  const title = generationTitle(status, detail);
  const countText = queueLength > 0 ? `${label === "封面" ? "待处理" : "队列"} ${queueLength}` : "";

  return (
    <div className="admin-generation-row" title={title}>
      <span className="admin-generation-kind">{label}</span>
      <span className={`admin-status admin-generation-state is-${generationStateClass(state)}`}>
        {generationStateLabel(state)}
      </span>
      {(detail || queueLength > 0) && (
        <span className="admin-generation-detail">
          {[detail, countText].filter(Boolean).join(" / ")}
        </span>
      )}
    </div>
  );
}

export function StatusTag({
  status,
  error,
  hasCred,
}: {
  status: string;
  error?: string;
  hasCred: boolean;
}) {
  if (!hasCred) {
    return <span className="admin-status is-pending">未配置凭证</span>;
  }
  if (status === "ok") {
    return <span className="admin-status is-ok">已连接</span>;
  }
  if (status === "error")
    return (
      <span className="admin-status is-error" title={error}>
        错误
      </span>
    );
  return <span className="admin-status">{status || "未连接"}</span>;
}

export function DriveCardMetrics({ d }: { d: api.AdminDrive }) {
  return (
    <div className="admin-drive-card__info">
      <div className="admin-drive-card__metric">
        <span>封面数 (就绪/失败)</span>
        <strong>
          {d.thumbnailReadyCount ?? 0}
          <span style={{ fontSize: "11px", fontWeight: "normal", color: "var(--text-faint)" }}>
            {" "}/ {d.thumbnailFailedCount ?? 0}
          </span>
        </strong>
      </div>
      <div className="admin-drive-card__metric">
        <span>预览视频数 (就绪/失败)</span>
        <strong>
          {d.teaserReadyCount ?? 0}
          <span style={{ fontSize: "11px", fontWeight: "normal", color: "var(--text-faint)" }}>
            {" "}/ {d.teaserFailedCount ?? 0}
          </span>
        </strong>
      </div>
      <div className="admin-drive-card__metric">
        <span>视频指纹数 (就绪/失败)</span>
        <strong>
          {d.fingerprintReadyCount ?? 0}
          <span style={{ fontSize: "11px", fontWeight: "normal", color: "var(--text-faint)" }}>
            {" "}/ {d.fingerprintFailedCount ?? 0}
          </span>
        </strong>
      </div>
    </div>
  );
}

export function DriveGenerationPanel({
  d,
  runtimeLoading = false,
  countsLoading = false,
  onGenerationUpdated,
}: {
  d: api.AdminDrive;
  runtimeLoading?: boolean;
  countsLoading?: boolean;
  onGenerationUpdated: () => void;
}) {
  return (
    <div className="admin-detail-card">
      <header className="admin-detail-card__title">
        <div className="admin-detail-card__title-left">
          <Activity size={16} />
          <span>生成状态</span>
        </div>
      </header>

      <div className="admin-gen-columns">
        <DriveGenCol
          label="扫盘"
          status={d.scanGenerationStatus}
          loading={runtimeLoading}
          showCounts={false}
        />
        <DriveGenCol
          label="封面"
          status={d.thumbnailGenerationStatus}
          loading={runtimeLoading}
          countsLoading={countsLoading}
          ready={d.thumbnailReadyCount}
          pending={d.thumbnailPendingCount}
          failed={d.thumbnailFailedCount}
        />
        <DriveGenCol
          label="预览视频"
          status={d.previewGenerationStatus}
          loading={runtimeLoading}
          countsLoading={countsLoading}
          ready={d.teaserReadyCount}
          pending={d.teaserPendingCount}
          failed={d.teaserFailedCount}
        />
        <DriveGenCol
          label="视频指纹"
          status={d.fingerprintGenerationStatus}
          loading={runtimeLoading}
          countsLoading={countsLoading}
          ready={d.fingerprintReadyCount}
          pending={d.fingerprintPendingCount}
          failed={d.fingerprintFailedCount}
        />
      </div>

      <DriveGenerationActions driveId={d.id} onUpdated={onGenerationUpdated} />
    </div>
  );
}

function DriveGenCol({
  label,
  status,
  ready,
  pending,
  failed,
  showCounts = true,
  loading = false,
  countsLoading = false,
}: {
  label: string;
  status?: api.DriveGenerationStatus;
  ready?: number;
  pending?: number;
  failed?: number;
  showCounts?: boolean;
  loading?: boolean;
  countsLoading?: boolean;
}) {
  const state = status?.state || "idle";
  const detail = generationDetail(status);
  const title = generationTitle(status, detail);
  const stateLabel = loading ? "加载中" : !status ? "状态未知" : label === "抓取" && state === "scanning" ? "抓取中" : generationStateLabel(state);
  const showScanProgress = !loading && !showCounts && (Boolean(status?.result) || state === "scanning" || (status?.scannedCount ?? 0) > 0 || (status?.addedCount ?? 0) > 0);
  const scannedLabel = label === "抓取" ? "已抓取" : "已扫描";
  return (
    <div className="admin-gen-col">
      <div className="admin-gen-col__head">
        <span className="admin-gen-col__label">{label}</span>
        <span
          className={`admin-status admin-generation-state is-${generationStateClass(state)}`}
          title={title || undefined}
        >
          {stateLabel}
        </span>
      </div>
      {detail && <div className="admin-gen-col__detail">{detail}</div>}
      {showScanProgress && (
        <div className="admin-gen-col__counts admin-gen-col__counts--scan">
          <div className="admin-gen-col__count"><span>{scannedLabel}</span><strong>{status?.scannedCount ?? 0}</strong></div>
          <div className="admin-gen-col__count"><span>{status?.result ? "已新增" : "预计新增"}</span><strong>{status?.addedCount ?? 0}</strong></div>
        </div>
      )}
      {showCounts && (
        <div className="admin-gen-col__counts">
          <div className="admin-gen-col__count"><span>就绪</span><strong>{countsLoading ? "—" : ready ?? 0}</strong></div>
          <div className="admin-gen-col__count"><span>待生成</span><strong>{countsLoading ? "—" : pending ?? 0}</strong></div>
          <div className="admin-gen-col__count"><span>失败</span><strong>{countsLoading ? "—" : failed ?? 0}</strong></div>
        </div>
      )}
    </div>
  );
}
