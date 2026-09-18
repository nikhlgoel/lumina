# Safe Browsing & Content Blocking — Deep Analysis (for implementation)

**Status:** planning/analysis doc (to be implemented on the browser workday). Nothing here is built yet.
**Scope:** the user-facing in-app browser (`persist:browser` session in `src/main/browser.ts`) and downloaded-file
safety. Complements the toolbar redesign in [11_IN_APP_BROWSER_REDESIGN.md](11_IN_APP_BROWSER_REDESIGN.md).

> **Honesty up front (project HARD RULE 5).** "Totally prevented" is not achievable — no browser, including Brave
> or uBlock Origin, blocks 100%. What *is* achievable and is the honest target:
> - **~99% of ad/tracker network requests** blocked via real filter lists.
> - **Pop-ups, pop-unders, tab-unders and forced redirects neutralised** by policy (not just filtered).
> - **Known malware/phishing URLs** blocked via threat feeds (misses zero-day and brand-new domains).
> - **Risky downloads flagged** (Mark-of-the-Web, dangerous file types, hash reputation) — but a novel malware
>   payload or a social-engineering install the user consciously runs **cannot** be fully prevented.
> The UI must never claim "you are 100% safe." It should say what's blocked and let the user see/adjust it.

> **Boundary vs the anti-bot rule.** This is content **blocking** and threat **avoidance** — all legitimate and
> already partly shipped (HANDOVER §3 explicitly allows ad/pop-up/redirect blocking). It must introduce **nothing**
> that evades bot-detection / Cloudflare / captcha (still forbidden). Ad/malware blocking ≠ automation cloaking.

---

## 1. Ground truth: what exists today

- **Hidden file-host download pages** (`src/main/hosters.ts`) are hardened: a hand-rolled `AD_HOSTS` regex cancels
  requests to ~40 known malvertising/pop-under networks in `onBeforeRequest`, `setWindowOpenHandler` denies popups,
  and permission requests are auto-denied. Good — but **narrow** (a fixed regex) and **only for those windows**.
- **The in-app browser the user actually browses with (`browser.ts`, `persist:browser`) has NONE of this.** No
  request filtering, no cosmetic filtering, no safe-browsing, no permission policy, and `window.open` is followed
  in-place (a redirect vector). This is why "adblock is always an issue" — the real browser is unprotected today.

**So step 1 is simply: bring real, list-based protection to `persist:browser`, and exceed the download-page setup.**

---

## 2. Threat model (what we're defending against)

| Class | Examples | Primary defense |
|---|---|---|
| Ads & trackers | banners, video ads, analytics, fingerprinters | network filter engine (EasyList/EasyPrivacy) |
| Malvertising | ad networks serving exploit/redirect chains | filter engine + malware domain feeds |
| Pop-ups / pop-unders / tab-unders | `window.open`, `noopener` tab-unders | window-open policy + filters |
| Forced/auto redirects | JS `location=`, meta-refresh, redirect chains | navigation guards + filters |
| Notification / permission spam | Web Notifications, geolocation, camera | permission handler denies by default |
| Cryptojacking | in-page coin miners | filter lists (miner rules) + CPU heuristic |
| Phishing | fake login pages | Safe Browsing / PhishTank lookup + interstitial |
| Drive-by / malware URLs | exploit kits, malware hosts | URLhaus + Safe Browsing lookup |
| Malicious downloads | ransomware/adware/trojan files | MoTW, risky-type warning, hash reputation |
| Clickjacking / overlays | invisible iframes, fake "close" buttons | cosmetic filters + frame policy |

---

## 3. Layered architecture (defense in depth)

### Layer 1 — Network request filtering (the core adblocker) ★ highest impact
Replace the tiny `AD_HOSTS` regex with a real filter engine that understands EasyList-syntax rules.

- **Recommended library: `@ghostery/adblocker-electron`** (the maintained successor to `@cliqz/adblocker-electron`).
  It parses EasyList/EasyPrivacy/uBO filter lists, hooks an Electron `Session` in one call
  (`ElectronBlocker.fromPrebuiltAdsAndTracking(fetch).then(b => b.enableBlockingInSession(session))`), and does
  **both** network blocking *and* cosmetic filtering (element hiding) with a fast WASM-backed matcher.
  - Pros: purpose-built for Electron, same filter format as uBO, actively maintained, low overhead.
  - Cons: adds a dependency + bundled lists (~a few MB); must be applied per `Session`.
- **Alternative: Chromium `declarativeNetRequest`** via a bundled MV3 ruleset. More native, but converting/maintaining
  large lists to DNR rules is painful and rule-count-limited. Prefer the library unless we want zero deps.
- Apply to `session.fromPartition('persist:browser')` (and every future tab's session). Also re-apply the same
  engine to the hidden download-page sessions to retire the hand-rolled regex (one code path, far broader coverage).

### Layer 2 — Cosmetic filtering
The same engine injects CSS/JS to hide leftover ad placeholders, sticky overlays, anti-adblock nag walls, and
clickjacking overlays (EasyList cosmetic rules + uBO "annoyances"/"popups" lists). Keep a per-site off switch.

### Layer 3 — Pop-up / redirect / tab-under policy (not just filters)
- `setWindowOpenHandler`: **deny by default.** Only allow when the open is a direct user gesture to a same-or-linked
  origin; otherwise block and show a quiet "Lumina blocked a pop-up" affordance with an "allow once" option. (Change
  today's behaviour that silently follows every `window.open` in-place.)
- Guard `will-navigate` / `will-redirect`: block navigations to known-bad hosts (Layer 4) and rate-limit rapid
  programmatic redirects (classic forced-redirect chains). Strip `beforeunload` abuse (`disableDialogs`).
- Disable autoplay-driven pop-ups; deny `window.open` from cross-origin iframes.

### Layer 4 — Malware / phishing URL intelligence
Check the **target of each top-level navigation and each download** against threat feeds before proceeding:
- **URLhaus (abuse.ch)** — free, no key, a blocklist of live malware-distribution URLs/hosts. Download + cache the
  host/URL list, refresh periodically, check locally. Cheap and high-signal for malware hosts.
- **Google Safe Browsing Update API v4** — privacy-preserving *local* hash-prefix database (malware, social
  engineering/phishing, unwanted software). Flow: sync hash-prefix lists locally → hash the URL → local prefix
  match → confirm the rare hit via a full-hash lookup. Free with an API key; the gold standard for phishing.
- **PhishTank / OpenPhish** — optional extra phishing feeds.
- On a hit: show a **full-page interstitial** ("Lumina blocked this page — it's on a malware/phishing list") with a
  clear risk explanation and an explicit, logged **"I understand, continue anyway"** override (never a silent pass).

### Layer 5 — Download safety (ransomware / adware / trojans in files)
Downloads are where real damage happens. Layered checks in the engine before/after fetch:
- **Mark-of-the-Web (Windows):** write the `Zone.Identifier` alternate data stream so SmartScreen/AV treat the file
  as internet-sourced (this is what real browsers do; it's a big free win).
- **Dangerous file-type warning:** before a file that can execute is opened/launched from Lumina
  (`.exe .msi .scr .bat .cmd .com .js .jse .vbs .ps1 .lnk .reg .hta .apk .dmg .pkg …`), show a clear warning with the
  source domain; require an explicit confirm. Never auto-run.
- **Hash reputation:** compute SHA-256 of the finished file and check against **URLhaus payload DB** (free) and,
  optionally, **VirusTotal** (user-supplied API key; honest note: VT free tier is rate-limited, ~4 req/min).
- **Quarantine option:** keep new executables in a holding folder until checked; optional local **ClamAV** scan hook
  for users who want on-device AV (heavy, opt-in).

### Layer 6 — Permission & isolation hardening (cheap, do first)
- Deny by default: Notifications, geolocation, camera, mic, MIDI, clipboard-read, USB, serial — with a per-site
  allow prompt only on genuine user action (mirror the download-page handlers already in `hosters.ts`).
- Keep `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` (already set); enforce HTTPS-first
  (upgrade `http`→`https`, warn on insecure form posts); strict CSP on our own pages (start page, interstitials).

### Layer 7 — DNS-level blocking (optional, belt-and-suspenders)
Offer routing DNS through a filtering resolver (DoH to a blocklist provider, or a local domain blocklist). Coarser
than Layer 1 and can't do path/cosmetic rules, so it's a complement, not a replacement. Advanced setting.

---

## 4. Filter-list management
- **Bundle a sensible default set:** EasyList, EasyPrivacy, EasyList Cookie/Annoyances, uBO "Privacy"/"Badware"/
  "Resource abuse" + popup lists, and URLhaus. The `@ghostery/adblocker` prebuilt bundles cover most of this.
- **Auto-update** lists on a schedule (e.g. every 3–7 days) with a manual "update now"; cache in `dataDir`.
- **Advanced:** let power users add/remove list URLs and write custom rules; per-site allowlist persisted in settings.

## 5. Settings & UX
- New settings section (`shield`/`browser`): master blocking on/off, list selection, cosmetic filtering on/off,
  safe-browsing on/off, block-notifications, HTTPS-only, download-scan on/off, VT key.
- **Shield popover** (from the Extensions/Shield toolbar button in doc 11): blocked-count badge for the page, a
  per-site "pause on this site" toggle, and a link to the settings. A visible counter builds trust and gives an
  escape hatch when a site breaks ("disable here").
- **Interstitials** for malware/phishing and for dangerous downloads, each with a logged override.

## 6. Performance & footprint
- `@ghostery/adblocker` matching is WASM-fast; the cost is memory for the compiled lists (tens of MB) and a one-time
  parse at startup — do it async and cache the serialized engine. URLhaus/GSB are local lookups after the initial
  sync. Net effect is usually *faster* page loads (fewer ad requests), like uBO.

## 7. Phased implementation (browser workday)
1. **Layer 1 + 6 + 3** on `persist:browser`: integrate `@ghostery/adblocker-electron` (EasyList + EasyPrivacy +
   popups + cosmetic), deny permissions by default, fix `window.open`/redirect policy, add the shield toggle +
   blocked count. Retire the `AD_HOSTS` regex by pointing the download-page sessions at the same engine. *(Biggest,
   most visible win; ship this first.)*
2. **Layer 4:** URLhaus host/URL blocklist + navigation/download checks + interstitial; then Safe Browsing v4.
3. **Layer 5:** Mark-of-the-Web + dangerous-type warnings + SHA-256/URLhaus payload reputation (VT optional).
4. **Layer 7 + list management UI + per-site controls.**

## 8. Sources to confirm at implementation (don't trust versions from memory)
- `@ghostery/adblocker-electron` — github.com/ghostery/adblocker (API + prebuilt list helpers; confirm current
  package name/version and the `enableBlockingInSession` signature).
- EasyList / EasyPrivacy — easylist.to. uBO filter lists — github.com/uBlockOrigin/uAssets.
- Google Safe Browsing Update API v4 — developers.google.com/safe-browsing (local DB flow, quotas, key).
- URLhaus / abuse.ch — urlhaus.abuse.ch (URL + payload/hash feeds, usage policy).
- Electron `session.webRequest`, `setWindowOpenHandler`, `setPermissionRequestHandler`, `declarativeNetRequest`,
  and Windows Zone.Identifier / MoTW — electronjs.org docs.

## 9. Honest limits (put a short version of this in the UI)
Blocking is best-effort: filter lists lag brand-new ad/malware domains; encrypted/first-party-proxied ads slip
through; a determined user can still download and run malware; phishing that isn't yet listed won't be caught. The
goal is to make the in-app browser **as safe as a hardened uBO+SmartScreen setup**, clearly, with the user able to
see what's blocked and override when needed — not to promise perfection.
