"use client";

import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/nextjs-router/app";
import { LayoutDashboard, Flag, Users, Ban } from "lucide-react";

import { apiAuthProvider } from "./api-auth-provider";
import { apiDataProvider } from "./api-data-provider";
import { authProvider } from "./auth-provider";
import { mockDataProvider } from "./mock-data-provider";

// Обёртка Refine (client — context не работает в server-компонентах Next).
// Режим — NEXT_PUBLIC_DATA_MODE: "api" → реальные route handlers + cookie-auth,
// иначе — mock (in-memory фикстуры + клиентский гейт).
const API_MODE = process.env.NEXT_PUBLIC_DATA_MODE === "api";

export function RefineProviders({ children }: { children: React.ReactNode }) {
  return (
    <Refine
      dataProvider={API_MODE ? apiDataProvider : mockDataProvider}
      routerProvider={routerProvider}
      authProvider={API_MODE ? apiAuthProvider : authProvider}
      resources={[
        { name: "reports", list: "/reports", meta: { label: "Жалобы", icon: <Flag size={18} /> } },
        { name: "users", list: "/users", meta: { label: "Пользователи", icon: <Users size={18} /> } },
        { name: "bans", list: "/bans", meta: { label: "Баны", icon: <Ban size={18} /> } },
        { name: "overview", list: "/overview", meta: { label: "Обзор", icon: <LayoutDashboard size={18} /> } },
      ]}
      options={{ syncWithLocation: true, disableTelemetry: true, warnWhenUnsavedChanges: true }}
    >
      {children}
    </Refine>
  );
}
