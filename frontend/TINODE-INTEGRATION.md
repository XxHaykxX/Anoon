# frontend ↔ Tinode integration

How the anoon frontend connects to real messaging. Companion decisions live in
`../anoon/COMPANION-PLAN.md`; server status in `../anoon/PROJECT-STATUS.md`.

## Two backends, one rule

anoon talks to **two** services. Keep the split clean:

| Concern | Owner | Transport | Client module |
| --- | --- | --- | --- |
| Chat: messages, media, typing, presence, topics | **Tinode** `:6061` | WebSocket (tinode-sdk) | `src/lib/tinode.ts` |
| Login/OAuth, roulette matchmaking, friends, #ID, reports, money, events | **Companion** (Go) `:6062` | REST + WS | `src/lib/companion.ts` |

The companion brokers auth and *provisions* the Tinode account, then hands the
browser a short-lived **Tinode token**; the browser opens the chat connection
with that token. The browser never speaks gRPC (`:16061` is companion↔Tinode only).

> **Status (2026-07-03):** Tinode `:6061` is **up**; companion `:6062` is **down**
> (not built yet — another agent owns `server-stack/`). So the first real slice
> authenticates *directly* against Tinode with the `basic` scheme, bypassing the
> companion. When the companion lands (Phase A3), auth moves to it and the
> browser switches to `loginToken` — `TinodeClient.loginToken()` is already wired.

## SDK

`tinode-sdk@0.25.1` (already a dependency). Ships UMD only, no types — we keep a
partial ambient decl at `src/types/tinode-sdk.d.ts` (extend as we use more API).
Full API: http://tinode.github.io/js-api/. In the browser the SDK auto-detects the
global `WebSocket`, so no `setNetworkProviders` is needed.

## Env config (`.env.local`, see `.env.local.example`)

```
NEXT_PUBLIC_TINODE_WS=ws://localhost:6061/v0/channels
NEXT_PUBLIC_TINODE_API_KEY=AQEAAAABAAD_rAp4DJh05a1HAwFT3A6K   # default self-hosted key
NEXT_PUBLIC_USE_TINODE=0        # "1" = auth hits the real server; else mocks
NEXT_PUBLIC_COMPANION_URL=http://localhost:6062
```

`NEXT_PUBLIC_USE_TINODE` is the kill-switch: **0 keeps every screen on mocks** so
the UI runs with no backend. Flip to `1` to exercise the live Tinode path.

## Client wrapper — `src/lib/tinode.ts`

`TinodeClient` holds one connection per signed-in session (app-wide singleton via
`getTinodeClient()`; the zustand session slice owns its lifecycle).

- `connect(wsUrl?)` — open the WebSocket (idempotent). **Real.**
- `createAccountBasic(login, password, fn?)` → uid — create a `basic` account
  (auto-logs-in), optional display name stored as public `fn`. **Real.**
- `loginBasic(login, password)` → uid. **Real.**
- `loginToken(token)` → uid — companion-issued token path. **Real (untested until
  companion exists).**
- `getUid()`, `isConnected()`, `disconnect()`. **Real.**
- `subscribeTopic()`, `sendMessage()`, `sendTyping()`, `leaveTopic()` — **scaffold
  stubs**, Phase C.

`tinodeLoginFromEmail(email)` folds an email into a valid Tinode `basic` username
(`[a-z0-9_.-]` only; deterministic so register ↔ login agree).

## Auth stepper → Tinode

Current stepper: `auth-login → auth-register → auth-gender → auth-profile-setup → home`.

- **Mock mode (`USE_TINODE=0`, default):** unchanged — buttons just navigate.
- **Real mode (`USE_TINODE=1`):** `AnoonRegister`'s *Зарегистрироваться* calls the
  store's `signInWithBasic({ email, password, isNew:true, displayName, gender })`,
  which `connect()`s and `createAccountBasic()`s on Tinode, synthesizes a
  placeholder `User` from the uid, sets status `ready`, and lands on `home`. Errors
  surface via `authError` under the button. (The gender/profile-setup screens are
  skipped in real mode since register already collects both.)
- **OAuth buttons** (Google/Facebook/Apple) stay mock until the companion brokers
  OAuth (Phase A3) — they need `companion.googleOAuth()` → `AuthResult.tinodeToken`
  → `TinodeClient.loginToken()`.

The synthesized `User` (`hashId`, `coins`, `subscription`, real `age`) is a
placeholder — those are companion-owned and become real once companion provisions
the account and returns an `AuthResult`.

## Chat list → Tinode `me` topic — REAL (C1)

The friends/chats list is now sourced from the Tinode **`me`** topic. After
`signInWithBasic`, the store calls `startContacts()` → `TinodeClient.subscribeMe()`:
subscribe `me` with `withSub().withDesc()`, then iterate `me.contacts(cb)`.

> **SDK gotcha:** each object yielded by `me.contacts(cb)` is a **`Topic` instance**,
> not a plain sub. The p2p peer uid is on **`c.name`** (NOT `c.topic`); display name
> is `c.public.fn`; unread is the direct `c.unread` field; `c.online`/`c.touched`
> drive the dot + sorting. We keep only `name`-starts-with-`usr` (p2p) contacts.

`subscribeMe` re-emits on `me.onSubsUpdated`, so new contacts/presence stream in
live. `ChatSlice.startContacts` maps each `MeContact` → companion `Friend`
(`contactToFriend`) and calls `setFriends`, sorted by `touched` desc. `AnoonFriends`
renders `store.friends` when `USE_TINODE`, else `INITIAL_FRIENDS`. Companion will
later supply richer metadata (#ID, real display name); `me` is the fallback/base.

## A chat → Tinode topic + `{data}` — REAL (C1)

One friend chat = one p2p topic. `ChatSlice.openChat(friend)` →
`TinodeClient.subscribeTopic(friend.topic, handlers)`:

- **Incoming:** `topic.onData` → `plainText(content)` (string or Drafty `.txt`) →
  `TinodeMessageLite` upserted into `chatMessages` (peer messages only; own are
  optimistic). Recent history via `startMetaQuery().withLaterData(24)`.
- **Send:** `sendChatMessage` appends an optimistic bubble (`status:'sending'`),
  then `topic.publishMessage(topic.createMessage(text, true))`; the returned `seq`
  reconciles the temp id → `status:'sent'`.
- **Typing:** peer `{info what:'kp'}` → `onTyping` → `chatPeerTyping` (auto-clears
  in 3s); we emit our own via `topic.noteKeyPress()` (`notifyTyping`, throttled to
  1/3s at the input). `{info what:'read'}` flips own bubbles to `status:'read'`; we
  `noteRead` on incoming.
- **Lifecycle:** `AnoonPrivateChat` (new `private-chat` route in `anoonNav`/`AnoonApp`)
  reads the store when `USE_TINODE`; `closeChat` leaves the topic on unmount/back.
- Anon roulette match → a server-side anon topic (blanked by the anonymity patch,
  `COMPANION-PLAN.md` variant E) — still on mocks, out of scope here.

**Reachability note:** a freshly created account has no contacts, so the real
friends list starts empty. A contact appears once a p2p topic exists between two
users (one side subscribes/messages the other). Until the companion friend-accept
flow creates these, seed a contact by having a second account message the first.

## Verification done

Node smoke tests against live `:6061` (same code paths as the wrapper):
- **Login:** `connect` ok, `createAccountBasic` → ctrl 200 `params.user:usrXXXX`,
  `loginBasic` on a fresh connection → same uid.
- **1:1 chat:** two accounts, A `publishMessage` → B `onData` fires with
  `{from, seq, content}`; A `noteKeyPress` → B `onInfo {what:'kp'}`.
- **Contacts:** after a p2p message, A's `me.contacts` → mapped
  `{topic:usrB, fn:'Bob', online, unread, touched}` (validates `subscribeMe`).

`npm run typecheck` → 0 errors.

## Next slices

1. **Reachable first chat without companion** — a dev "new chat by #ID/uid" entry
   (e.g. in `AnoonFriendSearch`) that `openChat`s a synthesized friend, so a live
   1:1 is testable in-app before the companion friend flow exists.
2. **Presence + unread polish** — drive online dots from `me`/topic `onPres` and
   unread badges from `MeContact.unread` (currently a snapshot; badge shows 0).
3. **Companion auth + friends** — when `:6062` is up, route login through
   `companion.emailLogin`/`googleOAuth` → `loginToken`, replace the synthesized
   `User`/#ID, and let companion friend-accept create the p2p topics.
