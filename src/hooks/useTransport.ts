import { useCallback, useSyncExternalStore } from "react";
import type { Transport } from "../../packages/music/transport";
export function useTransport(transport: Transport, enabled = true) {
  const subscribe = useCallback(
    (fn: () => void) => (enabled ? transport.subscribe(fn) : () => {}),
    [transport, enabled],
  );
  return useSyncExternalStore(
    subscribe,
    transport.snapshot,
    transport.snapshot,
  );
}
