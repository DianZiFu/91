import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { kindLabel } from "./constants";
import * as api from "../api";

export function CrawlerUploadTargetField({
  value,
  onChange,
  uploadTargets,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  uploadTargets: api.AdminDrive[];
  disabled?: boolean;
}) {
  const targetId = useId();

  return (
    <div className="admin-form__row">
      <label htmlFor={targetId}>视频上传目标</label>
      <div className="admin-form-select-wrap">
        <select
          id={targetId}
          className="admin-form-select"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">本地保存，不上传</option>
          {uploadTargets.map((d) => (
            <option key={d.id} value={d.id}>
              {kindLabel[d.kind] ?? d.kind} · {d.name || d.id}
            </option>
          ))}
        </select>
        <ChevronDown size={15} className="admin-form-select__icon" aria-hidden="true" />
      </div>
    </div>
  );
}
