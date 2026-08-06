# Authorization sweep — companion `internal/api` + the store behind it

Read-only sweep, 2026-08-06. Nothing was changed.

**Question asked of every handler:** what does the caller name, what authorises them to
act on it, and does the WHERE clause of the resulting query match the thing that was
authorised — neither wider nor narrower.

**Out of scope:** H1, H2, M1–M4, L1–L4 (fixed in this wave), `frontend/`, `admin/`.

**Result:** 7 findings. Two are the same class as L3 and one of them (S1) reopens the
harm L3 just closed, through a different door. Nothing found is remotely exploitable
without an authenticated account. No SQL injection anywhere; every value is a `$N`
parameter.

---

## Ranked findings

### S1 — `/push/subscribe` lets any user take ownership of anyone's push endpoint — MEDIUM

- **Where:** `internal/store/push.go:20-31` (`SavePushSubscription`), reached from
  `internal/api/push.go:28` (`handlePushSubscribe`).
- **Caller controls:** `endpoint`, `keys.p256dh`, `keys.auth` — the whole row.
- **The mis-scope:** `push_subscriptions.endpoint` is `UNIQUE`
  (`migrations/0006_push.sql:11`) and the insert is
  `ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = ..., auth = ...`.
  The conflict target is the endpoint alone, so the update is authorised by *possession
  of the endpoint string*, not by owning the row. Posting a victim's endpoint re-points
  their subscription at the attacker's `user_id`.
- **Attack:** identical premise to L3 — learn a victim's endpoint — then
  `POST /push/subscribe {endpoint: <victim's>, keys: {...anything...}}`. The victim's
  row now belongs to the attacker, so `PushSubscriptionsFor(victim)` returns nothing and
  **the victim silently stops receiving all notifications**. That is exactly the harm L3
  described; the L3 fix closed `/push/unsubscribe` and left this path open.
  Secondary: the attacker's own pushes (e.g. `POST /push/test`) are now addressed to the
  victim's device. They are encrypted to attacker-supplied keys the victim's service
  worker cannot decrypt, so this is a nuisance (browser-generic "site updated in the
  background" notifications), not content injection.
- **Tension worth deciding, not just patching:** the re-point is load-bearing for a
  shared browser — a push subscription belongs to the browser/service worker, not the
  account, so when user B logs in on a device where A was subscribed, B legitimately
  presents the same endpoint. A blanket `WHERE push_subscriptions.user_id = EXCLUDED.user_id`
  guard fixes the attack but silently breaks push for B forever. `endpoint UNIQUE` means
  a second row cannot exist either.
- **Fix (one sentence):** require proof of possession before re-pointing — only take over
  an existing endpoint when the presented `p256dh`/`auth` match the stored pair (a
  genuine re-subscribe from the same device knows them; an attacker who only scraped the
  endpoint does not) — and drop the `UNIQUE` constraint in favour of
  `UNIQUE (user_id, endpoint)` if the shared-device case must also survive a key rotation.

### S2 — WebRTC call signaling accepts any `#ID`, with no relationship check — MEDIUM

- **Where:** `internal/api/callsignal.go:282-295` (`resolveRelayTarget`, `#ID` branch →
  `resolveHashID` → `UserByHashID`), reached from `relayCallSignal` at
  `internal/api/callsignal.go:300` via the `/ws` frame dispatcher.
- **Caller controls:** the `to` field of a `call:offer` frame — any `#ID` in the system.
- **The mis-scope:** the alias branch directly above it is carefully scoped (`MatchByPeerAlias`
  resolves only within the caller's own match, and only against the *other* member's
  alias — verified correct). The `#ID` branch has no scoping at all: it resolves globally.
  The doc comment states the `#ID` form "is only usable for people whose identity the
  sender legitimately holds: friends and revealed peers" — but that is an assumption
  about who *knows* a `#ID`, not a check. Nothing verifies friendship or match membership
  before the peer's device rings.
- **Attack:** `#ID`s are allocated `nextval('hash_id_seq')` (`store/users.go`, `CreateUser`)
  — strictly sequential five-digit numbers. An authenticated attacker walks `#00001`
  upward sending `call:offer` and rings every account in the system in order; each target
  gets an incoming-call UI from a stranger. Also survives blocking (see S4): a blocked
  user can still ring the person who blocked them.
- **Fix:** in the `#ID` branch, require an accepted friendship or a shared match
  (`AreFriends` / `MatchByTopic`) before relaying, mirroring what `relayTopicPeer`
  already does for topic-addressed frames — the rule exists two functions away.

### S3 — `/roulette/rate` can be replayed without limit, forever — MEDIUM-LOW

- **Where:** `internal/api/roulette.go:253-276` (`handleRate`) →
  `internal/store/roulette.go:373` (`AddRating`).
- **Caller controls:** `topic` and `rating`, and how many times they send it.
- **The mis-scope:** membership *is* checked (`MatchByTopic` + `m.Has`), so the
  authorisation is right — but it authorises "you were in this chat", while the action
  performed is an unbounded `rating_sum = rating_sum + $2, rating_count = rating_count + 1`.
  There is no per-match rating ledger, no uniqueness constraint, and no status check, so:
  one member can rate the same peer thousands of times, and can do it for a match that
  ended weeks ago (`MatchByTopic` has no status filter — deliberately, and correctly, for
  the reporting path). The route is also not behind `rateLimited` (`router.go:180`).
- **Attack:** any past roulette peer can drive a victim's average to 1.0 (or their own
  peer's to 5.0) with a loop. Cost: one authenticated request per increment.
- **Honest blast radius today:** nothing reads the average. `rating_sum`/`rating_count`
  are written here and never selected — not by the matchmaker, not by the admin
  `ProfileRow`. So this is currently inert; it becomes live the moment any ranking,
  filtering or display starts consuming it, and the poisoned totals will already be there.
- **Fix:** record ratings in a per-(match, rater) row with a unique constraint and derive
  the average from it, so a re-rate updates rather than accumulates; add the route to the
  limiter.

### S4 — blocking is enforced only in matchmaking — LOW

- **Where:** `store.BlockedUserIDs` has exactly one caller: `internal/api/roulette.go:92`
  (`handleEnqueue`). Confirmed by grep across `internal/api/`.
- **The mis-scope:** `POST /friends/block` and `/roulette/block` present themselves to the
  user as "block this person". What they actually buy is "never be re-paired by the
  roulette". Every other path a blocked person can reach their blocker on is unguarded:
  - `POST /friends/request` (`internal/api/friends.go:54`) — a blocked user can still send
    friend requests, and each one fires a `friend_request` WS event **and a Web Push** at
    the person who blocked them (`friends.go:87`). `CreateFriendRequest` upserts on
    `(user_id, friend_id)`, and the block row is the *other* direction, so nothing collides.
  - `call:*` and `activity` relays (S2).
- **Attack:** block your harasser; they keep push-notifying your phone at will.
- **Fix:** consult `BlockedUserIDs` (or a directed "is blocked by" check) in
  `handleFriendRequest` and in the relay target resolution, not only at enqueue.

### S5 — an anon alias keeps working after the match is over — LOW

- **Where:** `internal/store/roulette.go:191` (`MatchByPeerAlias`) — correctly scoped to
  the viewer's own match, but with no status filter and `ORDER BY id DESC LIMIT 1`;
  consumed by `resolveRelayTarget` (`callsignal.go:283`), which also does not check status.
- **The mis-scope:** the authorisation is "we are/were paired"; the action is "ring their
  phone now". An ended anon chat leaves the alias permanently resolvable, so a former
  roulette peer can call the other side indefinitely, long after both left. They cannot
  learn the `#ID` (H2 holds — `peerFacingHandle` still returns the alias), so this is
  contact-without-consent, not an identity leak.
- **Adjacent to H2 but not part of it** — H2 was about what the alias *reveals*; this is
  about how long it stays *usable*. Flagging rather than assuming it was considered.
- **Fix:** require `status = 'active'` (or `'revealed'`) when resolving an alias for a
  live relay; reporting paths that legitimately need ended matches should keep using
  `MatchByTopic`.

### S6 — email verification marks the user, not the address it was issued for — LOW (latent)

- **Where:** `internal/api/auth_recovery.go:226` → `internal/store/auth_tokens.go:145`
  (`SetEmailVerified`).
- **The mis-scope:** `CreateAuthToken` records the address the token was mailed to
  (`auth_tokens.email`), but redemption throws it away and sets `email_verified = true`
  on the user's *current* `users.email`. The token authorises one address; the write
  trusts whatever address the row holds at redemption time.
- **Not exploitable today:** there is no change-email endpoint in `router.go`, and
  `SetBasicCredentials` runs only at registration, so the address cannot change between
  issue and redemption. It becomes a real "verify an address you don't control" bug the
  day an email-change endpoint lands.
- **Fix:** verify against `auth_tokens.email` — only set the flag when it still equals
  `users.email`, and store which address was verified.

### S7 — `UserByID` does not exclude soft-deleted accounts — INFORMATIONAL

- **Where:** `internal/store/users.go:86`, versus `UserByHashID:71` and
  `UserByTinodeUID:106`, which both filter `deleted_at IS NULL`.
- **Why it is only informational:** `DeleteUser` ends the user's active matches, so the
  paths that call `UserByID` with a peer id (`handleRouletteStatus:169`,
  `emitRevealed:351`, `onMatch:402`) should not encounter one. It is a consistency gap
  that could quietly resurrect a deleted account into a reveal or status payload if any
  future caller reaches it by a different route.
- **Fix:** add the `deleted_at IS NULL` filter, or rename it to make the difference loud.

---

## Coverage — every route, with a verdict

So nobody re-reads these next month wondering whether they were checked.

| Route | Handler | Verdict |
|---|---|---|
| `GET /health` | `handleHealth` | Clean — status only, no caller input. |
| `POST /auth/login` | `stub` | Clean — 501, no implementation. |
| `POST /auth/register` | `handleRegister` | Clean — public by design; Tinode enforces login uniqueness; orphan compensation on failure. |
| `POST /auth/oauth/google` | `handleOAuthGoogle` | Clean — subject comes from a Google-verified token, never from the body. |
| `POST /auth/rest` | `handleAuthRest` | Out of scope (H1). |
| `POST /auth/forgot` | `handleForgotPassword` | Clean — uniform 200, no existence oracle; 256-bit token. |
| `POST /auth/reset` | `handleResetPassword` | Clean — user id comes from the consumed token row, never the request; single-use via atomic `UPDATE...RETURNING`. |
| `POST /auth/verify-email/send` | `handleVerifyEmailSend` | Clean — issues only for the caller's own address. |
| `POST /auth/verify-email/confirm` | `handleVerifyEmailConfirm` | **S6** — token→user is right; token→address is not checked. |
| `POST /roulette/enqueue` | `handleEnqueue` | Clean — acts only on the caller; ban/mute gate; block set merged into the exclude set. |
| `POST /roulette/cancel` | `handleCancel` | Clean — cancels the caller's own queue entry only. |
| `GET /roulette/status` | `handleRouletteStatus` | Clean — read-only, resolves the caller's own match; peer named by alias. |
| `POST /roulette/end` | `handleEnd` | Clean — `MatchByTopic` + `m.Has`. |
| `POST /roulette/rate` | `handleRate` | **S3** — membership checked, repetition and match status not. |
| `POST /roulette/reveal` | `handleReveal` | Clean — `RequestReveal` re-checks `m.Has` in the store. |
| `POST /roulette/reveal/respond` | `handleRevealRespond` | Clean — `AcceptReveal` requires membership *and* a pending request from the other member; self-reveal impossible. |
| `POST /roulette/block` | `handleBlock` | Clean as written — topic path checks `m.Has`; `#ID` path blocks by public id, which is the caller's own list. (Its *effect* is narrower than users expect — S4.) |
| `GET /friends` | `handleFriendsList` | Clean — caller's own accepted friends. |
| `POST /friends/request` | `handleFriendRequest` | **S4** — no block check; request + push reach someone who blocked you. |
| `POST /friends/respond` | `handleFriendRespond` | Clean — store verifies a pending `from → me` row exists; idempotent accept is deliberate. |
| `GET /friends/search` | `handleFriendSearch` | Clean — exact `#ID` only, relation resolved from the caller's perspective, rate-limited. |
| `GET /friends/blocks` | `handleFriendBlocksList` | Clean — caller's own directed rows. |
| `POST /friends/block` | `handleFriendBlock` | Clean — see `/roulette/block`. |
| `DELETE /friends/block/{hashId}` | `handleFriendUnblock` | Clean — deletes only the caller's own directed `blocked` row; the reverse block survives. |
| `GET /me` | `handleMe` | Clean — caller's own row. |
| `DELETE /me` | `handleDeleteMe` | Clean — self only; every cleanup statement is `$1`-scoped to the caller; idempotent under `FOR UPDATE`. |
| `GET /push/vapid` | `handlePushVAPID` | Clean — public key, public by design. |
| `POST /push/subscribe` | `handlePushSubscribe` | **S1** — upsert keyed on endpoint alone re-points ownership. |
| `POST /push/unsubscribe` | `handlePushUnsubscribe` | Fixed this wave (L3) — now `endpoint = $1 AND user_id = $2`. |
| `POST /push/test` | `handlePushTest` | Clean in itself — sends only to the caller's own subscriptions (but see S1 for whose device those are). |
| `POST /reports` | `handleCreateReport` | Fixed this wave (L1) — participation gate on escalation, topic-based target resolution. |
| `POST /media` | `handleCreateMediaAsset` | Fixed this wave (L2) — participation gate + URL allowlist. Rate limit still owed by the `router.go` owner. |
| `GET /admin/*` (11 routes) | `admin.go` | Out of scope (M3, and the two unguarded GETs are already task #19). Within the admin boundary, acting on any user id is the intended authority. |
| `GET /ws` (upgrade) | `handleWS` | Clean — authenticated before upgrade; origin gate is M4, done. |
| `/ws` frame `call:*` | `relayCallSignal` | **S2** (`#ID` target unscoped), **S5** (alias outlives the match). Alias branch itself is correctly scoped. |
| `/ws` frame `msg:del` | `relayMsgDel` | Clean — `relayTopicPeer` enforces match membership (grp) or accepted friendship (p2p); `from` is server-stamped. |
| `/ws` frame `peer:leaving` | `relayPeerLeave` | Clean — `MatchByTopic` + `m.Has`; `from` server-stamped via `peerFacingHandle`. |
| `/ws` frame `activity` | `relayActivity` | Inherits **S2** on its `to` branch; the `topic` branch is clean (`relayTopicPeer`). |
| ROOT `{data}` stream | `onTinodeData` | Clean — not caller-facing; membership derived from the match server-side, recipient is `m.Peer(sender)`. |

### Store methods behind the above

Checked for WHERE-clause scope against the authorisation that reaches them.

- **Correctly scoped:** `EndMatch`, `EndActiveMatchesForUser`, `RequestReveal`,
  `AcceptReveal` (re-checks membership in the store, not just the handler),
  `MatchByPeerAlias` (viewer's own match, other member's alias — verified, not assumed),
  `BlockUser`/`UnblockUser`/`BlockedList`/`BlockedUserIDs`, `Relations`/`AreFriends`,
  `CreateFriendRequest`, `RespondFriendRequest`, `DeleteUser`, `ConsumeAuthToken`,
  `PushSubscriptionsFor`, `DeletePushSubscriptionOf` (L3 fix),
  `EscalateMediaByTopicOwner` (L1 fix).
- **Deliberately unscoped, correctly so:** `DeletePushSubscription` (stale-subscription
  sweep, endpoint comes from our own table), `EscalateMediaByTopic` (grp topics are shared
  and unique to the pairing), all `/admin` list/patch methods (admin authority is the
  boundary), `orderClause` (column names from a closed allowlist, unknown sort falls to a
  default — re-verified, still healthy).
- **Scope mismatches:** `SavePushSubscription` (S1), `AddRating` (S3),
  `SetEmailVerified` (S6), `UserByID` (S7).

### Per-user topic naming — the trap that hid the L1 bug

Re-checked every remaining place a topic string is used as if it identified a
conversation, since `usrB` names *every* chat anyone has with B:

- `relayTopicPeer` — handles it correctly and explicitly (rewrites the outbound topic
  into the recipient's perspective).
- `EscalateMediaByTopic` — was wrong, fixed this wave (L1).
- `CreateMediaAsset` — stores the sender's own name for the topic; only ever read back
  per-owner or in the admin gallery, so no cross-conversation matching happens.
- `reports.topic` — free-text context for a moderator, never used as a join key.
- `onTinodeData` — `grp` only, guarded by a `strings.HasPrefix` check.

No further instances found.

---

## Suggested order

1. **S1** — reopens L3's harm; the wave is otherwise closing that door.
2. **S2** — sequential `#ID`s make it trivially enumerable, and it rings real phones.
3. **S4** — cheap to fix, and it is what users think "block" already does.
4. **S3** — poisons data now, bites when something starts reading the average.
5. **S5** — decide alongside the rest of H2's alias lifetime.
6. **S6**, **S7** — latent; fix when the adjacent feature lands.
