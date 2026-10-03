import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import * as api from "../api";
import { DriveDetailData, driveDetailData } from "./driveDetailData";

const emptyStats: api.DriveStats = {
  thumbnailReadyCount: 0, thumbnailPendingCount: 0, thumbnailFailedCount: 0, thumbnailDurationPendingCount: 0,
  teaserReadyCount: 0, teaserPendingCount: 0, teaserFailedCount: 0,
  fingerprintReadyCount: 0, fingerprintPendingCount: 0, fingerprintFailedCount: 0,
};

export function useDriveDetailData(driveId: string | null, routeActive: boolean) {
  const cache = useMemo(() => new Map<string, DriveDetailData>(), []);
  const controller = useMemo(() => driveDetailData(driveId || "", cache), [driveId, cache]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [visible, setVisible] = useState(() => !document.hidden);

  useEffect(() => {
    const syncVisibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);
  useEffect(() => {
    if (!driveId || !routeActive || !visible) return;
    const release = controller.retain();
    const syncOnline = () => { void controller.refresh(); };
    window.addEventListener("online", syncOnline);
    return () => { window.removeEventListener("online", syncOnline); release(); };
  }, [controller, driveId, routeActive, visible]);

  const { config, runtime, stats, storage } = state.resources;
  const drive: api.AdminDrive | null = config.data && !state.notFound
    ? { ...config.data, ...emptyStats, ...stats.data, ...runtime.data } : null;
  return {
    ...state, drive, storage: storage.data,
    loading: !state.notFound && !config.data && !config.error,
    refresh: (resources?: api.DriveResource[]) => controller.refresh(resources),
    accept: (snapshot?: api.DriveSnapshot) => { if (snapshot) controller.accept(snapshot); },
  };
}
