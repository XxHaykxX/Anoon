"use client";

import { Glass } from "@samasante/liquid-glass";
import { Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { InstallPwa } from "@/components/install-pwa";
import { MatchSetup } from "@/components/match-setup";
import { PushToggle } from "@/components/push-toggle";
import { findMatch } from "@/lib/realtime";
import { supabaseConfigured } from "@/lib/supabase";
import { useMounted } from "@/lib/use-mounted";
import { useMatchPrefs } from "@/store/match-prefs";
import { useSession } from "@/store/session";

export function FindPeer() {
  const { nickname, publicId } = useSession();
  const router = useRouter();
  const [searching, setSearching] = useState(false);
  // Glass использует SVG-фильтры/WebGL — рендерим только после mount (без SSR).
  const mounted = useMounted();

  const matchRef = useRef<{ cancel: () => void } | null>(null);
  useEffect(() => () => matchRef.current?.cancel(), []);

  const prefs = useMatchPrefs();

  const find = () => {
    if (!prefs.ready()) return;
    setSearching(true);
    const criteria = { gender: prefs.gender, age: prefs.age, wantGender: prefs.wantGender, wantAges: prefs.wantAges };
    // Реальный матчинг через Supabase Realtime lobby-presence с фильтрами; фолбэк — мок.
    if (supabaseConfigured && publicId) {
      matchRef.current = findMatch(publicId, criteria, (peer) => router.push(`/chat/${peer}`));
    } else {
      setTimeout(() => router.push(`/chat/p${Math.floor(Math.random() * 9000) + 1000}`), 900);
    }
  };

  const profileCard = (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5">
      <div className="text-right">
        <div className="text-sm font-medium">{nickname}</div>
        <div className="font-mono text-xs text-fg-muted">#{publicId}</div>
      </div>
    </div>
  );

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      {/* Бренд-свечение — фон, который «жидкое стекло» преломляет */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, #fdbf2d 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-10 -right-16 h-64 w-64 rounded-full opacity-25 blur-3xl"
        style={{ background: "radial-gradient(circle, #fdbf2d 0%, transparent 70%)" }}
      />

      <header className="relative flex items-center justify-between px-5 py-4">
        <span className="text-lg font-bold">anoon</span>
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            aria-label="Настройки"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-fg-secondary transition hover:text-fg"
          >
            <Settings size={18} />
          </Link>
          <InstallPwa />
          <PushToggle />
          {mounted ? (
            <Glass radius={16} optics={{ frost: 6, dispersion: 0.4 }}>
              {profileCard}
            </Glass>
          ) : (
            profileCard
          )}
        </div>
      </header>

      <div className="relative flex-1 overflow-y-auto px-5 pt-2">
        <MatchSetup onStart={find} searching={searching} />
      </div>
    </div>
  );
}
