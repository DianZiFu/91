import { useToast } from "@/components/ToastContext";
import * as api from "../api";

const actions = [
  { label: "生成封面", generate: api.generateDriveThumbnails },
  { label: "生成预览", generate: api.generateDrivePreviews },
  { label: "生成指纹", generate: api.generateDriveFingerprints },
];

export function DriveGenerationActions({ driveId, onUpdated }: { driveId: string; onUpdated?: () => void }) {
  const { show } = useToast();

  async function generate(request: (id: string) => Promise<api.DriveGenerationResult>) {
    try {
      const result = await request(driveId);
      show(result.message, result.state === "started" ? "success" : "info");
      onUpdated?.();
    } catch (error) {
      show(error instanceof Error ? error.message : "触发失败", "error");
    }
  }

  return (
    <div className="admin-detail-actions admin-generation-actions">
      {actions.map((action) => (
        <button key={action.label} type="button" className="admin-btn" onClick={() => void generate(action.generate)}>
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}
