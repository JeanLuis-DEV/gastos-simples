import { useEffect, useSyncExternalStore } from "react";
import { getSyncManager } from "./engine";

export function useSync(ownerUid: string, allowed = true) {
  const manager = getSyncManager(ownerUid);
  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
  useEffect(() => {
    if (!allowed) {
      manager.stop();
      return;
    }
    manager.start();
    return () => manager.stop();
  }, [allowed, manager]);
  return { manager, snapshot };
}
