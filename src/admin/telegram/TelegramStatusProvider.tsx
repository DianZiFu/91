import { createContext, useContext, useEffect, type ReactNode } from "react";
import * as api from "../api";
import { useAdminResource } from "../useAdminResource";
import { resetTelegramAvailability, subscribeTelegramConfigChanges, syncTelegramAvailability } from "./availability";

type StatusResource = ReturnType<typeof useAdminResource<api.TelegramStatus | null>>;
const StatusContext = createContext<StatusResource | null>(null);

function loadStatus(signal: AbortSignal) {
  const read = api.getTelegramStatus(signal);
  void syncTelegramAvailability(async () => (await read).enabled, signal);
  return read;
}

// The layout owns one status read for navigation and the retained workspace.
export function TelegramStatusProvider({ children, workspaceActive, onUnauthorized }: {
  children: ReactNode;
  workspaceActive: boolean;
  onUnauthorized?: () => void;
}) {
  const status = useAdminResource<api.TelegramStatus | null>(loadStatus, {
    queryKey: "telegram-status", active: true, initialData: null, onUnauthorized,
    intervalMs: (data) => workspaceActive || data?.connection.state === "connecting" ? 5000 : 15_000,
  });
  useEffect(() => () => resetTelegramAvailability(), []);
  useEffect(() => subscribeTelegramConfigChanges((enabled) => {
    status.setData((current) => current ? {
      ...current, enabled, connection: { ...current.connection, enabled, config: { ...current.connection.config, enabled } },
    } : current);
    void status.invalidate();
  }), [status.setData, status.invalidate]);

  return <StatusContext.Provider value={status}>{children}</StatusContext.Provider>;
}

export function useTelegramStatus() {
  const status = useContext(StatusContext);
  if (!status) throw new Error("Telegram status requires the admin layout");
  return status;
}
