"use client";

import { useCallback, useMemo, useState } from "react";

// Мультивыбор строк (чекбоксы + bulk-bar). Хранит id в Set.
export function useSelection() {
  const [ids, setIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const set = useCallback((next: string[]) => setIds(new Set(next)), []);
  const clear = useCallback(() => setIds(new Set()), []);

  return useMemo(
    () => ({ ids, has: (id: string) => ids.has(id), toggle, set, clear, count: ids.size }),
    [ids, toggle, set, clear],
  );
}
