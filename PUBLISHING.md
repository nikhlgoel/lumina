# Releasing Lumina, and getting it onto the stores

Written 2026-11-12. Each fact is marked **verified** (read on the official page that day), **third-party** (a guide or forum, not official) or
**unknown**. Prices and review times change: confirm them on the page when you register.

## 0. What is actually true of this repository today

- Releases are tagged **without a "v"** (`1.2.1`, `1.2.0`, `1.1.0`). Older tags such as `v2.0.0` exist from before.
- The real releases carry **Windows installers only** (Standard and Full), the two extension zips, the Android APK and `SHA256SUMS.txt`. They were uploaded
  by hand.
- `.github/workflows/release.yml` **does not match that**: it triggers on `v*` tags (yours have none), builds files with different names, and has never
  run. Treat it as unproven. It would also build Linux AppImage/rpm packages, which have never been built or run by anyone.
- There is **no macOS build** and no Linux build you have tested. `electron-builder.json` has a `mac` block, but `scripts/fetch-tools.mjs` has no macOS tools.
- `extension/manifest.json` says **1.2.2** like the app (`scripts/build-extension.mjs` sets the packaged version from `package.json` in any case), and the extension has changed since. A store accepts an upload only if its version is
  higher than the one it has, so raise it first.

## 1. Making releases stable (the part that matters most)

A green test run is the floor, not the finish (CLAUDE.md says so, and it has been wrong before). Do these in order for every release:

1. **`bash scripts/release-check.sh`**. One command: versions agree; type check; unit tests; build; the real app run offscreen (page-driving layouts,
   host handling, the challenge gate, streams, cancel, files already on disk, torrents); the extension end to end, against ordinary pages and against hostile ones; the equalizer's sound, measured; a whole series through the real app; hostile input to the app's IPC channels and a soak that visits every screen 120 times; property tests at 5,000 inputs. It stops at the first failure.
2. **Cut a release candidate, not the release.** Tag `1.2.2-rc1` and publish it as a GitHub *pre-release* (not "Latest"). Nobody gets it by accident.
3. **Soak it for at least 3 days of your own use.** Install it, download real things, leave it open overnight, close and reopen it mid-download, sleep the
   laptop. Then read the log, because problems show there before anyone notices them:
   `grep -E "WARN|ERROR" "%APPDATA%/lumina-media/logs/lumina.log"`. Anything you cannot explain is a reason to wait.
4. **Install it clean.** On a second Windows account or a fresh VM, run the Standard installer, open the app, pair the extension, download one file.
   Your own machine hides missing files and leftover settings.
5. **Only then** publish the same files as the release (promote the pre-release; do not rebuild, or you ship something you did not soak).
6. **Keep the old installer.** If something is wrong, point the stores back at the previous version while you fix it.

What no script can do: tell you a real host (Pixeldrain, FileDitch, YouTube) still behaves as it did. That is why step 3 exists.

## 2. The browser extension on the Chrome Web Store (paused)

**Paused by the owner on 2026-11-12:** the extension stays a developer-mode install from `release/extension/lumina-chromium.zip` (Chrome: Extensions, Developer mode, Load unpacked). What follows is kept for when it is picked up again.

**Cost and rules**
- You must register as a developer and pay a **one-time registration fee** (**verified**: the official page says so; it does not state the amount here.
  Third-party guides say US$5: confirm when you register). There is no yearly fee mentioned.
- **2-Step Verification must be on** for the Google account that publishes (**verified**).
- Use a fresh email address for the developer account; it cannot be changed later (**verified**).
- You need a **privacy policy link** if the extension handles user data (**verified**). Ours does: it reads cookies and page links and sends them to the
  app on the same computer. Say that plainly, say nothing leaves the computer, and add the "Limited Use" sentence the policy asks for (**verified**).
- Request the **narrowest permissions** and state a **single purpose** (**verified**). Ours: "send download links from the page you are on to the Lumina app
  on your computer". Be ready to justify `cookies`, `downloads`, `webRequest`, `scripting` and the host access one by one.
- No remote code, no obfuscation (**verified**). The extension is plain files, which is fine.
- Review takes "hours to a few days" (**third-party**); unknown officially.

**The risk you should know about (verified wording)**: the policy says not to "encourage, facilitate, or enable the unauthorized access, download, or
streaming of copyrighted content or media". Google also says video downloaders "may be restricted from feature" but "will still be available". Separate
forum threads describe YouTube-related rejections (**third-party**, content not confirmed). Describe the extension as what it is (it hands links to a
desktop app the person already runs) and do not name YouTube in the listing. It may still be refused; if so, Firefox and Edge are the fallback (below).

**Steps**
1. Raise `extension/manifest.json` `version` above 1.1.0 and run `node scripts/build-extension.mjs`. Upload `release/extension/lumina-chromium.zip`.
2. Register at the Chrome Web Store developer dashboard, accept the agreement, pay the fee.
3. New item: upload the zip, fill the listing (description, icon, at least one screenshot, category), the privacy fields, the single purpose, the
   permission justifications, and the privacy policy URL (a page on your site or the repo).
4. Provide test instructions: the reviewer has no Lumina installed, so say what to expect (the button shows "not connected" without the app) and link the
   installer. A reviewer who cannot see it work is the commonest reason for rejection.
5. Submit, answer any email from the review team quickly (**verified**: not answering can remove the item).
6. **Updates**: raise the version, upload the new zip. People get it automatically, which is the reason to do this.

**Other stores for the same extension**: Firefox Add-ons (free, upload `lumina-firefox.zip`; the add-on page signs it) and Microsoft Edge Add-ons (free,
accepts the Chrome zip). Neither fee nor policy was checked this session.

## 3. The app on winget (Windows)

Free. A pull request to `microsoft/winget-pkgs`, checked by an automated run of your installer and sometimes by a person (**verified**). Microsoft may
refuse for any reason (**verified**). Whether an unsigned installer is accepted was **not found**: try it and read the pull request's checks.

**What is already in this repository (set up, tested where noted)**
- `scripts/winget-manifest.mjs`: writes the three manifest files for any published release into `packaging/winget/<version>/`. It points at the Standard
  installer of the GitHub release with that tag and takes the checksum from that release's own `SHA256SUMS.txt`, so it can only describe a file that is
  really published. Run: `node scripts/winget-manifest.mjs 1.2.2`.
- `packaging/winget/1.2.1/`: the manifest for the current public release, generated and **checked with `winget validate` (passed)**.
- The values come from a real installed Lumina: package ID `nikhlgoel.Lumina`, publisher `nikhlgoel`, the product code Windows records for Lumina
  (the same for every version), per-user install, silent install through NSIS (`nullsoft`, **verified** as a supported type; winget sets the silent switch
  itself).
- `.github/workflows/winget.yml`: when you publish a (non-pre-)release it sends the new version to winget with Microsoft's `wingetcreate`. It needs the
  two things in the next list, so it does nothing useful until you have done them. Untested: it has never run.

**What only you can do (it needs your GitHub account)**
1. Make a GitHub personal access token (classic) with the `public_repo` scope: GitHub, Settings, Developer settings, Personal access tokens. Keep it private.
2. Submit the **first** version by hand, once. Do it for the release you have soaked, not the old 1.2.1:
   ```powershell
   node scripts/winget-manifest.mjs 1.2.2
   winget validate --manifest packaging\winget\1.2.2
   winget install wingetcreate
   wingetcreate submit packaging\winget\1.2.2 --token <your token>
   ```
   This forks `microsoft/winget-pkgs` and opens the pull request. Their robot installs your installer in a sandbox and checks it; a person may also
   look. Read the pull request's checks and answer anything they ask. Review takes days (unknown officially).
3. Add the token as a repository secret named `WINGET_TOKEN` (repository Settings, Secrets and variables, Actions). From then on, publishing a release
   sends the update by itself.

**What people then type** (the ID is exact; a bare name may match something else):
```powershell
winget install nikhlgoel.Lumina        # first install
winget upgrade nikhlgoel.Lumina        # later: one command updates it
```
`winget upgrade` recognises an installed Lumina through the product code and the version Windows records, which the installer already writes.

**Known limits.** I could not test a real winget install here: installing from a local manifest needs a winget setting changed (an administrator
action on your machine) and would replace your running Lumina, so the first real test is the pull request's own sandbox run. Whether an unsigned
installer passes that run was not found; if it is held, the pull request says why.

## 4. Homebrew and Linux: what is possible now, honestly

- **Homebrew casks are for macOS.** Linux cask support exists since Homebrew 4.5.0 and is "preliminary" (**third-party** reporting of the release notes);
  an Electron app on Linux would need an AppImage that has been built and run. We have **no macOS build and no tested Linux build**, so there is
  nothing to submit to Homebrew today. Do not submit one until a Mac or Linux build exists and someone has opened it.
- **What must exist first for Linux**: build the AppImage in CI (`release.yml`, after fixing its tag pattern and file names), run it on a real Linux
  machine, and test the extension's connection to it. Then Flathub (a Flatpak manifest, reviewed by volunteers) or an AUR package are the usual routes.
- **What must exist first for macOS**: macOS tools in `scripts/fetch-tools.mjs`, a build on a Mac, and, for a smooth install, Apple's paid developer
  programme for notarization (price not checked here). Without it people see a warning once.
- **Scoop** is the easiest extra Windows channel: one JSON file in your own "bucket" repository, no review.

## 5. Order I would do it in

1. Fix the release workflow's tag pattern and names (or keep uploading by hand, which has worked).
2. `bash scripts/release-check.sh`, then a release candidate, the 3-day soak, the clean install.
3. Publish. Raise the extension version; submit the extension to the Chrome Web Store, Firefox and Edge.
4. winget (after the release is public, since it needs the download URL).
5. Linux and macOS only after a build exists and has been run by a person.

Code signing (paid certificate) removes the SmartScreen warning on Windows; none of the above depends on it.
