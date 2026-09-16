import { useEffect, useSyncExternalStore } from "react";
import { getSyncManager } from "./engine";

export function useSync(ownerUid: string) {
  const manager = getSyncManager(ownerUid);
  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
  useEffect(() => {
    manager.start();
    return () => manager.stop();
  }, [manager]);
  return { manager, snapshot };
}
