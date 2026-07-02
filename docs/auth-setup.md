# anoon — Ручная настройка Supabase Auth (фича аккаунтов)

> Чеклист для владельца проекта. Всё делается руками в дашбордах
> Supabase / Google Cloud / Vercel — кода тут нет.
> Проект Supabase: `acepsafoeihfrgbzrbif` · Прод: `https://anoon-web.vercel.app`

**Правило безопасности:** Client Secret от Google — только в Supabase Dashboard.
Никогда не в git, не в код, не в публичный чат/скрин.

---

## 1. Redirect URLs в Supabase Auth

**Зачем:** Supabase пускает редиректы после OAuth-входа и писем (подтверждение,
сброс пароля) только на URL из allow-list. Не добавишь — юзер отскочит неавторизованным.

**Где:** Supabase Dashboard → **Authentication → URL Configuration**.

- [ ] 1.1. **Site URL** = `https://anoon-web.vercel.app`
- [ ] 1.2. В **Redirect URLs** добавить прод:
  - `https://anoon-web.vercel.app/auth/callback`
  - `https://anoon-web.vercel.app/recover/reset`
- [ ] 1.3. Добавить preview-деплои Vercel (wildcard):
  - `https://*-karapetyanhaykoooo-8237s-projects.vercel.app/auth/callback`
  - `https://*-karapetyanhaykoooo-8237s-projects.vercel.app/recover/reset`
- [ ] 1.4. Добавить localhost (локальная разработка):
  - `http://localhost:3000/auth/callback`
  - `http://localhost:3000/recover/reset`

---

## 2. Google OAuth

**Зачем:** кнопка «Войти через Google».

**Шаг А — Google Cloud Console** (https://console.cloud.google.com):

- [ ] 2.1. Создать проект (или взять существующий) → **APIs & Services → OAuth consent screen**:
  тип **External**, имя приложения `anoon`, support email — твой. Scopes хватает
  дефолтных (`email`, `profile`, `openid`).
- [ ] 2.2. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
  - Application type: **Web application**
  - Authorized redirect URI (ровно один, это Supabase, не наш сайт):
    `https://acepsafoeihfrgbzrbif.supabase.co/auth/v1/callback`
- [ ] 2.3. Скопировать **Client ID** и **Client Secret** (secret показывается один раз).

**Шаг Б — Supabase** (Dashboard → **Authentication → Providers → Google**):

- [ ] 2.4. Включить провайдер Google, вставить Client ID и Client Secret → Save.

---

## 3. Email-провайдер (email/пароль + подтверждение)

**Где:** Supabase Dashboard → **Authentication → Providers → Email**.

- [ ] 3.1. Провайдер **Email** — включён (обычно включён по умолчанию).
- [ ] 3.2. **Confirm email — ВКЛЮЧИТЬ** (решение зафиксировано: регистрация с
  подтверждением почты; юзер не войдёт, пока не кликнет ссылку в письме).
- [ ] 3.3. Проверить шаблоны писем: **Authentication → Emails (Email Templates)** —
  минимум «Confirm signup» и «Reset password». Можно перевести тексты на русский
  (продукт одноязычный). Ссылки в шаблонах не трогать — редиректы берутся из п. 1.
- [ ] 3.4. (Опционально, позже) Встроенный SMTP Supabase лимитирован (~2 письма/час на
  проект в бесплатном тире) — для реального трафика подключить свой SMTP:
  **Project Settings → Auth → SMTP Settings**.

---

## 4. Anonymous sign-ins — ОСТАВИТЬ ВКЛючённым

**Где:** Supabase Dashboard → **Authentication → Providers (Sign In / Up) → Anonymous**.

- [ ] 4.1. **НЕ выключать.** Нужен для миграции старых анонимов: существующая
  анон-сессия линкуется к реальному аккаунту через `linkIdentity` / `updateUser`
  (тот же uid → профиль, `#ID` и история сохраняются). Выключим только после того,
  как миграция старых пользователей закончится (или базу почистят перед запуском).

---

## 5. Env-флаги в Vercel

**Где:** Vercel → проект **web** (scope `karapetyanhaykoooo-8237s-projects`) →
**Settings → Environment Variables**.

- [ ] 5.1. `NEXT_PUBLIC_ACCOUNTS_ENABLED` — общий выключатель фичи аккаунтов.
  - Сначала добавить `false` (или не добавлять) в Production, `true` — в Preview,
    чтобы обкатать на preview-деплоях.
  - Включить в Production (`true`) на шаге выката G8.
- [ ] 5.2. `NEXT_PUBLIC_APPLE_ENABLED=false` — кнопка Apple ID, по умолчанию выключена
  (см. п. 6).
- [ ] 5.3. После изменения env-переменных — **редеплой** (Vercel не подхватывает
  `NEXT_PUBLIC_*` без пересборки).
- [ ] 5.4. Для локальной разработки продублировать оба флага в `web/.env.local`.

---

## 6. Apple ID — отложено (заглушка «включить позже»)

Требует **Apple Developer Program ($99/год)** — пока не покупаем.
Код готов: `apple` есть в enum провайдеров, кнопка спрятана за
`NEXT_PUBLIC_APPLE_ENABLED`.

Когда решим включить:

- [ ] 6.1. Купить членство Apple Developer.
- [ ] 6.2. В Apple Developer: создать App ID + Services ID, ключ Sign in with Apple,
  redirect = `https://acepsafoeihfrgbzrbif.supabase.co/auth/v1/callback`.
- [ ] 6.3. Supabase → Authentication → Providers → Apple: включить, вставить креды.
- [ ] 6.4. Vercel: `NEXT_PUBLIC_APPLE_ENABLED=true` + редеплой.

---

## Быстрая проверка после настройки

- [ ] Google-вход на проде: `/register` → «Войти через Google» → возврат на
  `/auth/callback` авторизованным.
- [ ] Email-регистрация: письмо «Confirm signup» приходит, ссылка работает.
- [ ] Сброс пароля: письмо приходит, ссылка ведёт на `/recover/reset`.
- [ ] Старый аноним при входе может привязать аккаунт с сохранением своего `#ID`.

**Мне скажи:** «auth настроен» — секреты в чат не нужны.
