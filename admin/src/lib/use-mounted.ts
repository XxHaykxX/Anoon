"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

// true после гидрации на клиенте, false на сервере/при первом рендере.
// Guard от SSR-mismatch без setState-в-effect (react-hooks/set-state-in-effect).
export function useMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
