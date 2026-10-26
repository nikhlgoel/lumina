import { describe, it, expect } from 'vitest';
import {
  aria2ExitMessage, friendlyAria2Error, friendlyYtdlpError, httpStatusMessage, isAcceleratorFailure, isControlFileMissing, plainFailure, tidyYtdlpMessage,
} from '@core/progress';
import { classifyFailure } from '@core/networkRetry';

// Every raw message below was read out of a real Lumina log, not invented.

describe('what a failed download says, instead of the network layer’s words', () => {
  it('turns a timeout into a sentence that still counts as a slow or lost connection', () => {
    const plain = plainFailure('The operation was aborted due to timeout');
    expect(plain).toMatch(/too long to answer/);
    expect(classifyFailure(plain)).toBe('network');
  });

  it('turns "fetch failed" into a dropped connection, which is waited out rather than called permanent', () => {
    const plain = plainFailure('fetch failed');
    expect(plain).toMatch(/connection to the server was interrupted/);
    expect(classifyFailure(plain)).toBe('network');
    // Even if the raw text reaches the classifier unchanged, it is no longer "permanent".
    expect(classifyFailure('fetch failed')).toBe('network');
  });

  it('puts the other raw codes into words', () => {
    expect(plainFailure('getaddrinfo ENOTFOUND example.invalid')).toMatch(/No internet connection/);
    expect(plainFailure('connect ECONNREFUSED 127.0.0.1:1')).toMatch(/refused the connection/);
    expect(plainFailure('read ECONNRESET')).toMatch(/interrupted/);
  });

  it('lets the code beside "fetch failed" decide what is said, and copes with the error name in front', () => {
    expect(plainFailure('fetch failed ECONNREFUSED ECONNREFUSED')).toBe('The server refused the connection.');
    expect(plainFailure('fetch failed ENOTFOUND')).toMatch(/No internet connection/);
    expect(plainFailure('TypeError fetch failed')).toMatch(/interrupted/);
    expect(plainFailure('fetch failed')).toMatch(/interrupted/);
  });

  it('leaves a message that is already readable alone', () => {
    const already = 'The disk is full. Free up space or choose another download folder, then press Retry.';
    expect(plainFailure(already)).toBe(already);
    expect(plainFailure('Skipped: the download page needed a quick check. Retry to open it again.')).toBe('Skipped: the download page needed a quick check. Retry to open it again.');
    expect(plainFailure('')).toBe('');
  });
});

describe('aria2 and its exit codes', () => {
  it('explains "aria2c exited with code 22", which is what yt-dlp reported for a refused fast download', () => {
    const msg = friendlyYtdlpError('aria2c exited with code 22');
    expect(msg).not.toMatch(/exited with code/);
    expect(msg).toMatch(/fast download/);
    expect(plainFailure('aria2c exited with code 22')).toBe(msg);
  });

  it('knows the codes that matter, and says so honestly about one it does not know', () => {
    expect(aria2ExitMessage(9)).toMatch(/disk is full/);
    expect(aria2ExitMessage(6)).toMatch(/network problem/);
    expect(aria2ExitMessage(999)).toMatch(/code 999/);
  });

  it('keeps the words the retry rules look for, so a timeout waits and a refusal does not loop', () => {
    expect(classifyFailure(aria2ExitMessage(2))).toBe('network');
    expect(classifyFailure(aria2ExitMessage(6))).toBe('network');
    expect(classifyFailure(aria2ExitMessage(19))).toBe('network');
    expect(classifyFailure(aria2ExitMessage(29))).toBe('transient');
    expect(classifyFailure(aria2ExitMessage(22))).toBe('permanent');
    expect(classifyFailure(aria2ExitMessage(9))).toBe('permanent');
  });

  it('reads "The response status is not successful. status=N" by its number', () => {
    const raw = (n: number) => `The response status is not successful. status=${n}`;
    expect(friendlyAria2Error(raw(401))).toMatch(/sign-in/);
    expect(friendlyAria2Error(raw(416))).toMatch(/Retry/);
    expect(friendlyAria2Error(raw(429))).toMatch(/rate-limiting/);
    expect(friendlyAria2Error(raw(503))).toMatch(/server had a problem \(503\)/);
    expect(classifyFailure(friendlyAria2Error(raw(503)))).toBe('transient');
    expect(friendlyAria2Error(raw(418))).toBe('The server answered with an error (418).');
  });

  it('recognises the missing control file refusal and tells the person what happens', () => {
    const raw = 'File C:\\Users\\x\\Downloads\\Lumina\\Shift At Midnight exists, but a control file(*.aria2) does not exist. Download was canceled in order to prevent your file from being truncated.';
    expect(isControlFileMissing(raw)).toBe(true);
    expect(friendlyAria2Error(raw)).toMatch(/new name/);
    expect(friendlyAria2Error(raw)).not.toContain('Shift At Midnight');
    expect(isControlFileMissing('Failed to write into the file')).toBe(false);
    expect(isControlFileMissing(undefined)).toBe(false);
  });
});

describe('a link Lumina could not read because the site would not answer', () => {
  // The two messages the same link produced on 2026-10-26 (the log, and the screenshot the owner sent).
  const timedOut = 'abc123def45: Unable to download webpage: Failed to perform, curl: (28) Connection timed out after 20010 milliseconds. See https://curl.se/libcurl/c/libcurl-errors.html first for more details. (caused by TransportError(\'Failed to perform, curl: (28) Connection timed out after 20010 milliseconds. See https://curl.se/libcurl/c/libcurl-errors.html first for more details.\'))';
  const reset = '[ExampleSite] abc123def45: Unable to download webpage: Failed to perform, curl: (35) Recv failure: Connection was reset. See https://curl.se/libcurl/c/libcurl-errors.html first for more details.';

  it('says the site timed out, how long it waited, and what to try, without the curl scaffolding', () => {
    const msg = friendlyYtdlpError(timedOut);
    expect(msg).toMatch(/timed out after 20 s/);
    expect(msg).toMatch(/blocked on your network/);
    expect(msg).toMatch(/Settings › Network/);
    for (const noise of ['curl', 'TransportError', 'caused by', 'abc123def45', 'libcurl']) expect(msg, noise).not.toContain(noise);
  });

  it('explains a reset connection as the usual look of a network block, and as possibly a glitch', () => {
    const msg = friendlyYtdlpError(reset);
    expect(msg).toMatch(/reset before the page arrived/);
    expect(msg).toMatch(/blocked on your network/);
    expect(msg).toMatch(/passing glitch/);
    expect(msg).not.toMatch(/curl|ExampleSite|libcurl/);
  });

  it('is still waited out as a lost connection, not given up on', () => {
    expect(classifyFailure(friendlyYtdlpError(timedOut))).toBe('network');
    expect(classifyFailure(friendlyYtdlpError(reset))).toBe('network');
  });

  it('puts the other curl codes into words and never shows a number-only message', () => {
    expect(friendlyYtdlpError('Failed to perform, curl: (6) Could not resolve host: x.invalid')).toMatch(/address couldn’t be looked up/);
    expect(friendlyYtdlpError('Failed to perform, curl: (7) Failed to connect')).toMatch(/refused the connection/);
    expect(friendlyYtdlpError('Failed to perform, curl: (60) SSL certificate problem')).toMatch(/certificate/);
    expect(friendlyYtdlpError('Failed to perform, curl: (99) odd')).toMatch(/curl error 99/);
  });

  it('strips the scaffolding from yt-dlp messages that are not curl errors too', () => {
    expect(tidyYtdlpMessage('[generic] abcdef12: Unable to download webpage: HTTP Error 500 (caused by HTTPError(500)); please report this issue on https://github.com/yt-dlp')).toBe('Unable to download webpage: HTTP Error 500');
    expect(tidyYtdlpMessage('Unsupported URL: https://example.com/x')).toBe('Unsupported URL: https://example.com/x');
  });
});

describe('links that need a different answer from "it failed"', () => {
  it('says a missing file is missing, in the words used for a 404 anywhere else', () => {
    // A 404 on a plain file link used to open the file-host click-through flow and wait for a person.
    expect(httpStatusMessage(404)).toMatch(/wasn’t found on the server \(404\)/);
    expect(httpStatusMessage(410)).toMatch(/\(410\)/);
    expect(httpStatusMessage(200)).toBeNull();
  });

  it('asks for a sign-in when a site says it only works logged in, instead of printing yt-dlp’s flags', () => {
    const vimeo = '1084537: The web client only works when logged-in. Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd or --netrc to provide account credentials';
    const msg = friendlyYtdlpError(vimeo);
    expect(msg).toMatch(/signed in/);
    expect(msg).toMatch(/Settings › Accounts/);
    expect(msg).not.toContain('--cookies');
  });
});

describe('telling the fast mode failing from the download failing', () => {
  it('flags only the aria2c accelerator’s own failure for an automatic single-connection retry', () => {
    expect(isAcceleratorFailure('ERROR: aria2c exited with code 22')).toBe(true);
    expect(isAcceleratorFailure('ERROR: [youtube] abc: Sign in to confirm you’re not a bot')).toBe(false);
    expect(isAcceleratorFailure('HTTP Error 403: Forbidden')).toBe(false);
  });
});
