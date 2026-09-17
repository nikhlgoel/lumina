# Publishing Lumina to free desktop channels

This is the honest, end-to-end path to getting Lumina onto the free channels that
matter, in the order they have to happen. Nothing here can be skipped: every store
points at a **hosted release**, so that comes first.

## The reality (read this first)

- **A hosted release must exist before any store submission.** winget, Homebrew and
  Flathub all reference a downloadable installer URL + its SHA256.
- **Store submissions are pull requests to *their* repos**, reviewed by *their*
  maintainers — `microsoft/winget-pkgs`, `Homebrew/homebrew-cask`,
  `flathub/flathub`. They can be revised or rejected; a YouTube-capable downloader
  can draw extra scrutiny under their policies.
- **"Signed / official" costs money.** Removing the Windows SmartScreen and macOS
  Gatekeeper warnings needs paid certificates:
  - Windows Authenticode code-signing cert (~$100–400/yr), or an Azure Trusted
    Signing subscription.
  - Apple Developer Program ($99/yr) for macOS notarization.
  Unsigned builds work fine and are normal for open-source tools; users just see a
  one-time warning. Signing can be added later without changing anything else.
- **Ship a stable version, not an alpha.** The current version is an alpha. Stores
  expect a working, stable release — cut `v1.0.0` (not `-alpha`) once the known gaps
  are closed, or the first impression (and review) will suffer.

## Step 1 — Cut the first release (GitHub Releases, free)

The `.github/workflows/release.yml` workflow builds Windows + Linux installers and
publishes them to a GitHub Release. (macOS is intentionally omitted for now: it needs
`scripts/fetch-tools.mjs` to support `darwin` binaries and an Apple signing identity.)

```bash
# from the repo, on the commit you want to ship
git tag v1.0.0
git push origin v1.0.0
```

This runs the workflow and creates a **draft** GitHub Release with the installers
attached. Review it, then publish it in the GitHub UI. You now have stable URLs like:

```
https://github.com/nikhlgoel/lumina/releases/download/v1.0.0/Lumina-Setup-1.0.0-windows-x64.exe
```

> First run may fail on runner-specific details — check the Actions log and iterate.
> Building locally instead: `pnpm package:win` (Windows) produces `release/…Setup….exe`.

## Step 2 — winget (Windows, free, most attainable)

Use Microsoft's own tool — it reads the installer, generates the manifest, and opens
the PR for you:

```powershell
winget install wingetcreate
wingetcreate new https://github.com/nikhlgoel/lumina/releases/download/v1.0.0/Lumina-Setup-1.0.0-windows-x64.exe
# fill in: PackageIdentifier = nikhlgoel.Lumina, publisher, licence (MIT), etc.
wingetcreate submit --token <your GitHub PAT with public_repo>
```

It forks `microsoft/winget-pkgs`, commits `manifests/n/nikhlgoel/Lumina/1.0.0/…`, and
opens the PR. Automated validation runs the installer in a sandbox; fix anything it
flags. After merge: `winget install Lumina`.

## Step 3 — Homebrew Cask (macOS, free)

Requires a macOS build hosted in the release (see the macOS note in Step 1). The cask
is one file submitted to `Homebrew/homebrew-cask`:

```ruby
cask "lumina" do
  version "1.0.0"
  sha256 "<sha256 of the .dmg>"
  url "https://github.com/nikhlgoel/lumina/releases/download/v#{version}/Lumina-#{version}-arm64.dmg"
  name "Lumina"
  desc "Free, open-source media downloader and player"
  homepage "https://github.com/nikhlgoel/lumina"
  app "Lumina.app"
end
```

Submit with `brew bump-cask-pr` (updates) or a PR to the cask repo (first listing).
Homebrew requires either a stable maintained project or notarization; read their
acceptable-casks guidelines first.

## Step 4 — Flathub (Linux, free)

Cross-distro, good reach. Write a Flatpak manifest (`com.lumina.media.yml`) that
bundles the AppImage/binary, and open a PR to `flathub/flathub`. Review takes time and
has content guidelines — check them before submitting.

## Other free Windows channels (no review friction)

- **Scoop** — add a manifest to the `extras` bucket.
- **Chocolatey** — free community repo (`choco push`), light moderation.

## Recommended order

1. GitHub Releases (Step 1) — the foundation.
2. winget (Step 2) — easiest "official" Windows listing.
3. Scoop / Chocolatey — quick wins for Windows power users.
4. Homebrew Cask + Flathub — once macOS/Linux builds are in the release.

Add code signing when there's budget; it upgrades the experience but changes none of
the above.
