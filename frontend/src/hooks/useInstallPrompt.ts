"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The `beforeinstallprompt` event is not in the standard lib DOM types,
 * so we describe the shape we rely on.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/**
 * Captures the browser's `beforeinstallprompt` event so the app can trigger
 * the native install flow on demand.
 *
 * Returns `canInstall` (true once a deferred prompt is available) and
 * `promptInstall()` which shows the native dialog and resolves with the
 * user's choice ("accepted" | "dismissed" | null if unavailable).
 */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => setDeferredPrompt(null);

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<
    "accepted" | "dismissed" | null
  > => {
    if (!deferredPrompt) return null;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome;
  }, [deferredPrompt]);

  return { canInstall: deferredPrompt !== null, promptInstall };
}

export default useInstallPrompt;
