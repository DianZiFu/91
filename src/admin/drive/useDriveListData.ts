import * as api from "../api";
import { idleMaintenanceStatus } from "./constants";
import { useAdminResource } from "../useAdminResource";

export function useDriveListData(active: boolean) {
  const drives = useAdminResource(api.listDrives, { queryKey: "drives", active, intervalMs: 5000, initialData: [] });
  const storage = useAdminResource<api.AdminDriveStorage | null>(api.getDriveStorage,
    { queryKey: "drive-storage", active, intervalMs: 15_000, initialData: null });
  const maintenance = useAdminResource(api.getScanAllJobStatus,
    { queryKey: "drive-maintenance", active, intervalMs: 2000, initialData: idleMaintenanceStatus });
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
