# Миграции Prisma — baseline

БД до сих пор велась через `prisma db push` (Supabase pooler без shadow-db не даёт
`migrate dev`). `0_init` — baseline из текущей схемы (`migrate diff --from-empty`),
чтобы перейти на версионные миграции перед продом.

## Как принять baseline на существующей БД (одноразово)

БД уже содержит таблицы (созданы `db push`). Нужно пометить `0_init` как **применённую**,
не выполняя её повторно:

```bash
# DIRECT_URL — прямое соединение (session pooler 5432), не transaction 6543.
pnpm --filter @anoon/db exec prisma migrate resolve --applied 0_init
```

После этого на чистых окружениях:

```bash
pnpm --filter @anoon/db exec prisma migrate deploy
```

## Новые изменения схемы (после baseline)

```bash
# на dev-БД с shadow (или локальный Postgres):
pnpm --filter @anoon/db exec prisma migrate dev --name <изменение>
```

> Примечание: последняя правка схемы (`PushSubscription`) уже входит в `0_init`.
> Если таблица `PushSubscription` ещё не создана в живой БД — примени `db push`
> один раз перед `migrate resolve`, либо выполни `CREATE TABLE` из `0_init/migration.sql`.
