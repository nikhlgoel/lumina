// The DLNA/UPnP media server: what makes a television list **Lumina** next to HDMI and AV.
//
// Two sockets. A UDP multicast socket answers discovery (SSDP), and an HTTP server serves the
// device description, the ContentDirectory listings, and the media itself.
//
// SECURITY — read before changing anything here:
//   * **DLNA has no authentication. None.** Anyone who can reach this port can browse and play the
//     whole library. That is the protocol, not an oversight, and it is why this is OFF by default
//     and why the settings screen says so in plain words rather than burying it.
//   * A request can only ever name an **id from the library index**. Paths never come off the wire,
//     so there is nothing to traverse: an unknown id is a 404, full stop.
//   * The server binds to the LAN. Lumina never exposes it to the internet, but someone who
//     forwarded a port would be publishing their library — hence the warning in the UI.
//   * Nothing is writable. Every route is GET/HEAD apart from the SOAP control endpoints, which
//     only ever return listings.
import http from 'node:http';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { app } from 'electron';
import {
  CONNECTION_MANAGER_TYPE, CONTENT_DIRECTORY_TYPE, MEDIA_SERVER_TYPE, ROOT_DEVICE, SSDP_ADDRESS,
  SSDP_PORT, browseResponse, deviceDescription, deviceUuid, didlContainerXml, didlDocument,
  didlItemXml, escapeXml, mimeFor, parseBrowse, parseRange, parseSsdp, searchMatches,
  ssdpNotify, ssdpSearchResponse, type DidlItem,
} from '../../core/dlna';
import { coverPngFor } from '../coverArt';
import { library } from '../library';
import { settings } from '../settings';
import { logger } from '../log';

const log = logger('dlna');

/** Re-announce well before the 1800s cache expires, or a TV quietly drops us from its list. */
const REANNOUNCE_MS = 12 * 60 * 1000;

/** A TV asking for "everything" must not be handed 50,000 rows in one document. */
const MAX_PER_BROWSE = 500;

export interface DlnaStatus {
  running: boolean;
  /** The URL a TV fetches to learn about us — useful for diagnosing "it can't see me". */
  location: string | null;
  address: string | null;
  port: number;
  friendlyName: string;
  error: string | null;
}

type LibraryEntry = ReturnType<typeof library.items>[number];

let httpServer: http.Server | null = null;
let ssdpSocket: dgram.Socket | null = null;
let announceTimer: NodeJS.Timeout | null = null;
let status: DlnaStatus = {
  running: false, location: null, address: null, port: 8200,
  friendlyName: 'Lumina', error: null,
};

type Listener = (s: DlnaStatus) => void;
const listeners = new Set<Listener>();
export function onDlnaChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const publish = () => { for (const fn of listeners) fn({ ...status }); };

export const dlnaStatus = (): DlnaStatus => ({ ...status });

/* ---------- identity ---------- */

/**
 * A seed that survives restarts but differs between machines, so the UUID we advertise is stable.
 *
 * The hostname plus the app's own data directory is steady for an installation and distinct across
 * PCs, without adding a machine-id dependency.
 */
function stableSeed(): string {
  return createHash('sha1').update(`${os.hostname()}|${app.getPath('userData')}`).digest('hex');
}

/** The LAN address a TV can actually reach. Loopback is useless here — the TV is another machine. */
function lanAddress(): string | null {
  const candidates: string[] = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const a of addresses ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      candidates.push(a.address);
    }
  }
  // Prefer ordinary private ranges over anything odd a VPN may have added.
  return candidates.find((a) => /^(192\.168\.|10\.)/.test(a))
    ?? candidates.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a))
    ?? candidates[0]
    ?? null;
}

const serverTag = () => `${os.type()}/${os.release()} UPnP/1.0 Lumina/${app.getVersion()}`;

/* ---------- the library, as containers ---------- */

const MUSIC_ID = 'music';
const VIDEO_ID = 'video';

const itemsOf = (kind: 'audio' | 'video'): LibraryEntry[] => library.items({ kind });

/** Resolve an id from the wire back to a real file — the only way a path is ever chosen. */
function findById(id: string): LibraryEntry | null {
  for (const kind of ['audio', 'video'] as const) {
    const hit = itemsOf(kind).find((item) => item.id === id);
    if (hit) return hit;
  }
  return null;
}

function toDidl(item: LibraryEntry, base: string, parentId: string): DidlItem {
  return {
    id: item.id,
    parentId,
    title: item.title,
    kind: item.kind === 'video' ? 'video' : 'audio',
    url: `${base}/media/${item.id}`,
    mime: mimeFor(item.path),
    sizeBytes: null,
    durationSec: item.durationSec,
    artist: item.artist,
    album: item.album,
    albumArtUrl: `${base}/art/${item.id}`,
  };
}

/* ---------- HTTP ---------- */

const SCPD_CONTENT_DIRECTORY = `<?xml version="1.0" encoding="utf-8"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList>
    <action>
      <name>Browse</name>
      <argumentList>
        <argument><name>ObjectID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_ObjectID</relatedStateVariable></argument>
        <argument><name>BrowseFlag</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_BrowseFlag</relatedStateVariable></argument>
        <argument><name>Filter</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Filter</relatedStateVariable></argument>
        <argument><name>StartingIndex</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Index</relatedStateVariable></argument>
        <argument><name>RequestedCount</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable></argument>
        <argument><name>SortCriteria</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_SortCriteria</relatedStateVariable></argument>
        <argument><name>Result</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_Result</relatedStateVariable></argument>
        <argument><name>NumberReturned</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable></argument>
        <argument><name>TotalMatches</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable></argument>
        <argument><name>UpdateID</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_UpdateID</relatedStateVariable></argument>
      </argumentList>
    </action>
  </actionList>
  <serviceStateTable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_ObjectID</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_BrowseFlag</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_Filter</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_Index</name><dataType>ui4</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_Count</name><dataType>ui4</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_SortCriteria</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_Result</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_UpdateID</name><dataType>ui4</dataType></stateVariable>
  </serviceStateTable>
</scpd>`;

const SCPD_CONNECTION_MANAGER = `<?xml version="1.0" encoding="utf-8"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList>
    <action><name>GetProtocolInfo</name><argumentList>
      <argument><name>Source</name><direction>out</direction><relatedStateVariable>SourceProtocolInfo</relatedStateVariable></argument>
      <argument><name>Sink</name><direction>out</direction><relatedStateVariable>SinkProtocolInfo</relatedStateVariable></argument>
    </argumentList></action>
  </actionList>
  <serviceStateTable>
    <stateVariable sendEvents="yes"><name>SourceProtocolInfo</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="yes"><name>SinkProtocolInfo</name><dataType>string</dataType></stateVariable>
  </serviceStateTable>
</scpd>`;

function sendXml(res: http.ServerResponse, body: string, code = 200) {
  res.writeHead(code, {
    'Content-Type': 'text/xml; charset="utf-8"',
    'Content-Length': Buffer.byteLength(body),
    Connection: 'close',
  });
  res.end(body);
}

/** Build the listing for a container. */
export function browseContainer(
  objectId: string,
  start: number,
  count: number,
  base: string,
): { didl: string; returned: number; total: number } {
  if (objectId === '0') {
    const parts = [
      didlContainerXml({ id: MUSIC_ID, parentId: '0', title: 'Music', childCount: itemsOf('audio').length }),
      didlContainerXml({ id: VIDEO_ID, parentId: '0', title: 'Videos', childCount: itemsOf('video').length }),
    ];
    return { didl: didlDocument(parts), returned: parts.length, total: parts.length };
  }

  if (objectId !== MUSIC_ID && objectId !== VIDEO_ID) {
    // An item id, or something we don't know: return an empty listing rather than a SOAP fault,
    // which a TV renders as a confusing error instead of an empty folder.
    return { didl: didlDocument([]), returned: 0, total: 0 };
  }

  const kind = objectId === VIDEO_ID ? 'video' : 'audio';
  const all = itemsOf(kind);
  const limit = count > 0 ? Math.min(count, MAX_PER_BROWSE) : MAX_PER_BROWSE;
  const page = all.slice(start, start + limit);
  const parts = page.map((item) => didlItemXml(toDidl(item, base, objectId)));
  return { didl: didlDocument(parts), returned: parts.length, total: all.length };
}

function streamFile(req: http.IncomingMessage, res: http.ServerResponse, file: string) {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    res.writeHead(404).end();
    return;
  }

  const range = parseRange(req.headers.range, size);
  if (range === 'invalid') {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': mimeFor(file),
    'Accept-Ranges': 'bytes',
    // DLNA clients look for these; OP=01 means byte-seek is supported.
    'transferMode.dlna.org': 'Streaming',
    'contentFeatures.dlna.org': 'DLNA.ORG_OP=01',
  };

  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    headers['Content-Length'] = String(range.end - range.start + 1);
    res.writeHead(206, headers);
  } else {
    headers['Content-Length'] = String(size);
    res.writeHead(200, headers);
  }

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = range ? fs.createReadStream(file, { start: range.start, end: range.end }) : fs.createReadStream(file);
  // A TV that stops playback simply drops the socket; that is normal, not an error worth logging.
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, base: string, uuid: string) {
  const route = new URL(req.url ?? '/', base).pathname;

  if (route === '/description.xml') {
    sendXml(res, deviceDescription({ uuid, friendlyName: status.friendlyName, modelVersion: app.getVersion() }));
    return;
  }
  if (route === '/ContentDirectory.xml') return sendXml(res, SCPD_CONTENT_DIRECTORY);
  if (route === '/ConnectionManager.xml') return sendXml(res, SCPD_CONNECTION_MANAGER);

  // Eventing: we publish no changes, but a TV expects its SUBSCRIBE to be accepted.
  if (req.method === 'SUBSCRIBE' || req.method === 'UNSUBSCRIBE') {
    res.writeHead(200, { SID: `uuid:${uuid}`, TIMEOUT: 'Second-1800', Connection: 'close' }).end();
    return;
  }

  if (route === '/control/ContentDirectory' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
      // A Browse request is small; anything large is not one.
      if (body.length > 64 * 1024) req.destroy();
    });
    req.on('end', () => {
      const browse = parseBrowse(body);
      if (!browse) {
        sendXml(res, '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body/></s:Envelope>');
        return;
      }
      const { didl, returned, total } = browseContainer(browse.objectId, browse.startingIndex, browse.requestedCount, base);
      sendXml(res, browseResponse(didl, returned, total));
    });
    return;
  }

  if (route === '/control/ConnectionManager' && req.method === 'POST') {
    const source = 'http-get:*:video/mp4:*,http-get:*:audio/mpeg:*,http-get:*:audio/mp4:*,http-get:*:video/x-matroska:*';
    sendXml(res, '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>'
      + `<u:GetProtocolInfoResponse xmlns:u="${CONNECTION_MANAGER_TYPE}">`
      + `<Source>${escapeXml(source)}</Source><Sink></Sink>`
      + '</u:GetProtocolInfoResponse></s:Body></s:Envelope>');
    return;
  }

  // Only ids are accepted here — never a path — so there is nothing to traverse.
  const media = /^\/media\/([A-Za-z0-9]+)$/.exec(route);
  if (media) {
    const item = findById(media[1]!);
    if (!item) {
      res.writeHead(404).end();
      return;
    }
    streamFile(req, res, item.path);
    return;
  }

  const art = /^\/art\/([A-Za-z0-9]+)$/.exec(route);
  if (art) {
    const item = findById(art[1]!);
    if (!item) {
      res.writeHead(404).end();
      return;
    }
    // The same gradient the app draws, so a TV shows what Lumina shows.
    const png = coverPngFor(item.album ?? item.title);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, Connection: 'close' });
    if (req.method === 'HEAD') res.end();
    else res.end(png);
    return;
  }

  res.writeHead(404).end();
}

/* ---------- SSDP ---------- */

const advertTargets = (uuid: string): string[] =>
  [ROOT_DEVICE, `uuid:${uuid}`, MEDIA_SERVER_TYPE, CONTENT_DIRECTORY_TYPE, CONNECTION_MANAGER_TYPE];

interface Advert { uuid: string; location: string; serverTag: string }

function announce(nts: 'ssdp:alive' | 'ssdp:byebye', advert: Advert) {
  const socket = ssdpSocket;
  if (!socket) return;
  for (const target of advertTargets(advert.uuid)) {
    socket.send(Buffer.from(ssdpNotify(target, nts, advert)), SSDP_PORT, SSDP_ADDRESS, (err) => {
      if (err) log.debug(`Announce failed: ${err.message}`);
    });
  }
}

function startSsdp(uuid: string, location: string) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  ssdpSocket = socket;
  const advert: Advert = { uuid, location, serverTag: serverTag() };

  socket.on('error', (err) => {
    log.warn(`SSDP socket error: ${err.message}`);
    status.error = err.message;
    publish();
  });

  socket.on('message', (msg, rinfo) => {
    const request = parseSsdp(msg.toString('utf8'));
    if (!request || request.method !== 'M-SEARCH' || request.man !== 'ssdp:discover') return;
    const targets = searchMatches(request.st, uuid);
    if (targets.length === 0) return;

    // MX asks responders to spread replies over that many seconds so the network isn't flooded.
    const spread = Math.min(Math.max(request.mx ?? 1, 1), 5) * 1000;
    for (const target of targets) {
      setTimeout(() => {
        socket.send(Buffer.from(ssdpSearchResponse(target, advert)), rinfo.port, rinfo.address, (err) => {
          if (err) log.debug(`Reply to ${rinfo.address} failed: ${err.message}`);
        });
      }, Math.floor(Math.random() * spread));
    }
  });

  socket.bind(SSDP_PORT, () => {
    try {
      socket.addMembership(SSDP_ADDRESS);
      socket.setMulticastTTL(4);
    } catch (err) {
      log.warn(`Could not join the SSDP group: ${err instanceof Error ? err.message : String(err)}`);
    }
    announce('ssdp:alive', advert);
    announceTimer = setInterval(() => announce('ssdp:alive', advert), REANNOUNCE_MS);
  });
}

/* ---------- lifecycle ---------- */

/**
 * Start sharing, resolving only once the socket is actually listening.
 *
 * Returning before `listen` fired made the toggle report `running: false` for a server that was
 * already up — the UI then corrected itself a moment later via the change event, which looks like
 * a glitch.
 */
export async function startDlna(): Promise<DlnaStatus> {
  if (httpServer) return dlnaStatus();

  const s = settings.get().sharing;
  const address = lanAddress();
  status = {
    running: false,
    location: null,
    address,
    port: s.dlnaPort,
    friendlyName: s.dlnaName || `Lumina on ${os.hostname()}`,
    error: null,
  };

  if (!address) {
    status.error = 'No network connection was found, so a TV would have nothing to connect to.';
    publish();
    return dlnaStatus();
  }

  const uuid = deviceUuid(stableSeed());
  const base = `http://${address}:${s.dlnaPort}`;
  const location = `${base}/description.xml`;

  const server = http.createServer((req, res) => {
    try {
      handleRequest(req, res, base, uuid);
    } catch (err) {
      log.warn(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });

  server.on('error', (err) => {
    // "listen EADDRINUSE: address already in use :::8200" is accurate and useless. The one thing the
    // reader can do about it is on this very screen, so say that instead.
    const busy = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
    const message = busy
      ? `Port ${s.dlnaPort} is already used by another program on this PC. Change the port below, then switch sharing off and on again.`
      : err.message;
    status = { ...status, running: false, error: message };
    log.warn(`HTTP server error: ${err.message}`);
    publish();
  });

  httpServer = server;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    server.once('error', finish);
    server.listen(s.dlnaPort, () => {
      status = { ...status, running: true, location, error: null };
      log.info(`Sharing as "${status.friendlyName}" at ${location}`);
      startSsdp(uuid, location);
      publish();
      finish();
    });
  });

  return dlnaStatus();
}

export function stopDlna(): DlnaStatus {
  if (announceTimer) {
    clearInterval(announceTimer);
    announceTimer = null;
  }
  if (ssdpSocket) {
    // Tell the network we're going, so TVs drop us instead of showing a dead entry.
    announce('ssdp:byebye', { uuid: deviceUuid(stableSeed()), location: status.location ?? '', serverTag: serverTag() });
    try {
      ssdpSocket.close();
    } catch {
      // Already closed.
    }
    ssdpSocket = null;
  }
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  status = { ...status, running: false, location: null };
  log.info('Stopped sharing');
  publish();
  return dlnaStatus();
}

/** Start at launch only if the user turned it on. */
export function initDlna() {
  if (settings.get().sharing.dlnaEnabled) void startDlna();
}

export async function setDlnaEnabled(enabled: boolean): Promise<DlnaStatus> {
  settings.update({ sharing: { dlnaEnabled: enabled } });
  return enabled ? startDlna() : stopDlna();
}
