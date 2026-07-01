"use client";

import { useGetIdentity, useLogout } from "@refinedev/core";
import { motion } from "framer-motion";
import { Ban, Flag, LayoutDashboard, LogOut, ScrollText, Search, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Toaster } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/overview", label: "Обзор", icon: LayoutDashboard },
  { href: "/reports", label: "Жалобы", icon: Flag },
  { href: "/users", label: "Пользователи", icon: Users },
  { href: "/bans", label: "Баны", icon: Ban },
  { href: "/audit", label: "Журнал", icon: ScrollText },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { mutate: logout } = useLogout();
  const { data: identity } = useGetIdentity<{ name?: string }>();

  return (
    <div className="flex min-h-dvh bg-bg text-fg">
      {/* Сайдбар */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface-1 md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg font-semibold">a</div>
          <span className="font-semibold">anoon · admin</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname?.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
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
        <button
          onClick={() => logout()}
          className="m-3 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-danger"
        >
          <LogOut size={18} /> Выйти
        </button>
      </aside>

      {/* Контент */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-border bg-surface-1 px-5">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-fg-muted">
            <Search size={16} />
            <input placeholder="Поиск: ник или #ID" className="w-56 bg-transparent outline-none placeholder:text-fg-muted" />
          </div>
          <div className="ml-auto text-sm text-fg-secondary">{identity?.name ?? "admin"}</div>
        </header>
        <main className="flex-1 overflow-auto p-6">
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
