@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Lumina - Project Menu

rem ===========================================================================
rem  Lumina project menu - quick actions for day-to-day work.
rem
rem  Every action here runs the SAME commands the project actually uses; this
rem  file adds no build logic of its own, so it cannot drift from package.json.
rem
rem  Two project rules are baked in and must stay that way:
rem    * ELECTRON_RUN_AS_NODE is cleared before launching Electron. The host app
rem      leaks it into child shells and Electron then starts as plain Node.
rem    * Screenshot runs render OFFSCREEN. Nothing appears on screen.
rem ===========================================================================

set "SCRATCH=%TEMP%\lumina-menu-profile"
set "SHOTS=%TEMP%\lumina-menu-shots"
set "PM=pnpm"
set "EMPTY=0"
rem An action number can be passed straight in - "Menu.cmd 1" runs Verify everything and
rem returns, which makes the menu usable from a shortcut, a task or another script.
set "ARG=%~1"
if defined ARG set "BATCH=1"

where %PM% >nul 2>&1
if errorlevel 1 (
  echo.
  echo   pnpm was not found on PATH. This project uses pnpm.
  echo   Install it with:  npm i -g pnpm
  echo.
  pause
  exit /b 1
)

:MAIN
cls
echo ===========================================================================
echo   LUMINA  -  project menu
echo ===========================================================================
call :SHOWBRANCH
echo.
echo   CHECK
echo     1.  Verify everything      (types + tests + build)
echo     2.  Type-check only
echo     3.  Tests...
echo     4.  Production build
echo.
echo   RUN
echo     5.  Dev server             (hot reload, opens the app window)
echo     6.  Launch app             (scratch profile, opens a window)
echo     7.  Screenshots...         (offscreen - no window appears)
echo     8.  Diagnostics...         (self-test, resource metrics, tools)
echo.
echo   SHIP
echo     9.  Build a release...
echo    10.  Open the release folder
echo.
echo   PROJECT
echo    11.  Git...
echo    12.  Dependencies...
echo    13.  Open a folder...
echo    14.  Clean...
echo    15.  Search the source
echo    16.  Project info
echo.
echo     0.  Exit
echo.
set "choice="
if defined ARG (set "choice=!ARG!" & set "ARG=") else (set /p "choice=  Choose: ")
rem An empty answer normally just redraws the menu. But if stdin is a pipe that has run
rem dry, set /p returns instantly forever and this would spin at 100%% CPU, so give up.
if not defined choice (
  set /a EMPTY+=1
  if !EMPTY! GEQ 3 (echo. ^& echo   No input - exiting. ^& exit /b 0)
  goto MAIN
)
set "EMPTY=0"
if "%choice%"=="1"  goto VERIFY
if "%choice%"=="2"  goto TYPECHECK
if "%choice%"=="3"  goto TESTMENU
if "%choice%"=="4"  goto BUILD
if "%choice%"=="5"  goto DEV
if "%choice%"=="6"  goto LAUNCH
if "%choice%"=="7"  goto SHOTMENU
if "%choice%"=="8"  goto DIAGMENU
if "%choice%"=="9"  goto RELEASEMENU
if "%choice%"=="10" goto OPENRELEASE
if "%choice%"=="11" goto GITMENU
if "%choice%"=="12" goto DEPSMENU
if "%choice%"=="13" goto OPENMENU
if "%choice%"=="14" goto CLEANMENU
if "%choice%"=="15" goto SEARCH
if "%choice%"=="16" goto INFO
if "%choice%"=="0"  exit /b 0
goto MAIN

rem ---------------------------------------------------------------- helpers --
:SHOWBRANCH
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"
for /f "delims=" %%c in ('git rev-parse --short HEAD 2^>nul') do set "HEADSHA=%%c"
if defined BRANCH (
  set "DIRTY="
  for /f "delims=" %%d in ('git status --porcelain 2^>nul') do set "DIRTY=yes"
  if defined DIRTY (
    echo   branch: !BRANCH! @ !HEADSHA!   [uncommitted changes]
  ) else (
    echo   branch: !BRANCH! @ !HEADSHA!   [clean]
  )
)
exit /b 0

:HOLD
rem "exit /b" inside a CALLed label only returns from the call, which would drop straight
rem back into the menu. In argument mode the whole script should end, so exit the process.
if defined BATCH exit
pause
exit /b 0

:DONE
echo.
echo ---------------------------------------------------------------------------
if "%ERRORLEVEL%"=="0" (echo   Finished OK.) else (echo   Finished with errors. Exit code %ERRORLEVEL%.)
echo.
if defined BATCH exit /b %ERRORLEVEL%
call :HOLD
goto MAIN

rem ------------------------------------------------------------------ check --
:VERIFY
cls
echo === 1/3  Type-check =======================================================
call %PM% exec tsc --noEmit
if errorlevel 1 goto DONE
echo.
echo === 2/3  Tests ============================================================
call %PM% exec vitest run
if errorlevel 1 goto DONE
echo.
echo === 3/3  Build ============================================================
call %PM% exec vite build
goto DONE

:TYPECHECK
cls
call %PM% exec tsc --noEmit
goto DONE

:BUILD
cls
call %PM% run build
goto DONE

:TESTMENU
cls
echo === Tests =================================================================
echo.
echo     1.  Run all tests
echo     2.  Watch mode
echo     3.  One test file
echo     4.  Tests matching a name
echo     0.  Back
echo.
set "t="
set /p "t=  Choose: "
if "%t%"=="1" (cls & call %PM% exec vitest run & goto DONE)
if "%t%"=="2" (cls & call %PM% exec vitest & goto DONE)
if "%t%"=="3" goto TESTFILE
if "%t%"=="4" goto TESTNAME
goto MAIN

:TESTFILE
echo.
echo   Test files:
dir /b tests\*.test.ts
echo.
set "f="
set /p "f=  File (e.g. theme.test.ts): "
if "%f%"=="" goto MAIN
cls
call %PM% exec vitest run tests/%f%
goto DONE

:TESTNAME
echo.
set "n="
set /p "n=  Test name contains: "
if "%n%"=="" goto MAIN
cls
call %PM% exec vitest run -t "%n%"
goto DONE

rem -------------------------------------------------------------------- run --
:DEV
cls
echo   Starting the dev server. The app window WILL open, and renderer edits
echo   hot-reload into it. Close the window or press Ctrl+C here to stop.
echo.
call %PM% run dev
goto DONE

:LAUNCH
cls
echo   Launching Lumina with a throwaway profile so it cannot disturb your real
echo   settings or fight the running app for the single-instance lock.
echo   Profile: %SCRATCH%
echo.
if not exist "%SCRATCH%" mkdir "%SCRATCH%"
set "ELECTRON_RUN_AS_NODE="
call %PM% exec electron . --user-data-dir="%SCRATCH%"
goto DONE

:SHOTMENU
cls
echo === Screenshots (offscreen) ===============================================
echo.
echo   These render the app off screen and write PNGs. No window appears.
echo   Output: %SHOTS%
echo.
echo     1.  Capture every step        (slow - the whole app)
echo     2.  Capture steps matching a pattern
echo     3.  List the available steps
echo     4.  Open the screenshots folder
echo     0.  Back
echo.
set "c="
set /p "c=  Choose: "
if "%c%"=="1" goto SHOTALL
if "%c%"=="2" goto SHOTSOME
if "%c%"=="3" goto SHOTLIST
if "%c%"=="4" (if not exist "%SHOTS%" mkdir "%SHOTS%") & start "" explorer "%SHOTS%" & goto MAIN
goto MAIN

:SHOTLIST
cls
echo   Capture steps defined in src\main\capture.ts:
echo.
findstr /r /c:"{ name: '" src\main\capture.ts
echo.
call :HOLD
goto SHOTMENU

:SHOTALL
cls
if not exist "%SHOTS%" mkdir "%SHOTS%"
if not exist "%SCRATCH%" mkdir "%SCRATCH%"
set "ELECTRON_RUN_AS_NODE="
set "LUMINA_CAPTURE=%SHOTS%"
set "LUMINA_CAPTURE_ONLY="
echo   Capturing every step offscreen. This takes a few minutes.
call %PM% exec electron . --user-data-dir="%SCRATCH%"
set "LUMINA_CAPTURE="
echo.
echo   PNGs are in %SHOTS%
goto DONE

:SHOTSOME
echo.
echo   A pattern is a regular expression matched against the step name,
echo   for example:  settings   or   11a^|12b
set "p="
set /p "p=  Pattern: "
if "%p%"=="" goto SHOTMENU
cls
if not exist "%SHOTS%" mkdir "%SHOTS%"
if not exist "%SCRATCH%" mkdir "%SCRATCH%"
set "ELECTRON_RUN_AS_NODE="
set "LUMINA_CAPTURE=%SHOTS%"
set "LUMINA_CAPTURE_ONLY=%p%"
call %PM% exec electron . --user-data-dir="%SCRATCH%"
set "LUMINA_CAPTURE="
set "LUMINA_CAPTURE_ONLY="
echo.
echo   PNGs are in %SHOTS%
goto DONE

:DIAGMENU
cls
echo === Diagnostics ===========================================================
echo.
echo     1.  Host self-test          (downloader engines end to end)
echo     2.  Resource metrics        (RAM / CPU sampling)
echo     3.  Download the bundled tools for Windows
echo     4.  Download the bundled tools for Linux
echo     5.  Show which tool binaries are present
echo     0.  Back
echo.
set "d="
set /p "d=  Choose: "
if "%d%"=="1" goto SELFTEST
if "%d%"=="2" goto METRICS
if "%d%"=="3" (cls & call %PM% run tools:fetch -- --platform win32 & goto DONE)
if "%d%"=="4" (cls & call %PM% run tools:fetch -- --platform linux & goto DONE)
if "%d%"=="5" goto TOOLLIST
goto MAIN

:TOOLLIST
cls
echo   resources\bin:
echo.
if exist resources\bin (dir /s /b resources\bin\*.exe 2>nul) else (echo   nothing downloaded yet - use option 3)
echo.
call :HOLD
goto DIAGMENU

:SELFTEST
cls
set "LOG=%TEMP%\lumina-selftest.log"
if not exist "%SCRATCH%" mkdir "%SCRATCH%"
set "ELECTRON_RUN_AS_NODE="
set "LUMINA_SELFTEST=1"
set "LUMINA_SELFTEST_HOSTS=1"
set "LUMINA_SELFTEST_LOG=%LOG%"
echo   Running the host self-test. A GUI Electron process does not print to this
echo   console on Windows, so the output goes to a log file and is shown after.
echo.
call %PM% exec electron . --user-data-dir="%SCRATCH%"
set "LUMINA_SELFTEST="
set "LUMINA_SELFTEST_HOSTS="
echo.
echo --- %LOG% -------------------------------------------------------------
if exist "%LOG%" (type "%LOG%") else (echo   No log was written.)
set "LUMINA_SELFTEST_LOG="
goto DONE

:METRICS
cls
set "OUT=%TEMP%\lumina-metrics.jsonl"
if not exist "%SCRATCH%" mkdir "%SCRATCH%"
set "ELECTRON_RUN_AS_NODE="
set "LUMINA_METRICS=%OUT%"
echo   Sampling memory and CPU. Written to %OUT%
echo.
call %PM% exec electron . --user-data-dir="%SCRATCH%"
set "LUMINA_METRICS="
echo.
if exist "%OUT%" (type "%OUT%") else (echo   No samples were written.)
goto DONE

rem ------------------------------------------------------------------- ship --
:RELEASEMENU
cls
echo === Build a release =======================================================
echo.
echo   Which platform?
echo.
echo     1.  Windows
echo     2.  Linux
echo     3.  macOS
echo     4.  Unpacked folder for THIS machine   (fastest - no installer)
echo     0.  Back
echo.
set "r="
set /p "r=  Choose: "
if "%r%"=="1" goto RELWIN
if "%r%"=="2" goto RELLINUX
if "%r%"=="3" goto RELMAC
if "%r%"=="4" (cls & call %PM% run package:dir & goto SHOWRELEASE)
goto MAIN

:RELWIN
cls
echo === Windows release =======================================================
echo.
echo     1.  NSIS installer (.exe)      - what people download
echo     2.  Portable (.exe)             - runs from a USB stick, keeps its data there
echo     3.  Unpacked folder only       - run it without installing
echo     4.  Both installer and portable
echo     0.  Back
echo.
set "w="
set /p "w=  Choose: "
if "%w%"=="1" (cls & call %PM% run package:win & goto SHOWRELEASE)
if "%w%"=="2" (cls & call %PM% run package:portable & goto SHOWRELEASE)
if "%w%"=="3" (cls & call %PM% run package:dir & goto SHOWRELEASE)
if "%w%"=="4" (cls & call %PM% run package:win & call %PM% run package:portable & goto SHOWRELEASE)
goto RELEASEMENU

:RELLINUX
cls
echo === Linux release =========================================================
echo.
echo   Note: this cross-builds from Windows. AppImage usually works; the RPM
echo   target needs fpm and can fail on Windows. If it does, build it on Linux
echo   or in WSL rather than fighting it here.
echo.
echo     1.  AppImage + RPM             (the project's package:linux script)
echo     2.  AppImage only
echo     0.  Back
echo.
set "l="
set /p "l=  Choose: "
if "%l%"=="1" (cls & call %PM% run package:linux & goto SHOWRELEASE)
if "%l%"=="2" goto RELAPPIMAGE
goto RELEASEMENU

:RELAPPIMAGE
cls
call %PM% run tools:fetch -- --platform linux
if errorlevel 1 goto DONE
call %PM% run build
if errorlevel 1 goto DONE
call %PM% exec electron-builder --linux AppImage
goto SHOWRELEASE

:RELMAC
cls
echo === macOS release =========================================================
echo.
echo   A macOS build cannot be produced on Windows. Apple's toolchain and code
echo   signing only run on macOS, and an unsigned .dmg built elsewhere would be
echo   refused by Gatekeeper on the user's machine.
echo.
echo   To ship macOS, run this on a Mac (or a macOS CI runner):
echo.
echo       pnpm install
echo       pnpm tools:fetch --platform darwin
echo       pnpm build
echo       pnpm exec electron-builder --mac dmg
echo.
echo   The electron-builder.json already has the mac dmg target configured.
echo.
call :HOLD
goto RELEASEMENU

:SHOWRELEASE
echo.
echo ---------------------------------------------------------------------------
if exist release (
  echo   Output in release\:
  dir /b release
) else (
  echo   Nothing was produced - look for errors above.
)
echo.
set "o="
set /p "o=  Open the release folder? [y/N]: "
if /i "%o%"=="y" start "" explorer "%CD%\release"
goto DONE

:OPENRELEASE
if not exist release (echo. & echo   No release folder yet. & echo. & call :HOLD & goto MAIN)
start "" explorer "%CD%\release"
goto MAIN

rem ---------------------------------------------------------------- project --
:GITMENU
cls
echo === Git ===================================================================
call :SHOWBRANCH
echo.
echo     1.  Status
echo     2.  Recent commits
echo     3.  What changed        (diff --stat)
echo     4.  Full diff of one file
echo     5.  Stage everything and commit
echo     6.  Push the current branch
echo     7.  Fetch
echo     8.  New branch
echo     0.  Back
echo.
set "g="
set /p "g=  Choose: "
if "%g%"=="1" (cls & git status & goto DONE)
if "%g%"=="2" (cls & git log --oneline -20 & goto DONE)
if "%g%"=="3" (cls & git status --short & echo. & git diff --stat & goto DONE)
if "%g%"=="4" goto GITDIFF
if "%g%"=="5" goto GITCOMMIT
if "%g%"=="6" goto GITPUSH
if "%g%"=="7" (cls & git fetch --all & goto DONE)
if "%g%"=="8" goto GITBRANCH
goto MAIN

:GITDIFF
echo.
set "f="
set /p "f=  Path: "
if "%f%"=="" goto GITMENU
cls
git diff -- "%f%"
goto DONE

:GITCOMMIT
cls
git status --short
echo.
set "m="
set /p "m=  Commit message (empty cancels): "
if "%m%"=="" goto GITMENU
git add -A
git commit -m "%m%"
echo.
echo   Committed locally. Nothing has been pushed.
goto DONE

:GITPUSH
cls
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"
echo   About to push branch "%BRANCH%" to origin. This publishes your commits.
echo.
set "y="
set /p "y=  Type PUSH to confirm: "
if /i not "%y%"=="PUSH" (echo   Cancelled. & goto DONE)
git push -u origin "%BRANCH%"
goto DONE

:GITBRANCH
echo.
set "b="
set /p "b=  New branch name: "
if "%b%"=="" goto GITMENU
cls
git checkout -b "%b%"
goto DONE

:DEPSMENU
cls
echo === Dependencies ==========================================================
echo.
echo     1.  Install         (pnpm install)
echo     2.  What is out of date
echo     3.  Update within the ranges in package.json
echo     4.  Why is a package here  (pnpm why)
echo     0.  Back
echo.
set "p="
set /p "p=  Choose: "
if "%p%"=="1" (cls & call %PM% install & goto DONE)
if "%p%"=="2" (cls & call %PM% outdated & goto DONE)
if "%p%"=="3" (cls & call %PM% update & goto DONE)
if "%p%"=="4" goto DEPWHY
goto MAIN

:DEPWHY
echo.
set "n="
set /p "n=  Package name: "
if "%n%"=="" goto DEPSMENU
cls
call %PM% why "%n%"
goto DONE

:OPENMENU
cls
echo === Open a folder =========================================================
echo.
echo     1.  Project folder
echo     2.  Lumina's app data      (settings, database, logs)
echo     3.  Release output
echo     4.  Screenshots
echo     5.  Scratch test profile
echo     6.  Source in the editor   (VS Code, if installed)
echo     0.  Back
echo.
set "o="
set /p "o=  Choose: "
if "%o%"=="1" start "" explorer "%CD%" & goto MAIN
if "%o%"=="2" start "" explorer "%APPDATA%\Lumina" & goto MAIN
if "%o%"=="3" goto OPENRELEASE
if "%o%"=="4" (if not exist "%SHOTS%" mkdir "%SHOTS%") & start "" explorer "%SHOTS%" & goto MAIN
if "%o%"=="5" (if not exist "%SCRATCH%" mkdir "%SCRATCH%") & start "" explorer "%SCRATCH%" & goto MAIN
if "%o%"=="6" goto OPENCODE
goto MAIN

:OPENCODE
where code >nul 2>&1
if errorlevel 1 (echo   VS Code is not on PATH. & echo. & call :HOLD & goto OPENMENU)
start "" code "%CD%"
goto MAIN

:CLEANMENU
cls
echo === Clean =================================================================
echo.
echo   Nothing here touches your source or your git history.
echo.
echo     1.  Build output        (dist, dist-electron)
echo     2.  Release output      (release)
echo     3.  Scratch profiles and screenshots in TEMP
echo     4.  node_modules        (a full reinstall afterwards)
echo     5.  Everything above except node_modules
echo     0.  Back
echo.
set "c="
set /p "c=  Choose: "
if "%c%"=="1" (cls & call :RMBUILD & goto DONE)
if "%c%"=="2" (cls & call :RMRELEASE & goto DONE)
if "%c%"=="3" (cls & call :RMTEMP & goto DONE)
if "%c%"=="4" goto CLEANMODULES
if "%c%"=="5" (cls & call :RMBUILD & call :RMRELEASE & call :RMTEMP & goto DONE)
goto MAIN

:RMBUILD
if exist dist rmdir /s /q dist
if exist dist-electron rmdir /s /q dist-electron
echo   Removed dist and dist-electron.
exit /b 0

:RMRELEASE
if exist release rmdir /s /q release
echo   Removed release.
exit /b 0

:RMTEMP
if exist "%SCRATCH%" rmdir /s /q "%SCRATCH%"
if exist "%SHOTS%" rmdir /s /q "%SHOTS%"
echo   Removed the scratch profile and screenshots from TEMP.
exit /b 0

:CLEANMODULES
cls
echo   This deletes node_modules. You will need "pnpm install" afterwards,
echo   which takes a while.
echo.
set "y="
set /p "y=  Type YES to confirm: "
if /i not "%y%"=="YES" (echo   Cancelled. & goto DONE)
if exist node_modules rmdir /s /q node_modules
echo   Removed. Run Dependencies - Install next.
goto DONE

:SEARCH
cls
echo === Search the source =====================================================
echo.
set "q="
set /p "q=  Text to find: "
if "%q%"=="" goto MAIN
echo.
echo   Matches in src, tests and scripts:
echo.
findstr /s /i /n /c:"%q%" src\*.ts src\*.tsx tests\*.ts scripts\*.mjs 2>nul
goto DONE

:INFO
cls
echo === Project info ==========================================================
echo.
for /f "delims=" %%v in ('node -p "require('./package.json').name + ' ' + require('./package.json').version"') do echo   app:       %%v
for /f "delims=" %%v in ('node -p "require('./package.json').devDependencies.electron"') do echo   electron:  %%v
for /f "delims=" %%v in ('node -v') do echo   node:      %%v
for /f "delims=" %%v in ('%PM% -v') do echo   pnpm:      %%v
echo.
call :SHOWBRANCH
echo.
for /f %%c in ('dir /s /b src\*.ts src\*.tsx 2^>nul ^| find /c /v ""') do echo   source files:  %%c
for /f %%c in ('dir /s /b tests\*.ts 2^>nul ^| find /c /v ""') do echo   test files:    %%c
echo.
if exist dist (echo   dist:      built) else (echo   dist:      not built)
if exist release (echo   release:   present) else (echo   release:   none)
if exist node_modules (echo   deps:      installed) else (echo   deps:      NOT installed - run Dependencies - Install)
echo.
call :HOLD
goto MAIN
