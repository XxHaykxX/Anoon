"use client";

import { useEffect, useRef } from "react";
import { AnoonAvatar } from "@/components/anoon/_shared";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import { USE_TINODE } from "@/lib/tinode";
import { getCompanionClient } from "@/lib/companion";
import { useAnoonStore } from "@/store";

export default function AnoonSearching() {
  const nav = useAnoonNav();
  // Filter summary. Real mode: the exact filters the user picked on Home —
  // AnoonHome → joinQueue → companion.enqueue records them, read them back here.
  // Mock mode keeps a representative stub for the standalone showcase.
  const prefs = USE_TINODE ? getCompanionClient().getLastPrefs() : null;
  const filters = prefs
    ? { ownAge: prefs.ownAgeRange, partnerAges: prefs.peerAgeRanges }
    : { ownAge: "22–25", partnerAges: ["18–21", "22–25"] };

  // Real mode: the queue transitions to "matched" via the companion `matched`
  // event; when it does, open the anon chat. Cancel leaves the queue.
  const queueStatus = useAnoonStore((s) => s.queue.status);
  const leaveQueue = useAnoonStore((s) => s.leaveQueue);
  const resyncMatch = useAnoonStore((s) => s.resyncRouletteMatch);
  /** True once this screen itself is leaving, so the idle-watch effect stands down. */
  const leaving = useRef(false);

  // Mock mode: auto-match after a short search, opening the chat.
  useEffect(() => {
    if (USE_TINODE) return;
    const t = setTimeout(() => nav.push("anon-chat"), 1500);
    return () => clearTimeout(t);
  }, [nav]);

  // Real mode: advance to the chat the moment we're matched.
  useEffect(() => {
    if (USE_TINODE && queueStatus === "matched") nav.push("anon-chat");
  }, [nav, queueStatus]);

  // Real mode: the `matched` event is pushed best-effort over the companion WS
  // — a full send buffer, a socket that is mid-reconnect, or a frame that
  // arrives before the store attaches its listener all lose it, which stranded
  // this screen on the spinner forever while the peer sat in the anon chat.
  // Poll the authoritative server state while we search; it converges on the
  // same handler as the event, so a match delivered twice still opens one chat.
  useEffect(() => {
    if (!USE_TINODE || queueStatus !== "searching") return;
    void resyncMatch();
    const id = setInterval(() => void resyncMatch(), 2000);
    return () => clearInterval(id);
  }, [queueStatus, resyncMatch]);

  // Real mode: the store can drop us out of the queue without this screen
  // asking — a re-enqueue that the backend refused (banned, rate-limited) after
  // the companion restarted and lost its in-memory queue. The error is already
  // on screen as a toast; what is left is not to strand the user on a spinner
  // that is no longer searching for anything.
  useEffect(() => {
    if (!USE_TINODE || leaving.current) return;
    if (queueStatus === "idle") nav.back();
  }, [nav, queueStatus]);

  const cancel = () => {
    // Mark our own leave so the effect above does not fire a second nav.back()
    // when `leaveQueue` flips the status to idle.
    leaving.current = true;
    if (USE_TINODE) void leaveQueue();
    nav.back();
  };

  return (
    // `justify-between` on a 900px desktop parked «Отмена» at the very bottom,
    // 250px below the text. There the two blocks are centred as one group
    // instead; the phone keeps the spread-out layout.
    <div className="relative flex h-full w-full flex-col items-center justify-between bg-background text-foreground lg:[.anoon-desktop_&]:justify-center">
      {/* Centered pulsing rings around avatar */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 lg:[.anoon-desktop_&]:flex-none">
        <div className="relative flex size-56 items-center justify-center">
          {/* Concentric pinging rings (staggered) */}
          <span className="absolute size-56 rounded-full bg-primary/10 animate-ping [animation-duration:2.4s] motion-reduce:animate-none" />
          <span className="absolute size-40 rounded-full bg-primary/15 animate-ping [animation-duration:2s] [animation-delay:0.3s] motion-reduce:animate-none" />
          <span className="absolute size-28 rounded-full bg-primary/20 animate-ping [animation-duration:1.6s] [animation-delay:0.6s] motion-reduce:animate-none" />
          {/* Static outline rings for depth */}
          <span className="absolute size-56 rounded-full border border-primary/20" />
          <span className="absolute size-40 rounded-full border border-primary/25" />
          {/* Center avatar */}
          <AnoonAvatar initials="?" tone={4} size={88} className="relative shadow-lg" />
        </div>

        <h1 className="mt-10 text-lg font-semibold">Ищем собеседника…</h1>
        <p className="mt-2 max-w-[16rem] text-center text-xs leading-relaxed text-muted-foreground">
          По фильтрам: ваш возраст {filters.ownAge}, собеседник{" "}
          {filters.partnerAges.length ? filters.partnerAges.join(", ") : "любой"}. Пол —
          противоположный.
        </p>
      </div>

      {/* Cancel. Capped on desktop: this screen has no nav rail (leaving a match
          must go through leaveQueue, see docs/DESKTOP-LAYOUT.md), so it owns the
          whole viewport and a full-width button would be a 1400px bar.
          `lg:[.anoon-desktop_&]:` — both halves needed: `lg:` alone fires in the
          showcase's 390px frames, the class alone is on the root at every width. */}
      <div className="w-full px-5 pb-8 lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:mt-10 lg:[.anoon-desktop_&]:max-w-[22rem]">
        <button
          type="button"
          onClick={cancel}
          className="w-full select-none rounded-2xl border border-border bg-card py-4 text-base font-bold text-foreground transition-transform active:scale-95"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
