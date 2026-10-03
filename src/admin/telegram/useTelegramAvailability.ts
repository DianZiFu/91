import { useSyncExternalStore } from "react";
import {
  getTelegramAvailability,
  subscribeTelegramAvailability,
} from "./availability";

export function useTelegramAvailability() {
  return useSyncExternalStore(
    subscribeTelegramAvailability,
    getTelegramAvailability,
    getTelegramAvailability,
  );
}
