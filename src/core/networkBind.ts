// Downloading over more than one network connection at once (say Wi-Fi and Ethernet, each with its own internet line).
//
// aria2 does the work: `--multiple-interface=A,B` "splits requests among the interfaces to achieve link aggregation", and
// `--interface=A` pins every socket to one. Lumina only has to hand it the right addresses.
//
// Addresses, not adapter names: a name can be translated, renamed or shared by two adapters, an IPv4 address is exact. The list is
// checked here because it ends up on a command line.

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** Is this a plain IPv4 address (the only thing a bind entry may be)? */
export const isBindAddress = (s: string): boolean => IPV4.test(s);

/** The usable entries of a saved list: valid, no duplicates, in order, at most 8. */
export function cleanBindList(list: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of list ?? []) {
    const s = String(raw).trim();
    if (isBindAddress(s) && !out.includes(s)) out.push(s);
    if (out.length === 8) break;
  }
  return out;
}

/**
 * The aria2 argument for a saved list, or null when it should do nothing.
 * One address pins everything to that connection; two or more share the downloads between them.
 */
export function bindArg(list: readonly string[] | undefined): string | null {
  const l = cleanBindList(list);
  if (l.length === 0) return null;
  return l.length === 1 ? `--interface=${l[0]}` : `--multiple-interface=${l.join(',')}`;
}

/**
 * How many of aria2's connection slots each line should get, in proportion to how fast it measured.
 *
 * aria2 deals its connections out to the listed addresses in turn, so listing a line twice gives it twice as many. Equal shares
 * are wrong for lines of different speed: measured on a 34 MB/s tether and a 2 MB/s Wi-Fi, five of eight connections went to the
 * slow one and the pair came out 5% SLOWER than the tether alone. A line under 5% of the total is not worth a connection.
 * Nothing measured (all zero) means equal shares, the old behaviour.
 */
export function weightedBindList(addresses: readonly string[], speedsBps: readonly number[], slots = 8): string[] {
  const a = cleanBindList(addresses);
  if (a.length < 2) return a;
  const speed = a.map((_, i) => Math.max(0, Number(speedsBps[i]) || 0));
  const total = speed.reduce((x, y) => x + y, 0);
  if (total <= 0) return a;
  const kept = speed.map((s) => (s / total >= 0.05 ? s : 0));
  const keptTotal = kept.reduce((x, y) => x + y, 0);
  const counts = kept.map((s) => (s > 0 ? Math.max(1, Math.round((s / keptTotal) * slots)) : 0));
  // Rounding can leave the sum off the slot count; correct it on the fastest line.
  const fastest = kept.indexOf(Math.max(...kept));
  counts[fastest] = Math.max(1, counts[fastest]! + (slots - counts.reduce((x, y) => x + y, 0)));
  const out: string[] = [];
  // Interleaved (A,B,A,A,B...) so connections are dealt out evenly in time, not all of one line first.
  for (let round = 0; out.length < counts.reduce((x, y) => x + y, 0); round++) {
    for (let i = 0; i < a.length; i++) if (round < counts[i]!) out.push(a[i]!);
  }
  return out;
}

/** The aria2 argument for a list that may repeat an address to weight it; a single distinct address pins everything to it. */
export function bindArgFromSlots(slots: readonly string[]): string | null {
  const l = slots.filter(isBindAddress);
  if (l.length === 0) return null;
  const distinct = [...new Set(l)];
  return distinct.length === 1 ? `--interface=${distinct[0]}` : `--multiple-interface=${l.join(',')}`;
}

export interface LocalAddress {
  /** Adapter name as Windows or the OS shows it, e.g. "Wi-Fi". */
  name: string;
  address: string;
  /** Link-local (169.254.x.x): the adapter has no real network. Listed, but not offered by default. */
  linkLocal: boolean;
  /** A virtual adapter (VMware, Hyper-V/WSL, VirtualBox, VPN tunnels): usually a private network with no internet behind it. */
  virtual: boolean;
}

const VIRTUAL_NAME = /vmware|vmnet|virtualbox|vbox|hyper-v|vethernet|wsl|docker|loopback|bluetooth|tap-|tunnel|vpn/i;

/** Turn os.networkInterfaces() into the addresses worth offering: IPv4, not loopback. */
export function offerableAddresses(
  ifaces: Record<string, ReadonlyArray<{ address: string; family: string | number; internal: boolean }> | undefined>,
): LocalAddress[] {
  const out: LocalAddress[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const a of list ?? []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (!v4 || a.internal || !isBindAddress(a.address)) continue;
      out.push({ name, address: a.address, linkLocal: a.address.startsWith('169.254.'), virtual: VIRTUAL_NAME.test(name) });
    }
  }
  // Real connections first: a virtual one ticked by mistake sends part of every download into a network with no internet.
  return out.sort((x, y) => Number(x.virtual || x.linkLocal) - Number(y.virtual || y.linkLocal));
}
