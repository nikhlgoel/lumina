// DLNA / UPnP AV, the pure half: building and parsing the protocol text.
//
// This is what makes a television list **Lumina** as a source next to HDMI and AV. Three protocols
// stacked on each other, and every one of them is picky in ways that are invisible until a TV
// silently ignores you:
//
//   * **SSDP** — discovery over UDP multicast. Plain HTTP-shaped text where the line endings must be
//     CRLF and the message must end with a blank line, or many devices drop it without a word.
//   * **SOAP/ContentDirectory** — the TV asks "what is in container 0?" and expects a DIDL-Lite XML
//     document *escaped inside* a SOAP response, i.e. XML within XML.
//   * **HTTP byte ranges** — how a TV seeks. Get this wrong and playback works but scrubbing doesn't.
//
// Nothing here opens a socket, so all of it is testable.

export const MEDIA_SERVER_TYPE = 'urn:schemas-upnp-org:device:MediaServer:1';
export const CONTENT_DIRECTORY_TYPE = 'urn:schemas-upnp-org:service:ContentDirectory:1';
export const CONNECTION_MANAGER_TYPE = 'urn:schemas-upnp-org:service:ConnectionManager:1';
export const ROOT_DEVICE = 'upnp:rootdevice';

/** SSDP's well-known multicast address and port. */
export const SSDP_ADDRESS = '239.255.255.250';
export const SSDP_PORT = 1900;

/** How long a control point may cache our announcement, in seconds. */
export const ADVERT_MAX_AGE = 1800;

const CRLF = '\r\n';

/**
 * A stable UUID for this installation.
 *
 * It must not change between runs: a TV remembers the UDN, and a new one every launch leaves a
 * list of dead "Lumina" entries. Derived from a caller-supplied stable seed (the machine id), so
 * two PCs on one network never collide.
 */
export function deviceUuid(seed: string): string {
  // FNV-1a over four salted copies is plenty to fill 128 bits deterministically.
  const hashOf = (text: string): number => {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  const hex = [0, 1, 2, 3].map((n) => hashOf(`lumina-dlna-${n}-${seed}`).toString(16).padStart(8, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    // Version 4 and the RFC 4122 variant bits, so the UUID is well-formed rather than merely random.
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/* ---------- SSDP ---------- */

export interface SsdpRequest {
  method: string;
  /** Search Target from an M-SEARCH, lower-cased. */
  st: string | null;
  /** MX, the seconds a responder should spread replies over. */
  mx: number | null;
  man: string | null;
}

/** Parse an SSDP datagram. Returns null for anything that isn't a request we understand. */
export function parseSsdp(text: string): SsdpRequest | null {
  const lines = text.split(/\r?\n/);
  const start = (lines[0] ?? '').trim();
  if (!start) return null;
  const method = start.split(/\s+/)[0]?.toUpperCase() ?? '';
  if (!method) return null;

  const headers = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }

  const mxRaw = headers.get('mx');
  const mx = mxRaw !== undefined && /^\d+$/.test(mxRaw) ? Number(mxRaw) : null;
  return {
    method,
    st: headers.get('st')?.toLowerCase() ?? null,
    // MAN is quoted in the wild: MAN: "ssdp:discover"
    man: headers.get('man')?.replace(/^"|"$/g, '').toLowerCase() ?? null,
    mx,
  };
}

/**
 * Should we answer this search?
 *
 * A TV may ask for everything (`ssdp:all`), for root devices, for a MediaServer, for the
 * ContentDirectory service, or for us by UUID. Anything else is somebody else's business.
 */
export function searchMatches(st: string | null, uuid: string): string[] {
  if (!st) return [];
  const target = st.trim().toLowerCase();
  const usn = `uuid:${uuid}`;
  if (target === 'ssdp:all') return [ROOT_DEVICE, usn, MEDIA_SERVER_TYPE, CONTENT_DIRECTORY_TYPE];
  if (target === ROOT_DEVICE) return [ROOT_DEVICE];
  if (target === usn.toLowerCase()) return [usn];
  if (target === MEDIA_SERVER_TYPE.toLowerCase()) return [MEDIA_SERVER_TYPE];
  if (target === CONTENT_DIRECTORY_TYPE.toLowerCase()) return [CONTENT_DIRECTORY_TYPE];
  return [];
}

/** USN for a given search target — how the device identifies itself for that target. */
export function usnFor(target: string, uuid: string): string {
  return target === `uuid:${uuid}` ? target : `uuid:${uuid}::${target}`;
}

export interface AdvertOptions {
  uuid: string;
  /** Absolute URL of the device description document. */
  location: string;
  serverTag: string;
}

/**
 * The reply to an M-SEARCH.
 *
 * CRLF throughout and a trailing blank line are not stylistic: devices that tolerate neither are
 * common, and the failure mode is silence rather than an error.
 */
export function ssdpSearchResponse(target: string, o: AdvertOptions): string {
  return [
    'HTTP/1.1 200 OK',
    `CACHE-CONTROL: max-age=${ADVERT_MAX_AGE}`,
    `DATE: ${new Date().toUTCString()}`,
    'EXT:',
    `LOCATION: ${o.location}`,
    `SERVER: ${o.serverTag}`,
    `ST: ${target}`,
    `USN: ${usnFor(target, o.uuid)}`,
    '',
    '',
  ].join(CRLF);
}

/** An unsolicited announcement: `alive` when starting, `byebye` when stopping. */
export function ssdpNotify(target: string, nts: 'ssdp:alive' | 'ssdp:byebye', o: AdvertOptions): string {
  const lines = [
    'NOTIFY * HTTP/1.1',
    `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
    `NT: ${target}`,
    `NTS: ${nts}`,
    `USN: ${usnFor(target, o.uuid)}`,
  ];
  // A byebye carries no location or lifetime — the device is going away.
  if (nts === 'ssdp:alive') {
    lines.splice(1, 0, `CACHE-CONTROL: max-age=${ADVERT_MAX_AGE}`);
    lines.push(`LOCATION: ${o.location}`, `SERVER: ${o.serverTag}`);
  }
  return [...lines, '', ''].join(CRLF);
}

/* ---------- XML ---------- */

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** The device description a TV fetches from LOCATION before it will show us. */
export function deviceDescription(o: { uuid: string; friendlyName: string; modelVersion: string }): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>${MEDIA_SERVER_TYPE}</deviceType>
    <friendlyName>${escapeXml(o.friendlyName)}</friendlyName>
    <manufacturer>Lumina</manufacturer>
    <modelName>Lumina Media Server</modelName>
    <modelNumber>${escapeXml(o.modelVersion)}</modelNumber>
    <UDN>uuid:${o.uuid}</UDN>
    <dlna:X_DLNADOC xmlns:dlna="urn:schemas-dlna-org:device-1-0">DMS-1.50</dlna:X_DLNADOC>
    <serviceList>
      <service>
        <serviceType>${CONTENT_DIRECTORY_TYPE}</serviceType>
        <serviceId>urn:upnp-org:serviceId:ContentDirectory</serviceId>
        <SCPDURL>/ContentDirectory.xml</SCPDURL>
        <controlURL>/control/ContentDirectory</controlURL>
        <eventSubURL>/event/ContentDirectory</eventSubURL>
      </service>
      <service>
        <serviceType>${CONNECTION_MANAGER_TYPE}</serviceType>
        <serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId>
        <SCPDURL>/ConnectionManager.xml</SCPDURL>
        <controlURL>/control/ConnectionManager</controlURL>
        <eventSubURL>/event/ConnectionManager</eventSubURL>
      </service>
    </serviceList>
  </device>
</root>`;
}

/* ---------- ContentDirectory ---------- */

export interface BrowseRequest {
  objectId: string;
  browseFlag: 'BrowseDirectChildren' | 'BrowseMetadata';
  startingIndex: number;
  requestedCount: number;
}

const tagText = (xml: string, tag: string): string | null => {
  // Namespace prefixes are optional and vary by device, hence the loose tag match.
  const m = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?${tag}>`).exec(xml);
  return m ? m[1]!.trim() : null;
};

/**
 * Read a ContentDirectory Browse call out of a SOAP body.
 *
 * Deliberately forgiving: implementations differ on namespaces and whitespace, and a TV that gets
 * a fault instead of a listing simply shows an empty folder with no explanation.
 */
export function parseBrowse(body: string): BrowseRequest | null {
  if (!/Browse/i.test(body)) return null;
  const count = Number(tagText(body, 'RequestedCount') ?? '0');
  const start = Number(tagText(body, 'StartingIndex') ?? '0');
  return {
    objectId: tagText(body, 'ObjectID') ?? '0',
    browseFlag: tagText(body, 'BrowseFlag') === 'BrowseMetadata' ? 'BrowseMetadata' : 'BrowseDirectChildren',
    startingIndex: Number.isFinite(start) && start > 0 ? Math.floor(start) : 0,
    // 0 means "everything" in the spec; keep it as 0 and let the caller decide a sane cap.
    requestedCount: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
  };
}

export interface DidlContainer {
  id: string;
  parentId: string;
  title: string;
  childCount: number;
}

export interface DidlItem {
  id: string;
  parentId: string;
  title: string;
  kind: 'audio' | 'video';
  /** Absolute URL a TV will GET. */
  url: string;
  mime: string;
  sizeBytes: number | null;
  durationSec: number | null;
  artist?: string | null;
  album?: string | null;
  /** Absolute URL of cover art, if there is any. */
  albumArtUrl?: string | null;
}

/** `HH:MM:SS.mmm`, the only duration format DLNA accepts. */
export function dlnaDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const ms = Math.round((seconds - whole) * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

/**
 * `protocolInfo`, which tells the TV how it may fetch this.
 *
 * `DLNA.ORG_OP=01` is the important part: it advertises byte-range seeking, without which many sets
 * refuse to let you scrub at all.
 */
export const protocolInfo = (mime: string): string => `http-get:*:${mime}:DLNA.ORG_OP=01`;

export function didlContainerXml(c: DidlContainer): string {
  return `<container id="${escapeXml(c.id)}" parentID="${escapeXml(c.parentId)}" restricted="1" childCount="${c.childCount}">`
    + `<dc:title>${escapeXml(c.title)}</dc:title>`
    + '<upnp:class>object.container.storageFolder</upnp:class>'
    + '</container>';
}

export function didlItemXml(item: DidlItem): string {
  const upnpClass = item.kind === 'video' ? 'object.item.videoItem' : 'object.item.audioItem.musicTrack';
  const duration = dlnaDuration(item.durationSec);
  const attrs = [
    `protocolInfo="${escapeXml(protocolInfo(item.mime))}"`,
    item.sizeBytes !== null ? `size="${item.sizeBytes}"` : null,
    duration ? `duration="${duration}"` : null,
  ].filter(Boolean).join(' ');

  return `<item id="${escapeXml(item.id)}" parentID="${escapeXml(item.parentId)}" restricted="1">`
    + `<dc:title>${escapeXml(item.title)}</dc:title>`
    + `<upnp:class>${upnpClass}</upnp:class>`
    + (item.artist ? `<upnp:artist>${escapeXml(item.artist)}</upnp:artist><dc:creator>${escapeXml(item.artist)}</dc:creator>` : '')
    + (item.album ? `<upnp:album>${escapeXml(item.album)}</upnp:album>` : '')
    + (item.albumArtUrl ? `<upnp:albumArtURI>${escapeXml(item.albumArtUrl)}</upnp:albumArtURI>` : '')
    + `<res ${attrs}>${escapeXml(item.url)}</res>`
    + '</item>';
}

/** Wrap containers and items in the DIDL-Lite document a TV expects. */
export function didlDocument(parts: string[]): string {
  return '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/"'
    + ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"'
    + ' xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">'
    + parts.join('')
    + '</DIDL-Lite>';
}

/** The SOAP envelope carrying a Browse result. The DIDL document goes in escaped, as XML in XML. */
export function browseResponse(didl: string, returned: number, total: number): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:BrowseResponse xmlns:u="${CONTENT_DIRECTORY_TYPE}">
      <Result>${escapeXml(didl)}</Result>
      <NumberReturned>${returned}</NumberReturned>
      <TotalMatches>${total}</TotalMatches>
      <UpdateID>1</UpdateID>
    </u:BrowseResponse>
  </s:Body>
</s:Envelope>`;
}

/* ---------- HTTP ---------- */

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse a `Range: bytes=…` header against a known file size.
 *
 * This is how a TV seeks. Returns null when there is no range (send the whole file) and `'invalid'`
 * when the request cannot be satisfied, which must be answered with 416 rather than silently
 * serving the wrong bytes.
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return 'invalid';

  if (rawStart === '') {
    // A suffix range: the last N bytes.
    const wanted = Number(rawEnd);
    if (!Number.isFinite(wanted) || wanted <= 0) return 'invalid';
    return { start: Math.max(0, size - wanted), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return 'invalid';
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return 'invalid';
  return { start, end };
}

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.webm': 'video/webm',
  '.ts': 'video/mp2t', '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/opus',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
};

export function mimeFor(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}
