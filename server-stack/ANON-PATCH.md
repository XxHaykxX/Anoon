# ANON-PATCH — мини-патч анонимности Tinode (вариант E)

> Task A1 из `BUILD-PLAN.md`. Решение — `COMPANION-PLAN.md`, раздел 1, блок «✅ Решено».
> База: Tinode **v0.25.2**, исходник в `../server`. Патчим ТОЛЬКО `server/server/topic.go`.
> Всё помечено маркерами `// anoon anon patch (variant E)` — grep по ним находит все хунки.

## Идея в двух словах

Анон-чат = **обычный group-топик между двумя РЕАЛЬНЫМИ аккаунтами** + флаг «анонимный».
Сервер на выходе (в трёх местах) обнуляет личность собеседника: `From` в сообщениях,
`From` в истории, `UID/Public/Trusted` пира в `{meta sub}`. Родной движок Tinode
(медиа, голос, «печатает», статусы) работает как обычно — просто без имён.
**Не-анонимные топики патч не трогает вообще** (весь код под `if t.isAnon()`).

## Как топик помечается анонимным (модель флага)

Флаг живёт в **`aux`** топика (`map[string]any`, «Auxiliary set of key-value pairs») —
это штатное, persist-в-БД поле топика. Companion (ROOT-бот / админ топика) ставит его при
создании пары:

```
{set topic:"grpXXXXX" desc: {aux: {"anon": true}}}
```

Снятие флага при «Раскрыть профиль» (Фаза C4) — тем же путём `aux:{"anon": false}` (или
удалить ключ). История и топик остаются на месте, чат становится дружеским. Ноль миграции.

Почему `aux`, а не Public/Private/новое поле:
- `aux` уже грузится из БД в `Topic.aux` (`init_topic.go:265, 652, 736`) — патчу не нужна
  своя персистентность.
- `aux` меняется по `{set desc}` (`topic.go:3155`) — companion ставит флаг штатным API как ROOT.
- Public/Private несут пользовательские данные (имя, аватар) — мешать туда флаг грязно.
- Новое поле в struct → миграция схемы БД. Не нужно.

Чтение флага — helper `isAnon()`, толерантен к типам (JSON из БД даёт `bool`/`float64`/`string`).

## Точки патча (файл `server/server/topic.go`)

Строки указаны на момент патча (v0.25.2 + этот патч). После upgrade — искать по маркеру и
имени функции, не по номеру строки.

### 1. `isAnon()` — новый helper (строки ~252–271, функция на 258)
Новый метод. Читает `t.aux["anon"]`, возвращает `bool`. Индексация nil-map безопасна.

```go
// anoon anon patch (variant E) -- BEGIN
func (t *Topic) isAnon() bool {
    switch v := t.aux["anon"].(type) {
    case bool:    return v
    case float64: return v != 0
    case string:  return v == "true" || v == "1"
    default:      return false
    }
}
// anoon anon patch (variant E) -- END
```

### 2. `prepareBroadcastableMessage` (маркеры ~304–318, функция на 274)
**Что закрывает:** live-сообщения `{data}` + «печатает»/read-receipts `{info}` (оба идут через
эту функцию всем сессиям).
**Before:** `msg.Data.From` / `msg.Info.From` несут реальный UID отправителя.
**After:** в анон-топике оба обнуляются в `""`.

```go
// anoon anon patch (variant E) -- BEGIN
if t.isAnon() {
    if msg.Data != nil { msg.Data.From = "" }
    if msg.Info != nil { msg.Info.From = "" }
}
// anoon anon patch (variant E) -- END
```

### 3. `replyGetSub` (маркеры ~2744–2753, функция на 2435)
**Что закрывает:** ответ на `{get sub}` / `{meta sub}` — список подписчиков топика. Здесь пир
раскрывался бы полностью (UID + Public + Trusted).
**Before:** `mts.User`, `mts.Public`, `mts.Trusted` заполнены для КАЖДОГО подписчика.
**After:** для чужой подписки (`uid != asUid`) в анон-топике эти три поля обнуляются. Своя
подписка не трогается (клиент должен знать себя). `Private` — персональное, не пира.

```go
// anoon anon patch (variant E) -- BEGIN
if t.isAnon() && uid != asUid {
    mts.User = ""
    mts.Public = nil
    mts.Trusted = nil
}
// anoon anon patch (variant E) -- END
```

### 4. `replyGetData` (маркер ~2843, функция на 2816)
**Что закрывает:** историю сообщений `{get data}` (при входе в чат / скролле).
**Before:** `from = types.ParseUid(mm.From).UserId()` — реальный UID автора в каждом старом сообщении.
**After:** условие расширено с `!asChan` до `!asChan && !t.isAnon()` — в анон-топике `from`
остаётся `""` (upstream так делал только для channel-читателей).

```go
mm := &messages[i]
from := ""
// anoon anon patch (variant E): don't show sender for channel
// readers or anonymous topics (upstream only blanked asChan).
if !asChan && !t.isAnon() {
    from = types.ParseUid(mm.From).UserId()
}
```

## Presence — почему НЕ патчим

`{pres}` (онлайн/оффлайн) намеренно НЕ обнуляется. По дизайну анон-топик создаётся companion'ом
**без бита `P`** в acs → presence пирам вообще не рассылается (`topic.go` presence-фильтры).
Онлайн-точку («в сети») в анон-фазе даёт **companion** (он и так трекает online для админки).
Это держит патч в одном файле — не разрастается на `pres.go`/`hub.go`.

> **Инвариант для companion (важно!):** при создании анон-топика НЕ выдавать паре бит `P`
> в `modeWant/modeGiven`. Если `P` случайно выдан — presence утечёт с реальным UID в `From`
> (эта точка не патчена). Проверять в интеграционном тесте раскрытия.

## Сборка

- Локальная проверка компиляции: `cd server && go build -tags postgres ./server/` → **OK (exit 0)**,
  `go vet -tags postgres ./server/` чисто. go.mod требует `go 1.24.0`.
- Полный образ: `cd server-stack && docker compose build tinode` → образ `anoon-tinode:0.25.2`
  (Dockerfile использует `golang:1.24-alpine`, совпадает с go.mod). Собирается из `../server`.

## Как переналожить после upgrade Tinode

1. Обновить `../server` на новый тег upstream.
2. `grep -rn "anoon anon patch (variant E)" server/server/topic.go` в СТАРОЙ версии (или в git-diff)
   — получить 4 хунка.
3. Найти в новом `topic.go` те же 4 функции по имени: `prepareBroadcastableMessage`,
   `replyGetSub`, `replyGetData` (+ добавить `isAnon()` helper рядом). Номера строк сдвинутся —
   ориентир имя функции, не строка.
4. Переложить хунки, сохранив маркеры. Логика минимальна и локальна, конфликтов почти не будет.
5. `go build -tags postgres ./server/` + `docker compose build tinode`.

## Как протестировать end-to-end (два аккаунта)

Нужен ROOT-бот companion (Фаза A2) ИЛИ ручная имперсонация ROOT по gRPC. Минимальный сценарий:

1. Завести двух реальных юзеров: Алиса (usrA), Боб (usrB).
2. ROOT создаёт group-топик `grpX`, подписывает обоих **без бита `P`** (acs напр. `JRWSA`
   без `P`), ставит `{set topic:"grpX" desc:{aux:{"anon":true}}}`.
3. Алиса и Боб подписываются на `grpX`.
4. **Проверки анонимности (должны ВСЕ пройти):**
   - Алиса шлёт `{pub}` → Боб получает `{data}` с `from == ""` (не `usrA`). ✅
   - Боб делает `{get data}` (история) → все старые сообщения с `from == ""`. ✅
   - Боб делает `{get sub}` → в списке подписок пир (Алиса) без `user`/`public`/`trusted`;
     своя подписка Боба — с данными. ✅
   - Алиса шлёт `{note kp}` («печатает») → Боб видит `{info what:"kp"}` с `from == ""`. ✅
   - Presence: Боб НЕ получает `{pres}` про Алису (нет бита `P`). ✅
5. **Проверка не-регрессии:** обычный (не-anon) group/p2p топик — `from`, `user`, `public`
   отдаются как раньше (флаг не стоит → `isAnon()==false` → патч не активен).
6. **Проверка раскрытия:** ROOT снимает `aux:{"anon":false}` → повторный `{get sub}`/`{get data}`
   уже отдаёт `user`/`public`/`from`. Чат стал дружеским, история цела.

## Резюме изменений

| Файл | Функция | Что | Активно когда |
|------|---------|-----|---------------|
| `server/server/topic.go` | `isAnon()` (нов.) | читает `aux["anon"]` | — |
| `server/server/topic.go` | `prepareBroadcastableMessage` | `Data.From=""`, `Info.From=""` | `isAnon()` |
| `server/server/topic.go` | `replyGetSub` | `User/Public/Trusted` пира → nil | `isAnon() && uid!=asUid` |
| `server/server/topic.go` | `replyGetData` | `From=""` в истории | `isAnon()` |

Один файл, 4 хунка, ~25 строк. Ноль изменений схемы БД. Флаг — `aux["anon"]`, ставит companion как ROOT.
