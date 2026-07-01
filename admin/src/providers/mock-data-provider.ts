import type { DataProvider } from "@refinedev/core";

import { fixtures } from "@/data/fixtures";

// In-memory dataProvider для DATA_MODE=mock. Реализует минимум CRUD над фикстурами.
// Клонируем массивы, чтобы мутации (ban/dismiss) были локально видимы в рамках сессии.
const store: Record<string, Record<string, unknown>[]> = Object.fromEntries(
  Object.entries(fixtures).map(([k, v]) => [k, (v as Record<string, unknown>[]).map((x) => ({ ...x }))]),
);

function list(resource: string) {
  return store[resource] ?? [];
}

export const mockDataProvider: DataProvider = {
  getApiUrl: () => "/mock",

  getList: async ({ resource, pagination, sorters, filters }) => {
    let data = [...list(resource)];

    // Фильтры (простое равенство/contains по полю).
    for (const f of filters ?? []) {
      if ("field" in f && f.value != null && f.value !== "") {
        const field = f.field;
        data = data.filter((row) => {
          const v = row[field];
          if (f.operator === "contains") return String(v ?? "").toLowerCase().includes(String(f.value).toLowerCase());
          return v === f.value;
        });
      }
    }

    // Сортировка.
    const sorter = sorters?.[0];
    if (sorter) {
      data.sort((a, b) => {
        const av = a[sorter.field] as never;
        const bv = b[sorter.field] as never;
        if (av === bv) return 0;
        const r = av > bv ? 1 : -1;
        return sorter.order === "desc" ? -r : r;
      });
    }

    const total = data.length;
    const current = pagination?.currentPage ?? 1;
    const pageSize = pagination?.pageSize ?? 10;
    if (pagination?.mode !== "off") {
      data = data.slice((current - 1) * pageSize, current * pageSize);
    }
    return { data: data as never, total };
  },

  getOne: async ({ resource, id }) => {
    const row = list(resource).find((r) => r.id === id);
    return { data: (row ?? null) as never };
  },

  getMany: async ({ resource, ids }) => {
    const data = list(resource).filter((r) => ids.map(String).includes(String(r.id)));
    return { data: data as never };
  },

  create: async ({ resource, variables }) => {
    const row = { id: `${resource}-${list(resource).length + 1}`, ...(variables as object) } as Record<string, unknown>;
    list(resource).push(row);
    return { data: row as never };
  },

  update: async ({ resource, id, variables }) => {
    const arr = list(resource);
    const i = arr.findIndex((r) => r.id === id);
    if (i >= 0) arr[i] = { ...arr[i], ...(variables as object) };
    return { data: (arr[i] ?? null) as never };
  },

  deleteOne: async ({ resource, id }) => {
    const arr = list(resource);
    const i = arr.findIndex((r) => r.id === id);
    const [removed] = i >= 0 ? arr.splice(i, 1) : [null];
    return { data: (removed ?? null) as never };
  },
};
