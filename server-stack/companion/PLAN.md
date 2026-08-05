# anoon companion — implementation plan

> Concrete build plan for the anoon companion service (roulette / #ID / friends /
> moderation). It plugs into **stock Tinode over gRPC** so the core stays
> upgradeable. Decisions here follow `../../COMPANION-PLAN.md` (the decision
> board) and are grounded in the Tinode v0.25.2 source under `../../server`.
>
> Status: phase A2 scaffold is live and compiles; the first end-to-end slice
> (#ID allocation via ROOT account creation) is implemented. See "Build order".

---

## 1. The gRPC integration model (what Tinode actually exposes)

Tinode exposes **two** gRPC surfaces (proto: `../../server/pbx/model.proto`,
vendored into `internal/pbx`):

- **`Node` service — Tinode is the server, we are the client.** A single
  bidirectional stream, `MessageLoop(stream ClientMsg) returns (stream ServerMsg)`
  (`../../server/server.go`, session handling in `../../server/session.go`).
  A client speaks the same `{hi}/{login}/{sub}/{pub}/{get}/{set}/{acc}/{del}`
  protocol as the WebSocket API. **This is our channel.** We log in once as a
  ROOT account and drive everything from that stream.
  - **ROOT + `on_behalf_of`:** a session authenticated at `AuthLevel_ROOT`
    (account flagged by `tinode-db --make_root`) may set `ClientMsg.Extra`
    (`ClientExtra{ OnBehalfOf, AuthLevel }`, model.pb.go) to act **as any user**
    within the one stream — how we will create/join topics for a matched pair,
    lift the anon flag on reveal, and post system messages. Replies are `{ctrl}`
    correlated by the request `id` we set.
  - **Ban / unban:** ROOT `{acc state:"susp"}` on a UID → `changeUserState`
    (`../../server/user.go`) kills sessions + blocks login. `state:"ok"` reverses.
  - **Account creation:** `{acc user_id:"new" scheme:"basic" secret:"login:pw"}`
    returns the new UID in `ctrl.params["user"]`. (Implemented — see slice below.)

- **`Plugin` service — we are the server, Tinode calls us.** `FireHose`
  intercepts every inbound packet on the hot path (`../../server/pluginfilter.go`,
  `plugins.go`), can DROP/RESPOND/REPLACE, and `Find` can replace `fnd` search
  results. **Decision (Q11): we do NOT run a plugin.** Nothing of ours sits on
  Tinode's hot path. Ban = account state, mute = drop the `W` right, #ID search =
  our own API. Keeps the core stock and uptime independent of us.

**Auth model:** a `rest`-scheme auth service (`../../server/auth/rest/`) lets
Tinode POST auth decisions to us — this is the future hook for Google/Apple
OAuth (phase A3). For A2 we create accounts directly with ROOT `{acc}` on the
Node stream.

**Net effect:** companion = a **ROOT gRPC client** of Tinode + its own REST/WS
API for anoon operations. One long-lived stream, request/reply correlated by id.

---

## 2. Module layout (`server-stack/companion/`)

```
main.go                 config → db+migrate → ROOT bot (goroutine) → HTTP; graceful shutdown
internal/
  config/               env loading (COMPANION_*, TINODE_GRPC_ADDR)
  db/                   pgx/v5 over database/sql + embedded migration runner
    migrations/0001_init.sql   users, friendships, reports, roulette_queue, subscriptions
  tinode/               ROOT-bot gRPC: dial, {hi}+{login}, read loop, reconnect,
                        request/ctrl correlation, ROOT actions (CreateAccount live)
  store/                anoon DB access layer (users/#ID live; rest per feature)
  api/                  REST + WS surface (net/http 1.22 mux); /health + /auth/register live
  pbx/                  VENDORED copy of Tinode's generated gRPC contract
```

Key infra decisions (rationale in `README.md`): **vendored `pbx`** (avoids the
huge `github.com/tinode/chat` dep graph), **pgx stdlib** driver, **homegrown
embedded migrations**, **gorilla/websocket**. DB = a separate `anoon` database in
the existing `postgres:16` container (Tinode's schema untouched).

---

## 3. Proto contract we rely on

From `internal/pbx` (do not edit; re-copy the two generated files if Tinode
regenerates them):

| Message | Use |
|---|---|
| `ClientHi` / `ClientLogin` | handshake + ROOT login (basic, secret `login:pw`) |
| `ClientAcc` (`user_id:"new"`, `state`, `tags`, `desc`, `cred`) | create/suspend accounts; UID returns in `ctrl.params["user"]` |
| `ClientMsg.Extra` = `ClientExtra{OnBehalfOf, AuthLevel}` | act as a user (topic create/join, reveal, system msg) |
| `ClientSub` / `SetDesc` / `SetSub` | create anon group topic, subscribe matched pair, set access mode |
| `ClientSet` (acs) | mute = remove `W`; reveal = flip anon flag |
| `ClientDel` | remove p2p sub (unfriend), delete view-once media |
| `ServerCtrl{Id,Code,Text,Params}` | reply correlation (Params carries `user`, `acs`, …) |
| `ServerData/Pres/Info/Meta` | later: moderation reads, admin presence |

---

## 4. Feature → Tinode mapping

| anoon feature | How | Tinode side | Anon patch? |
|---|---|---|---|
| **#ID** (`#00001`) | `hash_id_seq` in companion, `hash_id↔tinode_uid` in `users` | — | no |
| **Register (basic)** | `CreateAccount` (ROOT `{acc}`) → allocate #ID | `{acc user_id:"new"}` | no |
| **Register (OAuth)** | `rest`-auth endpoint validates provider token → UID | `auth/rest` | no |
| **Roulette match** | in-mem + `roulette_queue`; on match create anon topic | ROOT `{sub}`+`{set}` (on_behalf_of both) | — |
| **Anonymous chat** | normal group topic + "anonymous" flag; server hides UID/Public/From | native engine | **yes (variant E)** |
| **Reveal → friends** | flip anon flag; create real p2p sub | ROOT `{set}` / `{sub}` | yes |
| **Rating** | post-chat score → `users.rating_*` | — | no |
| **Search by #ID** | companion API lookup → friend request | ROOT p2p `{sub}` | no |
| **Ban** | `{acc state:"susp"}`; temp bans timed by companion | `changeUserState` | no |
| **Mute** | remove `W` right; timed by companion | ROOT `{set}` acs | no |
| **Reports** | companion `reports` table (Tinode has no concept) | — | no |
| **view-once** | flag + ROOT delete after first read | `{del}` | later |
| **Realtime events** | companion `/ws` (match/request/reveal/ban) | — | no |

**Anonymity = variant E (small server patch), separate task (A1).** ~3-4 points:
`prepareBroadcastableMessage` (topic.go:279, null `Data.From`/`Info.From`),
`replyGetData` (topic.go:2794, history From), `replyGetSub` (topic.go:2633/2693,
peer UID/Public/Trusted); presence off via missing `P` bit. Companion supplies
the online dot. This plan does not block on A1; every non-anon feature above
works against stock Tinode today.

---

## 5. Data store

One `anoon` database in the existing `postgres:16` container, separate from
Tinode's `tinode` DB. Schema `0001_init.sql`: `users` (+ `hash_id_seq`),
`friendships`, `reports`, `roulette_queue`, `subscriptions`. Source of truth for
the friend graph is **Tinode p2p subscriptions**; `friendships` only indexes
requests/search. Migrations run on every startup. Redis deferred (Q5b) — Postgres
+ in-process memory is enough at launch scale.

> Prereq: the `anoon` database must be created (compose init script or a one-off
> `CREATE DATABASE anoon;`). Companion runs its own table migrations after that.

---

## 6. Build order (phased)

- **A2 — scaffold + first slice (DONE / in progress).** Compiles, connects,
  migrates, `/health`. **First end-to-end slice implemented:** `POST /auth/register`
  → ROOT `{acc}` creates a Tinode account → allocate next #ID → persist mapping →
  return `#00001`. Unit test on the #ID formatter; `go build`/`vet`/`test` green.
  *Remaining to fully close A2:* run the slice against the live stack (needs the
  `anoon` DB + a `--make_root` bot account) and add an integration test.
- **A3 — auth (IMPLEMENTED this run, live-verify pending).** See §8 below.
- **A4 — roulette (IMPLEMENTED this run).** In-memory matcher + Postgres match
  records, softening, priority hook (stub), anti-abuse, match → anon topic,
  `matched` WS event, end + rating. See §9. Full HTTP path needs the live ROOT
  stack; the matcher logic is unit-tested and the store flow has an integration
  test (`internal/integration`, DB-only).
- **A5 — reveal → friends (IMPLEMENTED this run).** Mutual-accept reveal flips
  the anon flag (history intact), marks the pair friends; friends list / request
  / respond / search by #ID; p2p chat on accept. See §9. QR invite is later.
- **A6 — moderation.** Reports + ban/mute + admin-facing data reads.
- **A7 — view-once + realtime event fan-out on `/ws`.**
- **(separate roadmap phases)** frontend wiring (`frontend`), push, prod deploy.

---

## 8. Auth (A3) — as implemented

Two paths, both issuing the #ID on first account creation:

**Email / password = Tinode built-in `basic`.** `POST /auth/register` (A2) creates
the account via ROOT `{acc}` and allocates the #ID; the frontend then logs into
Tinode directly with scheme `basic`. Email verification uses Tinode's built-in
credential validator — **SMTP is stubbed this run** (no real mail; enable a
provider before prod). No companion code sits in the basic login path.

**Google = Tinode's `rest` auth scheme, brokered by companion.** Flow:

1. Frontend Google sign-in → Google **ID token**.
2. `POST /auth/oauth/google {idToken, gender, age}` — companion verifies the
   token (`internal/oauth`, via Google's tokeninfo endpoint; checks `aud` =
   `COMPANION_GOOGLE_CLIENT_ID`, issuer, expiry). Returning user → `{status:
   "existing", hashId, ...}`. New user → validates gender/age, stores a
   **pending_registration** keyed by the Google `sub`, returns `{status:
   "registered_pending"}`. Either way the client proceeds to step 3.
3. Frontend logs into **Tinode** with `{login scheme:"rest" secret:<idToken>}`.
4. Tinode's rest authenticator POSTs companion **`POST /auth/rest`** (implemented
   in `internal/api/rest.go`, exact contract from `server/server/auth/rest/
   auth_rest.go`). Endpoints handled: `auth` (verify token → return uid, or
   uid-zero + `newacc` to auto-create), `link` (after creation: consume the
   pending row, allocate #ID, store `oauth_identities` mapping), `checkunique`,
   `del`, and no-op `add/upd/gen/rtagns`. Uid is converted between the rest bare
   base64 form and our internal `usr…` form at this boundary.
5. **Tinode mints the login token** on that rest login and returns it to the
   frontend. (The broker does not mint tokens — Tinode owns `AUTH_TOKEN_KEY`.)

**Tinode config required** (orchestrator wires this into the Tinode `.conf`,
`auth_config.rest` block — a config change, not a source patch):

```json
"rest": {
  "server_url": "http://companion:8080/auth/rest",
  "allow_new_accounts": true,
  "use_separate_endpoints": false
}
```
and add `"rest"` to the enabled `auth_config.logical_names` / schemes.

**New config:** `COMPANION_GOOGLE_CLIENT_ID` (empty disables Google sign-in;
the rest endpoints then answer `err:"unsupported"`).

**Left for live-verify:** exercise a real Google token end-to-end against the
running stack (needs the Tinode rest block above + a real OAuth client id);
Apple/Facebook and real SMTP are later. The `/auth/rest` wire contract is coded
to source but has only been unit-covered on the token-verifier so far.

## 9. Roulette + Friends (A4/A5) — as implemented

### FROZEN API CONTRACT (the frontend builds against these exact shapes)

All REST calls are authenticated as the current user (see "Auth of callers"
below). Bodies/responses are JSON.

REST:
- `POST /roulette/enqueue` `{ ownAgeRange: "18-21"|"22-25"|"26-35"|"36+", peerAgeRanges: string[] }` → `{ queued: true }`
- `POST /roulette/cancel` → `{ ok: true }`
- `POST /roulette/end` `{ topic }` → `{ ok: true }`
- `POST /roulette/rate` `{ topic, rating: 1..5 }` → `{ ok: true }` (rates the peer)
- `POST /roulette/reveal` `{ topic }` → `{ ok: true }`
- `POST /roulette/reveal/respond` `{ topic, accept: bool }` → `{ ok: true }`
- `GET  /friends` → `{ friends: [{ hashId, displayName, topic, online, lastActiveAt }] }`
- `POST /friends/request` `{ hashId }` → `{ ok: true }`
- `POST /friends/respond` `{ hashId, accept: bool }` → `{ ok: true }`
- `GET  /friends/search?q=<#ID>` → `{ results: [{ hashId, displayName }] }`

WS events (companion → client), JSON `{ type, ... }` on `/ws`:
- `{ type:"matched", topic, peerHashId, peerAgeRange }`
- `{ type:"reveal_request", topic, fromHashId }`
- `{ type:"revealed", topic, peerHashId, peerDisplayName }`
- `{ type:"friend_request", fromHashId, displayName }`

Notes: `hashId`/`fromHashId`/`peerHashId` are the display form `"#00042"`.
`displayName` == the `#ID` (no nicknames — search is by #ID only). A friend's
`topic` is the peer's Tinode UID (the p2p topic). `online` is companion-tracked
(WS presence), which is the anon-phase online dot. `lastActiveAt` is currently
always null (activity tracking is a later slice). **Do not rename fields without
noting it here — the frontend agent depends on this shape.**

### How it works
- **Matcher** (`internal/matchmaker`): pure, unit-tested engine. Gender is
  auto-opposite; own age required, peer ages optional multi-select; both sides'
  age filter must hold; after `softenAfter` (45s) a waiter relaxes to
  gender-only. Priority (paid tiers) sorts the scan — currently everyone is Free
  (`store.Priority` stub). Anti-abuse: one entry per user, no self-match, and a
  per-entry Exclude set seeded from `roulette_matches` (recent partners, 2h) so
  the same pair isn't rematched back-to-back.
- **Match loop** (`api.RunMatchLoop`): drains the matcher each second (and on
  enqueue nudge); each pair → `Tinode.CreateAnonTopic` → `roulette_matches` row
  → `matched` event to both. On a Tinode error the pair is re-queued.
- **Anon topic invariant** (`tinode.CreateAnonTopic`): ROOT owns the group topic
  (neither user, so neither holds owner→P rights); both are added with mode
  `JRWS` — **no `P` bit** (per `server/ANON-PATCH.md`, granting P would leak the
  real UID via presence). `aux["anon"]=true` set via ROOT `{set}`.
- **Reveal** (`AcceptReveal` + `Tinode.Reveal`): two-step mutual handshake
  tracked in `roulette_matches.reveal_by`/`status`; on mutual accept the anon
  flag is cleared (`aux["anon"]=false`, history intact) and the pair is marked
  friends (`source='reveal'`); `revealed` emitted to both.
- **Friends** (`internal/store/friends.go`): directed request rows in
  `friendships`; accept makes both directions `accepted` and opens the Tinode
  p2p chat (`Tinode.CreateP2P`, ROOT on_behalf_of). Search/request by exact #ID.

### Auth of callers
REST/WS callers present the Tinode login token they already hold as
`Authorization: Bearer <token>` (or `?token=` for `/ws`). The companion resolves
it to a UID via a throwaway Tinode `{login scheme:"token"}`
(`Tinode.ResolveToken`) and maps UID→user. Dev shortcut: with
`COMPANION_DEV_AUTH=1`, headers `X-Anoon-Uid` / `X-Anoon-Hash-Id` are accepted
directly (never enable in prod).

## 7. Next slice to build

- **Live-verify the roulette path** against the running stack (needs the ROOT
  bot connected + the A1 anon patch built into the Tinode image): two accounts,
  enqueue both, assert `matched` + a real anon `grp` topic with no `P` bit, then
  reveal and assert identities flow. Extend `internal/integration` with this
  once the stack is up (the DB-only reveal/friends flow is already tested there).
- **Moderation (A6)**: reports + ban/mute (see §4). Then view-once + richer WS.
