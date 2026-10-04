import { useEffect, useRef } from "react";
import * as api from "../api";
import { useAdminResource } from "../useAdminResource";
import { isGenerationBusy } from "./scanResults";

const idleMaintenanceStatus: api.MaintenanceJobStatus = {
  state: "idle", running: false, queued: false,
};

export function useDriveListData(active: boolean) {
  const maintenance = useAdminResource(api.getScanAllJobStatus,
    { queryKey: "drive-maintenance", active, initialData: idleMaintenanceStatus,
      intervalMs: (status) => status.running || status.queued ? 2000 : 15_000 });
  const maintenanceBusy = maintenance.data.running || maintenance.data.queued;
  const drives = useAdminResource(api.listDrives, {
    queryKey: "drives", active, initialData: [],
    intervalMs: (items) => maintenanceBusy || items.some(driveBusy) ? 5000 : 15_000,
  });
  const busy = maintenanceBusy || drives.data.some(driveBusy);
  const storage = useAdminResource<api.AdminDriveStorage | null>(api.getDriveStorage,
    { queryKey: "drive-storage", active, intervalMs: busy ? 15_000 : 60_000, initialData: null });
  const previouslyBusyRef = useRef(busy);
  useEffect(() => {
    if (active && previouslyBusyRef.current && !busy) void storage.invalidate();
    previouslyBusyRef.current = busy;
  }, [active, busy, storage.invalidate]);
  return {
    list: drives.data, setList: drives.setData, storage: storage.data,
    maintenanceStatus: maintenance.data, setMaintenanceStatus: maintenance.setData,
    loading: drives.loading, storageLoading: storage.loading, loadError: drives.ready ? "" : drives.error,
    listError: drives.ready ? drives.error : "", storageError: storage.error, maintenanceError: maintenance.error,
    unauthorized: drives.unauthorized || storage.unauthorized || maintenance.unauthorized,
    refreshList: drives.refresh, refreshStorage: storage.refresh, refreshMaintenance: maintenance.refresh,
    refresh: () => Promise.all([drives.invalidate(), storage.invalidate(), maintenance.invalidate()]),
  };
}

function driveBusy(drive: api.AdminDrive) {
  return [drive.scanGenerationStatus, drive.thumbnailGenerationStatus, drive.previewGenerationStatus, drive.fingerprintGenerationStatus]
    .some((status) => isGenerationBusy(status?.state ?? "idle"));
}
