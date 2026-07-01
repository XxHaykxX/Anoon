"use client";

import { useGetIdentity, useLogout } from "@refinedev/core";
import { AnimatePresence, motion } from "framer-motion";
import { Ban, Flag, FolderOpen, Images, LayoutDashboard, LogOut, Menu, MessageSquare, ScrollText, Search, Send, Users, Wifi, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { AdminPwa } from "@/components/pwa";
import { Toaster } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/overview", label: "Обзор", icon: LayoutDashboard },
  { href: "/online", label: "Онлайн", icon: Wifi },
  { href: "/chats", label: "Чаты", icon: MessageSquare },
  { href: "/reports", label: "Жалобы", icon: Flag },
  { href: "/users", label: "Пользователи", icon: Users },
  { href: "/bans", label: "Баны", icon: Ban },
  { href: "/media", label: "Файлы", icon: FolderOpen },
  { href: "/gallery", label: "Галерея", icon: Images },
  { href: "/broadcast", label: "Рассылка", icon: Send },
  { href: "/audit", label: "Журнал", icon: ScrollText },
];

// Навигация — переиспользуется в сайдбаре (десктоп) и drawer (телефон).
function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-1 px-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname?.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
              active ? "text-accent" : "text-fg-secondary hover:bg-surface-2 hover:text-fg",
            )}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
                className="absolute inset-0 -z-10 rounded-lg bg-surface-2"
              />
            )}
            <Icon size={18} />
            {label}
            {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { mutate: logout } = useLogout();
  const { data: identity } = useGetIdentity<{ name?: string }>();
  const [drawer, setDrawer] = useState(false);
  const [prevPath, setPrevPath] = useState(pathname);

  // Закрывать drawer при смене маршрута (сброс state в рендере, без setState-в-effect).
  if (pathname !== prevPath) {
    setPrevPath(pathname);
    setDrawer(false);
  }

  return (
    <div className="flex min-h-dvh bg-bg text-fg">
      {/* Сайдбар (десктоп) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface-1 md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg font-semibold">a</div>
          <span className="font-semibold">anoon · admin</span>
        </div>
        <NavList />
        <button
          onClick={() => logout()}
          className="m-3 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-danger"
        >
          <LogOut size={18} /> Выйти
        </button>
      </aside>

      {/* Мобильный drawer */}
      <AnimatePresence>
        {drawer && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawer(false)}
              className="fixed inset-0 z-40 bg-black/60 md:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 400, damping: 40 }}
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-surface-1 md:hidden"
            >
              <div className="flex items-center gap-2.5 px-5 py-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg font-semibold">a</div>
                <span className="font-semibold">anoon · admin</span>
                <button
                  onClick={() => setDrawer(false)}
                  aria-label="Закрыть меню"
                  className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-fg-secondary hover:bg-surface-2"
                >
                  <X size={20} />
                </button>
              </div>
              <NavList onNavigate={() => setDrawer(false)} />
              <button
                onClick={() => logout()}
                className="m-3 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-danger"
              >
                <LogOut size={18} /> Выйти
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Контент */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-border bg-surface-1 px-4 md:px-5">
          {/* Бургер — только на телефоне */}
          <button
            onClick={() => setDrawer(true)}
            aria-label="Открыть меню"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg-secondary hover:bg-surface-2 md:hidden"
          >
            <Menu size={20} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-fg-muted">
            <Search size={16} className="shrink-0" />
            <input placeholder="Поиск: ник или #ID" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-muted" />
          </div>
          <AdminPwa />
          <div className="hidden shrink-0 text-sm text-fg-secondary sm:block">{identity?.name ?? "admin"}</div>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {children}
          </motion.div>
        </main>
      </div>
      <Toaster />
    </div>
  );
}
