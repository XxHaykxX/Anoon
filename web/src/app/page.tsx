"use client";

import { FindPeer } from "@/components/find-peer";
import { Onboarding } from "@/components/onboarding";
import { useMounted } from "@/lib/use-mounted";
import { useSession } from "@/store/session";

export default function Home() {
  const hasProfile = useSession((s) => s.hasProfile);
  // Persist гидрируется на клиенте — ждём mount, иначе SSR-mismatch.
  const mounted = useMounted();
  if (!mounted) return null;

  return hasProfile ? <FindPeer /> : <Onboarding />;
}
