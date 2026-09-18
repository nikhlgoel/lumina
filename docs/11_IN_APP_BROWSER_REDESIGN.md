# In-App Browser — Redesign Spec (for implementation)

**Status:** planning doc (to be implemented on the browser workday). Nothing here is built yet.
**Files in scope:** `src/renderer/src/views/browser/BrowserView.tsx` (toolbar/renderer), `src/main/browser.ts`
(the `WebContentsView` + start page + link handling), `src/shared/ipc.ts` / `src/main/ipc.ts` (new channels).
**Related:** content-blocking + safety is a separate deep doc — [12_SAFE_BROWSING_AND_CONTENT_BLOCKING.md](12_SAFE_BROWSING_AND_CONTENT_BLOCKING.md).

---

## 1. What's there today (ground truth)

- `BrowserView.tsx` renders a title-bar-height toolbar: **Back · Forward · Reload/Stop · address bar**. That's all —
  no Downloads, Extensions, Menu, or Bookmark controls. The native `WebContentsView` is laid over the frame below.
- `browser.ts` shows a minimal data-URL **start page** (Lumina wordmark + one search box) and hides `data:` URLs in
  the address bar. `setWindowOpenHandler` currently **loads any `http(s)` `window.open` target in the same view**
  (this is a redirect/pop-under vector — see the safety doc). `will-download` is handed to Lumina's engine.

**User feedback:** "the browser has no buttons, just the search bar; extensions/downloads and the top menu button
aren't visible; it feels uselessly heavy and left out from the app's simplistic design; make it pick up links too."

Two things are true at once: (a) the toolbar is too **bare** (missing the controls a browser needs), and (b) it
still feels **heavy** because it's a full title-bar-height slab with a plain full-width input. The redesign makes it
lighter *and* adds the missing, purposeful controls — no clutter.

---

## 2. Design goals

1. **Lighter, on-brand.** Match the app's toolbars (`h-9` controls, `rounded-lg`, hairline borders, one accent,
   tactile hover/active). No heavy slab. See `~/.claude/rules/design-taste.md` and `docs/02_UI_UX_...`.
2. **All the essential controls, visible but quiet:** Bookmark (star), Downloads, Extensions/Shield, Menu (⋮).
3. **"Picks up links."** The browser should actively help start downloads (that's Lumina's whole point), not just
   render pages. Three behaviours (§4).
4. **Room to grow** to multi-tab (Phase-2 "GOAT edition") without another redesign.

---

## 3. Toolbar layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ‹  ›  ⟳   [ 🔒 example.com ································· ]  ★  ⭳²  🧩  ⋮      │
└──────────────────────────────────────────────────────────────────────────────┘
   nav       address / omnibox (flex-1)                     star DL ext menu
```

- **Left cluster:** Back, Forward, Reload/Stop (keep, they're fine) — slightly smaller, ghost style.
- **Omnibox (address bar):** stays `flex-1` but lighter — thinner border, `bg-sunken`, lock/globe leading icon,
  and a **trailing affordance** when the text is a downloadable link (§4a). Placeholder: "Search or type a link".
- **Right cluster (new), all `size-8` ghost icon-buttons with `title=`):**
  - **★ Bookmark** — toggles a bookmark for the current page via the existing `bookmarks:add` / `bookmarks:remove`
    IPC (this reuses the store built for Sync — bookmarks sync across devices for free). Filled/accent when saved.
  - **⭳ Downloads** — badge = active job count (`useJobs`); click opens a small popover of the most recent captured
    downloads with progress, plus "Open Queue". Makes auto-capture *visible* (right now downloads vanish into the
    Queue tab with no browser-side feedback).
  - **🧩 Extensions / Shield** — popover: the browser extension pairing status, and the **content-blocking toggle**
    (global + "disable on this site") with a blocked-count badge (see safety doc). This is where the shield lives.
  - **⋮ Menu** — overflow: Find in page · Zoom · Bookmarks… · Clear browsing data · Safe-browsing on/off ·
    Open in system browser · About. Keeps the toolbar uncluttered while making everything reachable.
- **Optional bookmarks strip** (toggle in ⋮): a thin row under the toolbar with saved bookmarks (from the store),
  drag-to-reorder later. Off by default to stay minimal.

**Weight reduction specifics:** drop the full title-bar-height treatment for the control row (use `h-11` content +
the drag strip separately), single hairline `border-line`, `bg-panel`; icons `text-ink-2`; the omnibox is the only
filled element. Motion: `active:scale-[0.98]`, `transition-colors duration-150`.

---

## 4. "Picks up links" — the three behaviours

**(a) Smart omnibox.** When the current omnibox text (typed, pasted, or dropped) parses as a media/file URL
(reuse `core/url.ts` `classifyUrl`/`cleanUrl` and `core/mediaKind`), show an inline **"Download"** button inside the
omnibox. Enter on a plain query → search; Enter on a link → navigate; the Download button → `media:inspect` →
existing add-download flow. Also accept **drag-and-drop** of a link onto the toolbar.

**(b) Grab links on this page.** A toolbar/menu action **"Grab download links"** that injects a collector script into
the page (via `webContents.executeJavaScript`) to gather `<a href>` + media sources, dedupe, and open the existing
**batch add** UI (`core/batch.ts`). This is the in-app twin of the shipped extension action
"Send all download links on this page to Lumina" (commit f291347) — reuse that logic.

**(c) Visible auto-capture.** `will-download` already routes to Lumina. Surface it: when a download is captured,
flash the **⭳ Downloads** button + a toast, so the user sees the hand-off happen.

New IPC needed: `browser:current` (url+title for the star), `browser:grab-links` (returns collected links),
`browser:page-can-bookmark`/state already covers url. Bookmarks IPC already exists.

---

## 5. Start page

Keep the minimal start page, but make it *useful*: under the search box, show **recent bookmarks** (from the store)
and optionally recent downloads as quiet chips. Still no ads/widgets — matches the "minimal extras" ask.

---

## 6. Multi-tab (later, Phase 2)

Not now, but the toolbar should reserve a tab strip slot above the control row so adding tabs later is additive.
Each tab = its own `WebContentsView` on the `persist:browser` session; the shield/blocking applies per-session.

---

## 7. Implementation order (browser workday)

1. Rebuild the toolbar (lighter styling + right cluster: Bookmark, Downloads, Extensions/Shield, Menu). Wire
   Bookmark to the existing bookmarks IPC; Downloads to `useJobs`.
2. Smart omnibox (link detection + inline Download + drag-drop).
3. "Grab download links" (reuse the extension collector + batch UI).
4. Menu actions (find/zoom/clear-data/open-external/safe-browsing toggle).
5. Start-page recent bookmarks.
6. (Shield/blocking behaviours come from doc 12; the Extensions popover just exposes their toggles.)

**Verification:** tsc + build + a screenshot-capture step for the new toolbar (`src/main/capture.ts`), then the
user's visual pass (the native browser view isn't captured by the harness, but the toolbar is renderer DOM).
