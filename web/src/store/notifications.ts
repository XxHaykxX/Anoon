"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// Колокольчик уведомлений (BELL-DATA). Source of truth — IndexedDB "anoon-notifs" (пишет
// public/sw.js в обработчике 'push', переживает закрытые вкладки/офлайн). Этот стор — live-кэш
// для UI поверх той же БД: load() при старте сливает накопленное, SW postMessage добавляет новые
// live (слушатель — app-providers.tsx). localStorage-persist держит копию для мгновенного первого
// рендера колокольчика до того, как IndexedDB успеет открыться.
// Контракт для UI (ui-dev, зафиксирован): useNotifications() → { unreadCount, notifs, markAllRead }.
// (load/addNotif — внутренние, вызывает только app-providers.tsx.)

export type Notif = { id: string; title: string; body: string; url: string; ts: number; read: boolean };

const DB_NAME = "anoon-notifs";
const STORE = "notifs";
const MAX_NOTIFS = 200; // не даём списку расти бесконечно в сторе/localStorage

function isNotif(x: unknown): x is Notif {
  const n = x as Partial<Notif> | null;
  return !!n && typeof n.id === "string" && typeof n.title === "string" && typeof n.ts === "number";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Всё, что SW накопил в IndexedDB (в т.ч. пока вкладка была закрыта).
async function readAllFromDb(): Promise<Notif[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await openDb();
    const list = await new Promise<Notif[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(((req.result as Notif[]) ?? []).filter(isNotif));
      req.onerror = () => reject(req.error);
    });
    db.close();
    return list;
  } catch {
    return [];
  }
}

// Проставить read=true в самой БД — иначе следующий load() решит, что старые уведомления снова непрочитаны.
async function markAllReadInDb(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        for (const n of (req.result as Notif[]) ?? []) {
          if (!n.read) store.put({ ...n, read: true });
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // best-effort — UI уже показал прочитанным локально
  }
}

const sortDesc = (list: Notif[]): Notif[] => [...list].sort((a, b) => b.ts - a.ts).slice(0, MAX_NOTIFS);
const countUnread = (list: Notif[]): number => list.filter((n) => !n.read).length;

type NotificationsState = {
  notifs: Notif[];
  unreadCount: number;
  load: () => Promise<void>; // читать при старте приложения (app-providers.tsx)
  addNotif: (n: Notif) => void; // из SW postMessage (live, пока вкладка открыта)
  markAllRead: () => void;
};

export const useNotifications = create<NotificationsState>()(
  persist(
    (set) => ({
      notifs: [],
      unreadCount: 0,

      // Сливает IndexedDB-накопления с уже известными в сторе (по id, без дублей).
      load: async () => {
        const fromDb = await readAllFromDb();
        if (!fromDb.length) return;
        set((s) => {
          const byId = new Map(s.notifs.map((n) => [n.id, n]));
          for (const n of fromDb) byId.set(n.id, n);
          const merged = sortDesc([...byId.values()]);
          return { notifs: merged, unreadCount: countUnread(merged) };
        });
      },

      addNotif: (n) =>
        set((s) => {
          if (s.notifs.some((x) => x.id === n.id)) return s;
          const merged = sortDesc([n, ...s.notifs]);
          return { notifs: merged, unreadCount: countUnread(merged) };
        }),

      markAllRead: () => {
        set((s) => ({ notifs: s.notifs.map((n) => ({ ...n, read: true })), unreadCount: 0 }));
        void markAllReadInDb();
      },
    }),
    {
      name: "anoon-notifications",
      partialize: (s) => ({ notifs: s.notifs }),
      onRehydrateStorage: () => (state) => {
        if (state) state.unreadCount = countUnread(state.notifs);
      },
    },
  ),
);
