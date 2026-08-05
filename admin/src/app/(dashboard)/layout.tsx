"use client";

import { Authenticated } from "@refinedev/core";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AdminShell } from "@/components/admin-shell";

function RedirectToLogin() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login");
  }, [router]);
  return null;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Authenticated key="dashboard" fallback={<RedirectToLogin />} loading={null}>
      <AdminShell>{children}</AdminShell>
    </Authenticated>
  );
}
