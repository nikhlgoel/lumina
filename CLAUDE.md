# CLAUDE.md

**Read [AGENTS.md](AGENTS.md) first — it is canonical.** Hard rules, repository layout, how to verify
work, the offscreen capture harness, style, and the traps that have bitten this codebase repeatedly
all live there. They are deliberately **not** duplicated here: this project has already been bitten
by `HANDOVER.md` and `SESSION-LOG.md` drifting apart, and two copies of the rules would drift the
same way.

Then read [HANDOVER.md](HANDOVER.md) §0 for what is currently built, proven, and not proven.

---

## Notes specific to this environment

**The shell is Git Bash on Windows.** PowerShell is available too, but each takes its own syntax.
Heredocs here **strip backslashes** — a regex or a Windows path written through one arrives
corrupted, and it fails in ways that look like a logic bug. Use the Write tool for anything
containing `\`, or build the string without backslashes.

**Never open the app window.** Verify UI through the capture harness (AGENTS.md §3). If a foreground
launch is genuinely unavoidable, ask first.

**The user's own Lumina is often running.** Always pass `--user-data-dir=<scratch>` to a second
instance, and remember that ports 8200 (DLNA) and 17865 (extension bridge) will already be taken —
which makes them a convenient way to test failure paths honestly.

## What "done" means here

Three commands passing is the floor, not the finish line:

```bash
npx tsc --noEmit && npx vitest run && npx vite build
```

Every one of these has passed while a feature was completely dead on screen. Before saying something
works, run the real path and look at the result. Where that isn't possible, say so plainly and mark
it unproven in `HANDOVER.md` — the standing instruction from the user is honesty over polish, and an
unearned claim costs more than an admitted gap.

## Working agreement

* **Do not commit or push unless asked.** When asked: short, clear message; no co-author line.
* Report what failed, what was skipped, and what is still unexplained. A wrong theory that was
  disproved is worth writing down in `SESSION-LOG.md` so nobody rebuilds it.
* Prefer fixing the cause over the symptom, and put the decision in `src/core` with a test when the
  bug was a silent one.
