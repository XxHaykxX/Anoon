"use client";

import { useEffect } from "react";

/**
 * Registers the service worker on mount. Renders nothing.
 * Guarded so it is a no-op where the SW API is unavailable
 * (SSR, older browsers, insecure contexts).
 */
export default function PWARegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* Registration failures are non-fatal; ignore. */
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
