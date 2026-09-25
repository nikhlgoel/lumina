// Handing a television an IP address over a direct cable.
//
// The problem this solves: DLNA needs a network, and plenty of people have a TV with an Ethernet
// port and no router to plug it into. A cable straight from the computer to the television *is* a
// network — two machines, one link — but nothing on it hands out addresses, so the TV decides it
// has "no network" and never goes looking for a media server. That is one missing service, not a
// missing capability.
//
// So Lumina provides the service. Windows already self-assigns a link-local address (169.254/16) on
// a cable with no DHCP server, so offering the television an address in that same range needs no
// elevation, no change to the computer's own network settings, and no router: both ends land on one
// subnet and SSDP multicast reaches across it.
//
// This file is the wire format only — RFC 2131 frames in, frames out — so every field is testable
// without a socket. The socket lives in `src/main/dhcp/server.ts`.

/** BOOTP opcodes. */
export const BOOT_REQUEST = 1;
export const BOOT_REPLY = 2;

/** DHCP message types (option 53). */
export const DHCP_DISCOVER = 1;
export const DHCP_OFFER = 2;
export const DHCP_REQUEST = 3;
export const DHCP_DECLINE = 4;
export const DHCP_ACK = 5;
export const DHCP_NAK = 6;

/** Options this server reads or writes. */
const OPT_SUBNET_MASK = 1;
const OPT_HOSTNAME = 12;
const OPT_REQUESTED_IP = 50;
const OPT_LEASE_TIME = 51;
const OPT_MESSAGE_TYPE = 53;
const OPT_SERVER_ID = 54;
const OPT_END = 255;

const MAGIC_COOKIE = 0x63825363;
/** 236 bytes of fixed BOOTP header, then the cookie, then the options. */
const OPTIONS_START = 240;

export interface DhcpRequest {
  op: number;
  /** Transaction id, echoed back so the client can match the reply to its request. */
  xid: number;
  /** Client hardware address, lower-case hex with colons. */
  mac: string;
  /** Option 53. Null when the frame carries none, which makes it plain BOOTP rather than DHCP. */
  messageType: number | null;
  /** Option 50 — the address the client is asking to keep. Dotted quad. */
  requestedIp: string | null;
  /** Option 54 — which server the client is answering. Dotted quad. */
  serverId: string | null;
  /** Option 12, stripped of the padding some clients send. */
  hostname: string | null;
  /** True when the client wants the reply broadcast rather than unicast. */
  broadcast: boolean;
}

export const ipToBytes = (ip: string): number[] => {
  const parts = ip.split('.');
  if (parts.length !== 4) return [0, 0, 0, 0];
  return parts.map((p) => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255 ? n : 0;
  });
};

export const bytesToIp = (b: ArrayLike<number>, at = 0): string =>
  `${b[at] ?? 0}.${b[at + 1] ?? 0}.${b[at + 2] ?? 0}.${b[at + 3] ?? 0}`;

const macOf = (b: Uint8Array, len: number): string =>
  Array.from(b.slice(28, 28 + Math.min(Math.max(len, 0), 16)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join(':');

/**
 * Read a DHCP frame. Returns null for anything that is not one — a stray packet on port 67, a
 * truncated frame, a reply rather than a request — so every datagram can safely be handed to it.
 */
export function parseDhcp(buf: Uint8Array): DhcpRequest | null {
  if (buf.length < OPTIONS_START) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(236) !== MAGIC_COOKIE) return null;
  if (buf[0] !== BOOT_REQUEST) return null;

  let messageType: number | null = null;
  let requestedIp: string | null = null;
  let serverId: string | null = null;
  let hostname: string | null = null;

  // Options are a tag/length/value walk. A malformed length must not run off the end.
  for (let i = OPTIONS_START; i < buf.length; ) {
    const tag = buf[i]!;
    if (tag === OPT_END) break;
    // Tag 0 is padding, and carries no length byte.
    if (tag === 0) { i += 1; continue; }
    const len = buf[i + 1];
    if (len === undefined || i + 2 + len > buf.length) break;
    const value = buf.slice(i + 2, i + 2 + len);
    if (tag === OPT_MESSAGE_TYPE && len >= 1) messageType = value[0]!;
    else if (tag === OPT_REQUESTED_IP && len >= 4) requestedIp = bytesToIp(value);
    else if (tag === OPT_SERVER_ID && len >= 4) serverId = bytesToIp(value);
    else if (tag === OPT_HOSTNAME && len >= 1) {
      hostname = new TextDecoder().decode(value).replace(/\0+$/, '').trim() || null;
    }
    i += 2 + len;
  }

  return {
    op: buf[0]!,
    xid: view.getUint32(4),
    mac: macOf(buf, buf[2] ?? 6),
    messageType,
    requestedIp,
    serverId,
    hostname,
    broadcast: (view.getUint16(10) & 0x8000) !== 0,
  };
}

export interface ReplyOptions {
  /** OFFER or ACK. */
  type: number;
  xid: number;
  /** The address being given to the client. */
  clientIp: string;
  /** This server's address on the link. */
  serverIp: string;
  subnetMask: string;
  leaseSeconds: number;
  /** The client's hardware address, copied back verbatim. */
  mac: string;
}

/**
 * Build an OFFER or an ACK.
 *
 * Deliberately minimal: an address, a mask and a lease, and **no router or DNS option**. On a cable
 * with nothing but a computer and a television there is no route anywhere and no resolver, and a TV
 * handed a default gateway that black-holes traffic can sit forever on an internet check that will
 * never pass. Saying nothing is more honest than pointing it at a dead end.
 */
export function buildReply(o: ReplyOptions): Uint8Array {
  const buf = new Uint8Array(300);
  const view = new DataView(buf.buffer);

  buf[0] = BOOT_REPLY;
  buf[1] = 1; // Ethernet
  buf[2] = 6; // hardware address length
  view.setUint32(4, o.xid >>> 0);

  buf.set(ipToBytes(o.clientIp), 16); // yiaddr — the address being handed out
  buf.set(ipToBytes(o.serverIp), 20); // siaddr

  const mac = o.mac.split(':').map((h) => parseInt(h, 16) & 0xff);
  buf.set(mac.slice(0, 16), 28);

  view.setUint32(236, MAGIC_COOKIE);

  let i = OPTIONS_START;
  const put = (tag: number, bytes: number[]) => {
    buf[i++] = tag;
    buf[i++] = bytes.length;
    buf.set(bytes, i);
    i += bytes.length;
  };

  put(OPT_MESSAGE_TYPE, [o.type]);
  put(OPT_SERVER_ID, ipToBytes(o.serverIp));
  put(OPT_SUBNET_MASK, ipToBytes(o.subnetMask));
  const lease = Math.max(60, Math.floor(o.leaseSeconds));
  put(OPT_LEASE_TIME, [(lease >>> 24) & 0xff, (lease >>> 16) & 0xff, (lease >>> 8) & 0xff, lease & 0xff]);
  buf[i++] = OPT_END;

  return buf.slice(0, Math.max(i, OPTIONS_START));
}

/**
 * The address to offer a client, derived from this machine's own address on the link.
 *
 * One address, derived rather than counted up from a pool: a direct cable has exactly two ends, so
 * a pool would be pretending. Keeping the television inside the prefix the computer already
 * self-assigned is the whole trick — no elevation, no reconfiguring the computer's network.
 *
 * The host part comes from the client's MAC so the same television is offered the same address
 * every time it reconnects, which stops a TV that cached its old lease from arguing with us.
 */
export function offerAddressFor(serverIp: string, mac: string): string | null {
  const parts = serverIp.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  const [a, b, c, d] = parts as [number, number, number, number];

  const hash = mac.split(':').reduce((acc, h) => (acc * 31 + (parseInt(h, 16) || 0)) >>> 0, 7);
  let third = (hash >>> 8) & 0xff;
  let fourth = hash & 0xff;

  // .0 is the subnet address and .255 the broadcast address; neither can be handed out.
  if (fourth === 0) fourth = 2;
  if (fourth === 255) fourth = 254;

  // 169.254.0.x and 169.254.255.x are reserved by RFC 3927.
  if (a === 169 && b === 254) {
    if (third === 0) third = 1;
    if (third === 255) third = 254;
  }

  // Never hand out the address this machine is already using.
  if (third === c && fourth === d) fourth = fourth === 254 ? 253 : fourth + 1;

  return `${a}.${b}.${third}.${fourth}`;
}

/** Is this an address a direct cable would have self-assigned? */
export const isLinkLocal = (ip: string): boolean => /^169\.254\./.test(ip);

/* ---------- Choosing which link to serve ---------- */

/**
 * Does this adapter name belong to a virtualisation or tunnelling product rather than a cable?
 *
 * This matters more than it looks. A link-local address was very nearly used on its own as proof
 * that "nothing is serving DHCP on this link" — and the development machine promptly showed two of
 * them belonging to VMware adapters, where VMware's own DHCP service lives. Serving addresses there
 * would have fought it. Name matching is only a ranking hint, never a safety guarantee; the guard
 * that actually protects the network is asking the link whether a DHCP server already answers.
 */
export function looksVirtual(name: string): boolean {
  return /vmware|virtualbox|vbox|hyper-v|vethernet|wsl|loopback|tap-|tunnel|zerotier|tailscale|wintun|openvpn|npcap|bluetooth/i.test(name);
}

export interface LinkCandidate {
  name: string;
  address: string;
  /** Almost certainly not a cable to a television. Kept, but ranked last and flagged in the UI. */
  virtual: boolean;
}

/**
 * Candidate links for a directly connected television, best first.
 *
 * Link-local only: an adapter with a routable address already has a DHCP server behind it, and this
 * service has no business on such a network.
 */
export function rankLinkCandidates(
  interfaces: { name: string; address: string; family: string; internal: boolean }[],
): LinkCandidate[] {
  return interfaces
    .filter((i) => i.family === 'IPv4' && !i.internal && isLinkLocal(i.address))
    .map((i) => ({ name: i.name, address: i.address, virtual: looksVirtual(i.name) }))
    .sort((a, b) => Number(a.virtual) - Number(b.virtual) || a.name.localeCompare(b.name));
}

/** A DISCOVER used to ask a link whether anything is already serving DHCP on it. */
export function buildDiscover(xid: number, mac: string): Uint8Array {
  const buf = new Uint8Array(300);
  const view = new DataView(buf.buffer);
  buf[0] = BOOT_REQUEST;
  buf[1] = 1;
  buf[2] = 6;
  view.setUint32(4, xid >>> 0);
  view.setUint16(10, 0x8000); // ask for a broadcast reply; we have no address to receive unicast on
  buf.set(mac.split(':').map((h) => parseInt(h, 16) & 0xff).slice(0, 16), 28);
  view.setUint32(236, MAGIC_COOKIE);
  let i = OPTIONS_START;
  buf[i++] = OPT_MESSAGE_TYPE;
  buf[i++] = 1;
  buf[i++] = DHCP_DISCOVER;
  buf[i++] = OPT_END;
  return buf.slice(0, Math.max(i, OPTIONS_START));
}

/** Is this datagram an OFFER from some other DHCP server, answering our probe? */
export function isOfferFor(buf: Uint8Array, xid: number): boolean {
  if (buf.length < OPTIONS_START) return false;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(236) !== MAGIC_COOKIE) return false;
  if (buf[0] !== BOOT_REPLY) return false;
  if (view.getUint32(4) !== (xid >>> 0)) return false;
  for (let i = OPTIONS_START; i < buf.length; ) {
    const tag = buf[i]!;
    if (tag === OPT_END) break;
    if (tag === 0) { i += 1; continue; }
    const len = buf[i + 1];
    if (len === undefined || i + 2 + len > buf.length) break;
    if (tag === OPT_MESSAGE_TYPE && len >= 1) return buf[i + 2] === DHCP_OFFER || buf[i + 2] === DHCP_ACK;
    i += 2 + len;
  }
  return false;
}
