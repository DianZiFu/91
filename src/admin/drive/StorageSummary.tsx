import type { AdminDriveStorage } from "../api";
import { formatBytes } from "../storageFormat";

export function StorageSummary({
  storage,
  loading = false,
}: {
  storage: AdminDriveStorage | null;
  loading?: boolean;
}) {
  const metrics = [
    { label: "封面占用", value: storage ? formatBytes(storage.thumbnailBytes) : "" },
    { label: "预览视频占用", value: storage ? formatBytes(storage.teaserBytes) : "" },
    { label: "本地媒体合计", value: storage ? formatBytes(storage.totalBytes) : "" },
    { label: "磁盘可用", value: storage ? formatBytes(storage.availableBytes) : "" },
  ];

  return (
    <section
      className="admin-card admin-storage-summary"
      aria-label="本地媒体存储"
      aria-busy={loading || undefined}
    >
      {metrics.map((metric) => (
        <div key={metric.label} className="admin-storage-summary__metric">
          <span>{metric.label}</span>
          <strong aria-hidden={loading || undefined}>
            {loading ? "\u00a0" : metric.value || "\u00a0"}
          </strong>
        </div>
      ))}
    </section>
  );
}
