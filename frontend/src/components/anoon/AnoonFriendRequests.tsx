"use client";

import { useState } from "react";
import { AnoonAvatar, PRESS_FX } from "@/components/anoon/_shared";
import { CheckIcon, CloseIcon } from "@/components/icons";
import { USE_TINODE } from "@/lib/tinode";
import { getCompanionClient } from "@/lib/companion";
import { useAnoonStore } from "@/store";


type RequestStatus = "pending" | "accepted" | "declined";

interface FriendRequestRow {
  id: string;
  hashId: string;
  name: string;
  initials: string;
  tone: number;
  when: string;
}

const INITIAL_REQUESTS: FriendRequestRow[] = [
  { id: "r1", hashId: "#00042", name: "Лиса", initials: "Л", tone: 2, when: "только что" },
  { id: "r2", hashId: "#00108", name: "Ворон", initials: "В", tone: 0, when: "5 мин назад" },
  { id: "r3", hashId: "#00317", name: "Мила", initials: "М", tone: 4, when: "вчера" },
];

/** Coarse "time ago" label from a unix-ms timestamp. */
function timeAgo(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ч назад`;
  return "вчера";
}

export default function AnoonFriendRequests() {
  const [statuses, setStatuses] = useState<Record<string, RequestStatus>>({});

  // Real mode: incoming requests come from the store (companion `friend_request`
  // events); accept/decline hit the companion.
  const storeRequests = useAnoonStore((s) => s.requests);
  const upsertFriend = useAnoonStore((s) => s.upsertFriend);
  const removeRequest = useAnoonStore((s) => s.removeRequest);
  const addRequest = useAnoonStore((s) => s.addRequest);
  const showError = useAnoonStore((s) => s.showError);

  const rows: FriendRequestRow[] = USE_TINODE
    ? storeRequests
        .filter((r) => r.direction === "incoming")
        .map((r) => ({
          id: r.id,
          hashId: r.hashId.startsWith("#") ? r.hashId : `#${r.hashId}`,
          name: r.displayName,
          initials: (r.displayName.trim()[0] ?? "?").toUpperCase(),
          tone: r.avatarTone,
          when: timeAgo(r.createdAt),
        }))
    : INITIAL_REQUESTS;

  const setStatus = (id: string, status: RequestStatus) =>
    setStatuses((prev) => ({ ...prev, [id]: status }));

  const respond = (r: FriendRequestRow, accept: boolean) => {
    setStatus(r.id, accept ? "accepted" : "declined");
    if (!USE_TINODE) return;
    const raw = r.hashId.replace(/^#/, "");
    // Keep the original row so a refused respond can put it back — once it is
    // out of the store there is nothing left for the user to retry.
    const original = storeRequests.find((x) => x.id === r.id);
    // Add the friend WITH the p2p topic the backend returns — without it the
    // chat opens topic-less and messages go nowhere (BUG-42).
    void getCompanionClient()
      .friendRespond(raw, accept)
      .then((res) => {
        if (!accept) return;
        upsertFriend({
          id: raw,
          hashId: r.hashId,
          displayName: r.name,
          avatarTone: r.tone,
          topic: res.topic,
          online: true,
          lastActiveAt: Date.now(),
        });
      })
      .catch(() => {
        // The backend said no. Undo the optimistic UI rather than leave the
        // user believing they now have a friend nobody's server agrees about
        // — friendRespond used to swallow this and return {}, which read as
        // "accepted, just without a topic".
        setStatus(r.id, "pending");
        if (original) addRequest(original);
        showError(
          accept
            ? "Не удалось принять заявку. Попробуйте ещё раз"
            : "Не удалось отклонить заявку. Попробуйте ещё раз",
        );
      });
    // Drop it from the store too (mirrors AnoonNotifications.handleRequest) —
    // otherwise it lingers in `requests` forever: it'd reappear next visit and
    // the "Заявки"/notifications badges elsewhere would never decrease (BUG-22).
    removeRequest(r.id);
  };

  const pendingCount = rows.filter(
    (r) => (statuses[r.id] ?? "pending") === "pending",
  ).length;

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pb-3 pt-3">
        <h1 className="text-2xl font-bold">Заявки в друзья</h1>
        {pendingCount > 0 && (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground">
            {pendingCount}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5">
        {pendingCount === 0 && (
          <p className="pt-4 text-center text-xs text-muted-foreground">
            Новых заявок нет
          </p>
        )}

        <div className="flex flex-col gap-2.5">
          {rows.map((r) => {
            const status = statuses[r.id] ?? "pending";
            return (
              <div
                key={r.id}
                className="rounded-2xl border border-border bg-card p-3"
              >
                <div className="flex items-center gap-3">
                  <AnoonAvatar initials={r.initials} tone={r.tone} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-semibold">{r.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{r.hashId}</span>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      хочет добавить в друзья · {r.when}
                    </p>
                  </div>
                </div>

                {status === "pending" ? (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => respond(r, true)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary py-2 text-sm font-semibold text-primary-foreground ${PRESS_FX}`}
                    >
                      <CheckIcon className="size-4" />
                      Принять
                    </button>
                    <button
                      type="button"
                      onClick={() => respond(r, false)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full bg-muted py-2 text-sm font-semibold text-foreground ${PRESS_FX}`}
                    >
                      <CloseIcon className="size-4" />
                      Отклонить
                    </button>
                  </div>
                ) : (
                  <div
                    className={`mt-3 rounded-full py-2 text-center text-sm font-medium ${
                      status === "accepted"
                        ? "bg-online/15 text-online"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {status === "accepted"
                      ? "Заявка принята — вы теперь друзья"
                      : "Заявка отклонена"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
