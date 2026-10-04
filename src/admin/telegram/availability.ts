type TelegramAvailability = {
  enabled: boolean | null;
  error: string;
};

let snapshot: TelegramAvailability = { enabled: null, error: "" };
let revision = 0;
const listeners = new Set<() => void>();
const configListeners = new Set<(enabled: boolean) => void>();

export function subscribeTelegramConfigChanges(listener: (enabled: boolean) => void) {
  configListeners.add(listener);
  return () => { configListeners.delete(listener); };
}

export const getTelegramAvailability = () => snapshot;

export function subscribeTelegramAvailability(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: TelegramAvailability) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function applyTelegramEnabled(enabled: boolean) {
  revision += 1;
  publish({ enabled, error: "" });
  for (const listener of configListeners) listener(enabled);
}

export function resetTelegramAvailability() {
  revision += 1;
  publish({ enabled: null, error: "" });
}

export function reportTelegramAvailabilityError() {
  publish({ ...snapshot, error: "无法读取 Telegram 配置状态，请刷新重试。" });
}

export async function syncTelegramAvailability(
  fetchEnabled: () => Promise<boolean>,
  signal: AbortSignal,
) {
  const requestRevision = ++revision;
  try {
    const enabled = await fetchEnabled();
    if (typeof enabled !== "boolean")
      throw new Error("无效的 Telegram 配置状态");
    if (!signal.aborted && requestRevision === revision) publish({ enabled, error: "" });
    return enabled;
  } catch (error) {
    if (!signal.aborted && requestRevision === revision) reportTelegramAvailabilityError();
    throw error;
  }
}
