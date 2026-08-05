"use client";

import type { DataProvider } from "@refinedev/core";

// dataProvider для NEXT_PUBLIC_DATA_MODE=api. Ходит в собственные route handlers
// (/api/admin/<resource>), которые читают Supabase Postgres (secret-ключ, bypass RLS)
// и отдают строки в форме admin-UI (см. data/fixtures типы). Cookie-сессия шлётся авто.
const BASE = "/api/admin";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
  return res.json() as Promise<T>;
}

export const apiDataProvider: DataProvider = {
  getApiUrl: () => BASE,

  getList: async ({ resource, pagination, sorters, filters }) => {
    const qs = new URLSearchParams();
    const current = pagination?.currentPage ?? 1;
    const pageSize = pagination?.pageSize ?? 10;
    if (pagination?.mode !== "off") {
      qs.set("page", String(current));
      qs.set("pageSize", String(pageSize));
    }
    const sorter = sorters?.[0];
    if (sorter) {
      qs.set("sort", sorter.field);
      qs.set("order", sorter.order);
    }
    for (const f of filters ?? []) {
      if ("field" in f && f.value != null && f.value !== "") qs.set(`f_${f.field}`, String(f.value));
    }
    const res = await fetch(`${BASE}/${resource}?${qs.toString()}`);
    const { data, total } = await json<{ data: unknown[]; total: number }>(res);
    return { data: data as never, total };
  },

  getOne: async ({ resource, id }) => {
    const res = await fetch(`${BASE}/${resource}/${id}`);
    const { data } = await json<{ data: unknown }>(res);
    return { data: data as never };
  },

  getMany: async ({ resource, ids }) => {
    const qs = new URLSearchParams({ ids: ids.map(String).join(",") });
    const res = await fetch(`${BASE}/${resource}?${qs.toString()}`);
    const { data } = await json<{ data: unknown[] }>(res);
    return { data: data as never };
  },

  update: async ({ resource, id, variables }) => {
    const res = await fetch(`${BASE}/${resource}/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(variables),
    });
    const { data } = await json<{ data: unknown }>(res);
    return { data: data as never };
  },

  create: async ({ resource, variables }) => {
    const res = await fetch(`${BASE}/${resource}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(variables),
    });
    const { data } = await json<{ data: unknown }>(res);
    return { data: data as never };
  },

  deleteOne: async ({ resource, id }) => {
    const res = await fetch(`${BASE}/${resource}/${id}`, { method: "DELETE" });
    const { data } = await json<{ data: unknown }>(res);
    return { data: data as never };
  },
};
