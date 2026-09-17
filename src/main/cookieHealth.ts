// Reading cookies straight from a browser can be impossible on a given machine — Chrome's
// App-Bound Encryption, a locked cookie store, or a missing keyring. Once we've seen that fail
// this session, skip the doomed first attempt on later downloads and inspections instead of
// failing and retrying every single time.

let unreadable = false;

export const browserCookiesUnreadable = (): boolean => unreadable;
export const markBrowserCookiesUnreadable = (): void => {
  unreadable = true;
};
