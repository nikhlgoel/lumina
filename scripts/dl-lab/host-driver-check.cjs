// Runs Lumina's host-page driver (PAGE_DRIVER in src/core/hosts.ts) in a hidden, off-screen page and prints what it decides for each kind of
// bot check, unsolved and solved. A check waiting for a person must stay "captcha" (no click); one the person has solved (the widget has filled
// in its response token) must let the driver carry on and press the host's own Download button. AGENTS.md rule 1 still holds: the driver never
// solves anything, it only notices that the person has.
//
//   node -e "import('file:///<repo>/src/core/hosts.ts').then(m => require('fs').writeFileSync('driver.js', m.PAGE_DRIVER))"
//   DRIVER_FILE=driver.js ./node_modules/.bin/electron scripts/dl-lab/host-driver-check.cjs --user-data-dir=<scratch>
//
// (Node strips the TypeScript types itself; no window is ever shown.) Needs a real browser engine, so it is a lab script and not a vitest test.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');

const DRIVER = fs.readFileSync(process.env.DRIVER_FILE ?? 'driver.js', 'utf8');
const TOKEN = 'x'.repeat(60);

const CASES = [
  { name: 'Turnstile, not yet solved', expectCaptcha: true, html: '<div class="cf-turnstile" style="width:300px;height:65px">widget</div><input type="hidden" name="cf-turnstile-response" value="">' },
  { name: 'Turnstile, solved by the person (widget still on screen)', expectCaptcha: false, html: `<div class="cf-turnstile" style="width:300px;height:65px">Success!</div><input type="hidden" name="cf-turnstile-response" value="${TOKEN}">` },
  { name: 'reCAPTCHA, not yet solved', expectCaptcha: true, html: '<div class="g-recaptcha" style="width:304px;height:78px">I\'m not a robot</div><textarea name="g-recaptcha-response" style="display:none"></textarea>' },
  { name: 'reCAPTCHA, solved by the person', expectCaptcha: false, html: `<div class="g-recaptcha" style="width:304px;height:78px">I'm not a robot</div><textarea name="g-recaptcha-response" style="display:none">${TOKEN}</textarea>` },
  { name: 'hCaptcha, not yet solved', expectCaptcha: true, html: '<div class="h-captcha" style="width:300px;height:80px">hcaptcha</div><textarea name="h-captcha-response" style="display:none"></textarea>' },
  { name: 'hCaptcha, solved by the person', expectCaptcha: false, html: `<div class="h-captcha" style="width:300px;height:80px">hcaptcha</div><textarea name="h-captcha-response" style="display:none">${TOKEN}</textarea>` },
  { name: 'image code (always waits for a person)', expectCaptcha: true, html: '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=#captcha" alt="" style="width:120px;height:40px" id="c" />' },
  { name: 'no check at all', expectCaptcha: false, html: '' },
];

app.whenReady().then(async () => {
  let failed = 0;
  const win = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { offscreen: true, sandbox: true } });
  await win.loadURL('about:blank');
  for (const c of CASES) {
    // The same hidden page each time, with the case written into it (no navigation, so nothing can fail to load).
    await win.webContents.executeJavaScript(`document.documentElement.innerHTML = ${JSON.stringify(`<body style="margin:0"><h2>Sample.part1.rar</h2>${c.html}<button id="method_free" style="width:160px;height:40px">Free Download</button></body>`)}; 0`);
    await new Promise((r) => setTimeout(r, 400));
    const scan = await win.webContents.executeJavaScript(DRIVER);
    const pressed = Boolean(scan.target || scan.clicked);
    // Waiting for a person: no click. Passed or absent: the host's own Download button is found and pressed.
    const ok = scan.captcha === c.expectCaptcha && pressed === !c.expectCaptcha;
    if (!ok) failed++;
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  (captcha=${scan.captcha}, kind=${scan.captchaKind}, button found=${pressed})\n`);
  }
  process.stdout.write(`\n${CASES.length - failed} of ${CASES.length} cases as expected\n`);
  app.exit(failed ? 1 : 0);
});
