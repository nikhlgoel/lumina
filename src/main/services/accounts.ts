import { BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import type { CapturedCookie } from '../../shared/types';
import { cookieUrl, hasLiveSession, loginCookies, type LoginSite } from '../../core/accountCookies';
import { accountCookiesFile, writeNetscapeCookies } from '../request';
import { settings } from '../settings';
import { logger } from '../log';

const log = logger('accounts');
const PARTITION = 'persist:lumina-accounts';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export const SIGN_IN_TARGETS = {
  youtube: { label: 'YouTube', url: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F', domains: ['youtube.com', 'google.com'] },
} as const;

export interface SiteAccount {
  domain: string;
  cookies: number;
  signedIn: boolean;
}

const accountSession = () => session.fromPartition(PARTITION);

/** Export every cookie from Lumina's sign-in browser to the cookie file yt-dlp uses. */
async function exportCookies(): Promise<number> {
  const all = await accountSession().cookies.get({});
  const cookies: CapturedCookie[] = all.map((c) => ({
    name: c.name, value: c.value, domain: c.domain ?? '', path: c.path ?? '/', secure: Boolean(c.secure), httpOnly: Boolean(c.httpOnly), expirationDate: c.expirationDate,
  }));
  writeNetscapeCookies(accountCookiesFile(), cookies);
  return cookies.length;
}

/**
 * Take a site's sign-in from the person's own browser (the extension handed the cookies over when they pressed its button).
 *
 * This is the way to sign in to Google, which refuses to sign anyone in inside an embedded window like the one below. The cookies go into
 * the same store a sign-in window uses, so listing, signing out and the cookie file yt-dlp reads all work as they already do.
 */
export async function importBrowserCookies(site: LoginSite, cookies: CapturedCookie[]): Promise<{ saved: number; signedIn: boolean }> {
  const chosen = loginCookies(cookies, site);
  if (!hasLiveSession(chosen, site)) return { saved: 0, signedIn: false };
  const store = accountSession();
  let saved = 0;
  for (const c of chosen) {
    try {
      await store.cookies.set({
        url: cookieUrl(c), name: c.name, value: c.value, domain: c.domain, path: c.path || '/', secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate,
      });
      saved++;
    } catch (err) {
      log.debug(`A cookie from the browser was not accepted: ${c.name}`, err);
    }
  }
  await exportCookies();
  if (settings.get().network.cookiesFrom !== 'lumina') settings.update({ network: { cookiesFrom: 'lumina' } });
  log.info(`Took ${saved} of ${chosen.length} ${site} cookies from the browser`);
  return { saved, signedIn: saved > 0 };
}

/**
 * Open a normal sign-in page in a private Lumina browser window.
 * When it closes, the session's cookies are saved so downloads run as that account.
 */
export function signIn(parent: BrowserWindow | null, target: string): Promise<SiteAccount[]> {
  const preset = SIGN_IN_TARGETS[target as keyof typeof SIGN_IN_TARGETS];
  const url = preset?.url ?? target;
  if (!/^https:\/\//i.test(url)) return Promise.reject(new Error('Enter the site’s full https:// address.'));

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 980, height: 760, parent: parent ?? undefined, title: `Sign in${preset ? ` to ${preset.label}` : ''} · Lumina`, autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    // Sign-in pages reject embedded browsers; present as regular Chrome.
    win.webContents.setUserAgent(CHROME_UA);
    win.webContents.setWindowOpenHandler(({ url: popup }) => {
      void win.loadURL(popup);
      return { action: 'deny' };
    });
    win.on('closed', () => {
      exportCookies()
        .then(async (count) => {
          log.info(`Saved ${count} cookies from sign-in window`);
          if (count > 0 && settings.get().network.cookiesFrom !== 'lumina') settings.update({ network: { cookiesFrom: 'lumina' } });
          resolve(await listAccounts());
        })
        .catch(reject);
    });
    void win.loadURL(url);
  });
}

/** Sites with saved sign-in cookies. A site counts as signed in when it has a long-lived session cookie. */
export async function listAccounts(): Promise<SiteAccount[]> {
  const all = await accountSession().cookies.get({});
  const byDomain = new Map<string, { cookies: number; signedIn: boolean }>();
  const now = Date.now() / 1000;
  for (const c of all) {
    const domain = (c.domain ?? '').replace(/^\./, '').split('.').slice(-2).join('.');
    if (!domain) continue;
    const entry = byDomain.get(domain) ?? { cookies: 0, signedIn: false };
    entry.cookies++;
    if (/^(SID|SAPISID|__Secure-3PSID|sp_dc|sessionid|session|auth|token)/i.test(c.name) && (!c.expirationDate || c.expirationDate > now)) entry.signedIn = true;
    byDomain.set(domain, entry);
  }
  return [...byDomain.entries()].filter(([, v]) => v.signedIn).map(([domain, v]) => ({ domain, ...v }));
}

export async function signOut(domain: string) {
  const s = accountSession();
  const cookies = await s.cookies.get({});
  await Promise.all(cookies
    .filter((c) => (c.domain ?? '').replace(/^\./, '').endsWith(domain))
    .map((c) => s.cookies.remove(`http${c.secure ? 's' : ''}://${(c.domain ?? '').replace(/^\./, '')}${c.path ?? '/'}`, c.name)));
  await s.clearStorageData({ origin: `https://${domain}` }).catch(() => undefined);
  await exportCookies();
  if (!(await listAccounts()).length && fs.existsSync(accountCookiesFile())) fs.rmSync(accountCookiesFile(), { force: true });
}
