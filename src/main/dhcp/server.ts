// A DHCP service for one cable.
//
// Why this exists: "Share to TV" needs a network, and a television with an Ethernet port and no
// router has one — a cable straight to the computer — that simply has nobody handing out addresses.
// Windows self-assigns a link-local address (169.254/16) on such a link; the television waits for a
// DHCP server, never gets one, reports "no network", and never looks for a media server. One
// missing service, not a missing capability. See `src/core/dhcp.ts` for the wire format.
//
// **The safety rule that shapes this file:** a DHCP server let loose on a real network hands out
// addresses that fight the router and breaks other people's devices. So this refuses to run unless
// the interface it would serve holds a **link-local** address. That is not a heuristic — Windows
// self-assigns 169.254/16 only when it asked for a lease and nothing answered, which is precisely
// the case where nothing else is serving DHCP. On any network with a router, this stays off.
import dgram from 'node:dgram';
import os from 'node:os';
import {
  DHCP_ACK, DHCP_DISCOVER, DHCP_OFFER, DHCP_REQUEST,
  buildDiscover, buildReply, isOfferFor, offerAddressFor, parseDhcp, rankLinkCandidates,
  type LinkCandidate,
} from '../../core/dhcp';
import { logger } from '../log';

const log = logger('dhcp');

/** Clients listen on 68; servers on 67. */
const SERVER_PORT = 67;
const CLIENT_PORT = 68;
const LEASE_SECONDS = 3600;
/** Link-local is a /16, which is what Windows self-assigns. */
const SUBNET_MASK = '255.255.0.0';

export interface DirectLinkStatus {
  running: boolean;
  /** Our address on the cable — also the address the TV will reach Lumina on. */
  serverIp: string | null;
  /** Televisions that have taken a lease, newest first. */
  clients: { mac: string; ip: string; hostname: string | null; since: number }[];
  error: string | null;
}

let socket: dgram.Socket | null = null;
let status: DirectLinkStatus = { running: false, serverIp: null, clients: [], error: null };
const leases = new Map<string, { ip: string; hostname: string | null; since: number }>();
let publish: () => void = () => {};

export const directLinkStatus = (): DirectLinkStatus => ({ ...status, clients: [...status.clients] });
export const onDirectLinkChange = (fn: () => void) => { publish = fn; };

const refreshClients = () => {
  status = {
    ...status,
    clients: [...leases.entries()]
      .map(([mac, l]) => ({ mac, ip: l.ip, hostname: l.hostname, since: l.since }))
      .sort((a, b) => b.since - a.since),
  };
};

/** Links that might be a cable to a television, best first. */
export function directLinkCandidates(): LinkCandidate[] {
  const flat: { name: string; address: string; family: string; internal: boolean }[] = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const a of addresses ?? []) flat.push({ name, address: a.address, family: a.family, internal: a.internal });
  }
  return rankLinkCandidates(flat);
}

/**
 * Ask the link whether a DHCP server already answers, and wait briefly for a reply.
 *
 * **A "no" here is not proof, and must never be treated as one.** On Windows the DHCP Client
 * service owns port 68, so an OFFER meant for this machine is delivered to it and not to us: a
 * probe run on a network that demonstrably has a router came back with no answer at all. What this
 * is good for is the other direction — if something *does* answer, there is certainly a DHCP server
 * here and Lumina must stand down.
 *
 * The guard that actually protects other people's networks is therefore the person choosing the
 * adapter (see `startDirectLink`), narrowed to link-local adapters only. An earlier version picked
 * one automatically on the strength of its link-local address; the development machine promptly
 * produced two such adapters belonging to VMware, where VMware's own DHCP service lives.
 */
export async function someoneElseServesDhcp(timeoutMs = 2500): Promise<boolean> {
  const xid = (Math.random() * 0xffffffff) >>> 0;
  const probe = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  return await new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (answer: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      probe.close(() => resolve(answer));
    };
    const timer = setTimeout(() => finish(false), timeoutMs);

    probe.on('error', () => finish(false));
    probe.on('message', (msg) => {
      if (isOfferFor(new Uint8Array(msg), xid)) {
        log.info('Another DHCP server answered on this link — standing down');
        finish(true);
      }
    });
    probe.bind(CLIENT_PORT, () => {
      try {
        probe.setBroadcast(true);
        probe.send(Buffer.from(buildDiscover(xid, '02:00:4c:55:4d:00')), SERVER_PORT, '255.255.255.255');
      } catch {
        finish(false);
      }
    });
  });
}

function handle(msg: Buffer, serverIp: string) {
  const req = parseDhcp(new Uint8Array(msg));
  if (!req || req.messageType === null) return;
  if (req.messageType !== DHCP_DISCOVER && req.messageType !== DHCP_REQUEST) return;

  const offered = offerAddressFor(serverIp, req.mac);
  if (!offered) return;

  // A REQUEST naming a different server is the client accepting someone else's offer. Staying quiet
  // matters: if anything else ever is serving this link, we must not argue with it.
  if (req.messageType === DHCP_REQUEST && req.serverId && req.serverId !== serverIp) {
    leases.delete(req.mac);
    refreshClients();
    publish();
    return;
  }

  const type = req.messageType === DHCP_DISCOVER ? DHCP_OFFER : DHCP_ACK;
  const reply = buildReply({
    type, xid: req.xid, clientIp: offered, serverIp, subnetMask: SUBNET_MASK,
    leaseSeconds: LEASE_SECONDS, mac: req.mac,
  });

  // Broadcast, always. The client has no address yet, so a unicast reply would need an ARP entry
  // for an address it has not accepted — which is why DHCP clients set the broadcast flag.
  socket?.send(Buffer.from(reply), CLIENT_PORT, '255.255.255.255', (err) => {
    if (err) log.debug(`Reply to ${req.mac} failed: ${err.message}`);
  });

  if (type === DHCP_ACK) {
    const existing = leases.get(req.mac);
    leases.set(req.mac, {
      ip: offered,
      hostname: req.hostname ?? existing?.hostname ?? null,
      since: existing?.since ?? Date.now(),
    });
    refreshClients();
    publish();
    log.info(`Gave ${req.hostname ?? req.mac} the address ${offered}`);
  }
}

/**
 * Start serving addresses on a direct cable.
 *
 * Returns the resulting status rather than throwing: "there is no cable" is an ordinary answer, not
 * an error, and the UI has to be able to say so.
 */
export async function startDirectLink(interfaceName: string): Promise<DirectLinkStatus> {
  await stopDirectLink();

  const candidates = directLinkCandidates();
  if (candidates.length === 0) {
    status = {
      running: false,
      serverIp: null,
      clients: [],
      error: 'No direct connection found. Plug an Ethernet cable from this computer straight into the TV — this only works on a link with no router on it.',
    };
    publish();
    return directLinkStatus();
  }

  // The adapter is never chosen automatically. Serving addresses on the wrong one would hand them
  // to somebody else's network, and no amount of name-matching is worth that risk.
  const chosen = candidates.find((c) => c.name === interfaceName);
  if (!chosen) {
    status = {
      running: false,
      serverIp: null,
      clients: [],
      error: `"${interfaceName}" isn't a direct connection any more. Pick the adapter the TV cable is plugged into.`,
    };
    publish();
    return directLinkStatus();
  }
  const serverIp = chosen.address;

  // Never become a second DHCP server on a link that already has one.
  if (await someoneElseServesDhcp()) {
    status = {
      running: false,
      serverIp: null,
      clients: [],
      error: 'Something on this connection already hands out addresses, so Lumina left it alone. This is only for a cable straight from this computer to the TV.',
    };
    publish();
    return directLinkStatus();
  }

  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket = sock;

  sock.on('error', (err) => {
    status = { ...status, running: false, error: err.message };
    log.warn(`Could not serve addresses: ${err.message}`);
    publish();
  });
  sock.on('message', (msg) => {
    try {
      handle(msg, serverIp);
    } catch (err) {
      log.debug(`Bad packet ignored: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    sock.once('error', done);
    sock.bind(SERVER_PORT, () => {
      try {
        sock.setBroadcast(true);
      } catch (err) {
        log.debug(`Broadcast could not be enabled: ${err instanceof Error ? err.message : String(err)}`);
      }
      status = { running: true, serverIp, clients: [], error: null };
      log.info(`Serving addresses on ${serverIp} for a directly connected TV`);
      publish();
      done();
    });
  });

  return directLinkStatus();
}

export async function stopDirectLink(): Promise<DirectLinkStatus> {
  if (socket) {
    await new Promise<void>((resolve) => socket?.close(() => resolve()));
    socket = null;
    log.info('Stopped serving addresses');
  }
  leases.clear();
  status = { running: false, serverIp: null, clients: [], error: null };
  publish();
  return directLinkStatus();
}
