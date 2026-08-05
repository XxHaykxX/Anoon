# Anoon (Tinode) — Design Direction

**Status: ACTIVE. This supersedes the old anoon `DESIGN-SYSTEM.md` for the Anoon/Tinode app.**

## Decision (2026-07-03)
The Anoon/anoon app's target design has **changed**. It is no longer the anoon heavy-yellow
dark-only look (yellow bubbles everywhere). The new target is the **cloned minimal messenger design**
built in `C:\Users\Admin\Desktop\anoon\frontend` (a clean Telegram-style minimal-monochrome concept),
with:

- **Primary = brand yellow `#FDBF2D`** used as ACCENT only (active tab, selected row, unread badge,
  primary CTA, links, read-tick, own-message bubble). NOT yellow everywhere.
- **Incoming bubbles = neutral gray** (`--bubble-in`), own bubbles = yellow/black.
- **Both light AND dark themes** (with a switch) — the current dark-only lock is removed.
- Minimal, high-whitespace, thin outline icons, circular avatars, pill inputs, ~16-18px bubble radius.

**Scope:** full replace of the current Tinode look with the clone's style. Light + dark.

## How we work
1. **Finish the clone first** (in `frontend`) as the visual etalon — fastest way to nail the design
   in a clean Next.js/Tailwind env.
2. **Then port** the finalized token system + component styles into the real Tinode webapp
   (`Desktop/anoon/webapp`, plain CSS in `css/base.css`) — one clean pass, keeping the working
   WebSocket/chat backend untouched.
3. Deploy to the running container (`docker cp` / rebuild `tinode-anoon` image), as before.

## Source of truth
- Design tokens + screens: `frontend/src/app/globals.css` + `frontend/src/components/screens/*`.
- Remaining clone work + port checklist: `TODO.md` (this directory).
- Deferred features: `BACKLOG.md` (this directory).

## Clone status (design etalon)
DONE: tokens (light+dark, yellow primary), icons, screens — Login, Chats, Chat, Contacts, Account, Desktop; assembly page; `npm run build` ✓.
REMAINING to clone: real swipe gesture, animations (typing dots, transitions), music player, onboarding
carousel, contacts-as-bottom-sheet, micro-details, side-by-side QA vs reference images. See `TODO.md`.

## Port to Tinode — NOT started yet
Once the clone is final, restyle Tinode `webapp/css/base.css`:
- Remap `--clr-*` tokens to the clone palette (light+dark via `light-dark()`), re-enable light theme
  (revert `DEFAULT_COLOR_SCHEME='dark'` to allow both; keep default matching preference).
- Match component styling per screen (list rows, bubbles gray-in/yellow-out, composer, settings,
  bottom nav for mobile).
- Reuse the safe deploy flow (backup `static.orig.tar`, `docker cp`, cache-bust bump, network-first SW).
