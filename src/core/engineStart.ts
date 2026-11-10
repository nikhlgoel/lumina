// Why the download engine (aria2) can fail to start, said in words, and what to change so that the next try works.
//
// A person who has just pressed Download cannot act on "aria2 exited (1)", and the commonest cause is one the app can undo itself:
// a saved network connection that is no longer there. aria2 refuses to start with it ("Failed to find given interface 10.190.179.5,
// cause: not available", measured against the bundled aria2c 1.37.0), and every download then failed until the setting was found.

export type StartFailureKind = 'interface' | 'port' | 'option' | 'unknown';

/** What to leave out or change on the next try. Each cure is cumulative. */
export interface StartFix {
  /** Ignore the chosen network connections and use the computer's normal one. */
  dropBind?: boolean;
  /** Take a free port for torrent traffic instead of the saved one. */
  otherPort?: boolean;
  /** Start with only the options a download cannot do without. */
  minimal?: boolean;
}

const INTERFACE = /failed to find given interface|interface .{0,40}not available|cannot assign requested address|EADDRNOTAVAIL/i;
// The port wording is aria2's and the operating system's (Windows says "Only one usage of each socket address"); it was not provoked here.
const PORT = /address already in use|failed to bind a socket|only one usage of each socket address|EADDRINUSE|failed to listen/i;
const OPTION = /unrecognized option|unknown option|invalid (?:value|argument|option)|bad (?:value|option)|option .{0,40}(?:must|requires)/i;

export function classifyStartFailure(output: string): { kind: StartFailureKind; plain: string } {
  // Order matters: a bind failure on a missing connection also says "failed to bind".
  if (INTERFACE.test(output)) return { kind: 'interface', plain: 'A saved network connection is not available right now, so Lumina used your normal connection instead.' };
  if (PORT.test(output)) return { kind: 'port', plain: 'The torrent port was already in use, so Lumina picked another one.' };
  if (OPTION.test(output)) return { kind: 'option', plain: 'A download setting was not accepted, so Lumina used the safe defaults.' };
  return { kind: 'unknown', plain: 'The download engine stopped as it started.' };
}

const same = (a: StartFix, b: StartFix) => Boolean(a.dropBind) === Boolean(b.dropBind) && Boolean(a.otherPort) === Boolean(b.otherPort) && Boolean(a.minimal) === Boolean(b.minimal);

/** The cure for the last failure, added to the ones already tried. A cure that changed nothing means it was no use: try them all. */
export function nextStartFix(prev: StartFix, kind: StartFailureKind): StartFix {
  const next: StartFix = { ...prev };
  if (kind === 'interface') next.dropBind = true;
  else if (kind === 'port') next.otherPort = true;
  else next.minimal = true;
  return same(next, prev) ? { dropBind: true, otherPort: true, minimal: true } : next;
}

/** What the person is told when every try failed. */
export const ENGINE_WILL_NOT_START =
  'The download engine could not start. Closing and reopening Lumina usually clears it; if it keeps happening, security software blocking the bundled aria2c.exe is one possible cause.';
