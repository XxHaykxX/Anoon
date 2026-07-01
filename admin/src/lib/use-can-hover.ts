"use client";

import { useEffect, useState } from "react";

// true только на устройствах с точным указателем (мышь) — hover-анимации не на touch.
export function useCanHover() {
  const [can, setCan] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const on = () => setCan(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return can;
}
