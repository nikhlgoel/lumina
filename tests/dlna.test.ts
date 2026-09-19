import { describe, it, expect } from 'vitest';
import {
  CONTENT_DIRECTORY_TYPE, MEDIA_SERVER_TYPE, ROOT_DEVICE, browseResponse, deviceDescription,
  deviceUuid, didlContainerXml, didlDocument, didlItemXml, dlnaDuration, escapeXml, mimeFor,
  parseBrowse, parseRange, parseSsdp, protocolInfo, searchMatches, ssdpNotify, ssdpSearchResponse,
  usnFor,
} from '@core/dlna';

const advert = {
  uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  location: 'http://192.168.1.5:8200/description.xml',
  serverTag: 'Windows/10 UPnP/1.0 Lumina/3.0',
};

describe('deviceUuid', () => {
  it('is stable for the same seed, so a TV does not collect dead entries', () => {
    expect(deviceUuid('machine-1')).toBe(deviceUuid('machine-1'));
  });

  it('differs between machines', () => {
    expect(deviceUuid('machine-1')).not.toBe(deviceUuid('machine-2'));
  });

  it('is a well-formed version-4 UUID', () => {
    expect(deviceUuid('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('parseSsdp', () => {
  const search = 'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 3\r\nST: urn:schemas-upnp-org:device:MediaServer:1\r\n\r\n';

  it('reads a real M-SEARCH', () => {
    const r = parseSsdp(search);
    expect(r).toMatchObject({ method: 'M-SEARCH', man: 'ssdp:discover', mx: 3 });
    expect(r!.st).toBe('urn:schemas-upnp-org:device:mediaserver:1');
  });

  it('strips the quotes devices put around MAN', () => {
    expect(parseSsdp(search)!.man).toBe('ssdp:discover');
  });

  it('accepts bare LF, which some devices send', () => {
    expect(parseSsdp('M-SEARCH * HTTP/1.1\nST: ssdp:all\n\n')!.st).toBe('ssdp:all');
  });

  it('is case-insensitive about header names', () => {
    expect(parseSsdp('M-SEARCH * HTTP/1.1\r\nst: ssdp:all\r\n\r\n')!.st).toBe('ssdp:all');
  });

  it('returns null for junk and empty input', () => {
    expect(parseSsdp('')).toBeNull();
    expect(parseSsdp('   ')).toBeNull();
  });

  it('survives a missing MX or a non-numeric one', () => {
    expect(parseSsdp('M-SEARCH * HTTP/1.1\r\nST: ssdp:all\r\n\r\n')!.mx).toBeNull();
    expect(parseSsdp('M-SEARCH * HTTP/1.1\r\nMX: soon\r\nST: ssdp:all\r\n\r\n')!.mx).toBeNull();
  });
});

describe('searchMatches', () => {
  const uuid = advert.uuid;

  it('answers ssdp:all with every identity we have', () => {
    expect(searchMatches('ssdp:all', uuid)).toEqual([ROOT_DEVICE, `uuid:${uuid}`, MEDIA_SERVER_TYPE, CONTENT_DIRECTORY_TYPE]);
  });

  it('answers the targeted searches', () => {
    expect(searchMatches(ROOT_DEVICE, uuid)).toEqual([ROOT_DEVICE]);
    expect(searchMatches(MEDIA_SERVER_TYPE.toLowerCase(), uuid)).toEqual([MEDIA_SERVER_TYPE]);
    expect(searchMatches(CONTENT_DIRECTORY_TYPE.toLowerCase(), uuid)).toEqual([CONTENT_DIRECTORY_TYPE]);
    expect(searchMatches(`uuid:${uuid}`, uuid)).toEqual([`uuid:${uuid}`]);
  });

  it('stays silent for somebody else’s business', () => {
    expect(searchMatches('urn:schemas-upnp-org:device:InternetGatewayDevice:1', uuid)).toEqual([]);
    expect(searchMatches('uuid:ffffffff-0000-4000-8000-000000000000', uuid)).toEqual([]);
    expect(searchMatches(null, uuid)).toEqual([]);
    expect(searchMatches('', uuid)).toEqual([]);
  });
});

describe('usnFor', () => {
  it('does not double up the uuid when the target is the uuid itself', () => {
    expect(usnFor(`uuid:${advert.uuid}`, advert.uuid)).toBe(`uuid:${advert.uuid}`);
  });

  it('joins with :: for a device or service target', () => {
    expect(usnFor(MEDIA_SERVER_TYPE, advert.uuid)).toBe(`uuid:${advert.uuid}::${MEDIA_SERVER_TYPE}`);
  });
});

describe('ssdpSearchResponse', () => {
  const msg = ssdpSearchResponse(MEDIA_SERVER_TYPE, advert);

  it('starts with a 200 and carries the required headers', () => {
    expect(msg.startsWith('HTTP/1.1 200 OK\r\n')).toBe(true);
    for (const header of ['CACHE-CONTROL:', 'EXT:', 'LOCATION:', 'SERVER:', 'ST:', 'USN:']) {
      expect(msg, header).toContain(header);
    }
  });

  it('uses CRLF everywhere and ends with a blank line', () => {
    expect(msg.split('\n').every((l) => l === '' || l.endsWith('\r'))).toBe(true);
    expect(msg.endsWith('\r\n\r\n')).toBe(true);
  });

  it('echoes the search target it is answering', () => {
    expect(msg).toContain(`ST: ${MEDIA_SERVER_TYPE}`);
  });
});

describe('ssdpNotify', () => {
  it('advertises a location and lifetime when alive', () => {
    const alive = ssdpNotify(ROOT_DEVICE, 'ssdp:alive', advert);
    expect(alive.startsWith('NOTIFY * HTTP/1.1\r\n')).toBe(true);
    expect(alive).toContain('NTS: ssdp:alive');
    expect(alive).toContain(`LOCATION: ${advert.location}`);
    expect(alive).toContain('CACHE-CONTROL:');
  });

  it('omits location and lifetime on byebye — the device is going away', () => {
    const bye = ssdpNotify(ROOT_DEVICE, 'ssdp:byebye', advert);
    expect(bye).toContain('NTS: ssdp:byebye');
    expect(bye).not.toContain('LOCATION:');
    expect(bye).not.toContain('CACHE-CONTROL:');
  });

  it('always addresses the multicast group', () => {
    expect(ssdpNotify(ROOT_DEVICE, 'ssdp:alive', advert)).toContain('HOST: 239.255.255.250:1900');
  });
});

describe('escapeXml', () => {
  it('escapes everything that can break a document', () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe('a &amp; b &lt; c &gt; d &quot; e &apos; f');
  });

  it('escapes ampersands before the entities it creates', () => {
    expect(escapeXml('&lt;')).toBe('&amp;lt;');
  });
});

describe('deviceDescription', () => {
  const xml = deviceDescription({ uuid: advert.uuid, friendlyName: 'Lumina on PC', modelVersion: '3.0.0' });

  it('declares itself a MediaServer with both required services', () => {
    expect(xml).toContain(`<deviceType>${MEDIA_SERVER_TYPE}</deviceType>`);
    expect(xml).toContain(CONTENT_DIRECTORY_TYPE);
    expect(xml).toContain('ConnectionManager');
  });

  it('carries the UDN the SSDP messages advertise', () => {
    expect(xml).toContain(`<UDN>uuid:${advert.uuid}</UDN>`);
  });

  it('escapes a friendly name containing XML characters', () => {
    const odd = deviceDescription({ uuid: advert.uuid, friendlyName: 'Bob & Alice <PC>', modelVersion: '1' });
    expect(odd).toContain('Bob &amp; Alice &lt;PC&gt;');
  });
});

describe('parseBrowse', () => {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>
    <u:Browse xmlns:u="${CONTENT_DIRECTORY_TYPE}">
      <ObjectID>music</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag>
      <Filter>*</Filter><StartingIndex>25</StartingIndex><RequestedCount>50</RequestedCount>
      <SortCriteria></SortCriteria>
    </u:Browse></s:Body></s:Envelope>`;

  it('reads the fields a listing needs', () => {
    expect(parseBrowse(body)).toEqual({
      objectId: 'music', browseFlag: 'BrowseDirectChildren', startingIndex: 25, requestedCount: 50,
    });
  });

  it('copes with namespace prefixes on the parameters', () => {
    const prefixed = body.replace('<ObjectID>', '<u:ObjectID>').replace('</ObjectID>', '</u:ObjectID>');
    expect(parseBrowse(prefixed)!.objectId).toBe('music');
  });

  it('defaults to the root container and direct children', () => {
    const minimal = `<u:Browse xmlns:u="${CONTENT_DIRECTORY_TYPE}"></u:Browse>`;
    expect(parseBrowse(minimal)).toEqual({
      objectId: '0', browseFlag: 'BrowseDirectChildren', startingIndex: 0, requestedCount: 0,
    });
  });

  it('recognises a metadata browse', () => {
    expect(parseBrowse(body.replace('BrowseDirectChildren', 'BrowseMetadata'))!.browseFlag).toBe('BrowseMetadata');
  });

  it('treats a negative or non-numeric index as zero rather than throwing', () => {
    const bad = body.replace('<StartingIndex>25</StartingIndex>', '<StartingIndex>-4</StartingIndex>')
      .replace('<RequestedCount>50</RequestedCount>', '<RequestedCount>lots</RequestedCount>');
    expect(parseBrowse(bad)).toMatchObject({ startingIndex: 0, requestedCount: 0 });
  });

  it('returns null when the body is not a Browse at all', () => {
    expect(parseBrowse('<u:GetSystemUpdateID/>')).toBeNull();
  });
});

describe('dlnaDuration', () => {
  it('formats as HH:MM:SS.mmm', () => {
    expect(dlnaDuration(0)).toBe('00:00:00.000');
    expect(dlnaDuration(61.5)).toBe('00:01:01.500');
    expect(dlnaDuration(3725)).toBe('01:02:05.000');
  });

  it('handles durations past ten hours without truncating', () => {
    expect(dlnaDuration(36000)).toBe('10:00:00.000');
  });

  it('returns null when the duration is unknown or nonsense', () => {
    expect(dlnaDuration(null)).toBeNull();
    expect(dlnaDuration(-5)).toBeNull();
    expect(dlnaDuration(Number.NaN)).toBeNull();
    expect(dlnaDuration(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('protocolInfo', () => {
  it('advertises byte-range seeking, without which TVs refuse to scrub', () => {
    expect(protocolInfo('video/mp4')).toBe('http-get:*:video/mp4:DLNA.ORG_OP=01');
  });
});

describe('DIDL', () => {
  const item = {
    id: 'i-1', parentId: 'music', title: 'Blue & Gold', kind: 'audio' as const,
    url: 'http://192.168.1.5:8200/media/i-1', mime: 'audio/mpeg',
    sizeBytes: 5_000_000, durationSec: 214, artist: 'Someone', album: 'An Album',
    albumArtUrl: 'http://192.168.1.5:8200/art/i-1',
  };

  it('marks audio and video with the right upnp class', () => {
    expect(didlItemXml(item)).toContain('object.item.audioItem.musicTrack');
    expect(didlItemXml({ ...item, kind: 'video' })).toContain('object.item.videoItem');
  });

  it('escapes titles containing XML characters', () => {
    expect(didlItemXml(item)).toContain('Blue &amp; Gold');
  });

  it('carries size and duration on the res element', () => {
    const xml = didlItemXml(item);
    expect(xml).toContain('size="5000000"');
    expect(xml).toContain('duration="00:03:34.000"');
  });

  it('omits size and duration cleanly when they are unknown', () => {
    const xml = didlItemXml({ ...item, sizeBytes: null, durationSec: null });
    expect(xml).not.toContain('size=');
    expect(xml).not.toContain('duration=');
    expect(xml).toContain('protocolInfo=');
  });

  it('includes album art only when there is some', () => {
    expect(didlItemXml(item)).toContain('albumArtURI');
    expect(didlItemXml({ ...item, albumArtUrl: null })).not.toContain('albumArtURI');
  });

  it('describes a container with its child count', () => {
    const xml = didlContainerXml({ id: 'music', parentId: '0', title: 'Music', childCount: 42 });
    expect(xml).toContain('childCount="42"');
    expect(xml).toContain('object.container.storageFolder');
  });

  it('declares the namespaces a TV looks for', () => {
    const doc = didlDocument([didlItemXml(item)]);
    expect(doc).toContain('urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/');
    expect(doc).toContain('http://purl.org/dc/elements/1.1/');
    expect(doc).toContain('urn:schemas-upnp-org:metadata-1-0/upnp/');
    expect(doc.endsWith('</DIDL-Lite>')).toBe(true);
  });
});

describe('browseResponse', () => {
  it('escapes the DIDL document into the SOAP body, as XML inside XML', () => {
    const didl = didlDocument([didlContainerXml({ id: 'music', parentId: '0', title: 'Music', childCount: 1 })]);
    const soap = browseResponse(didl, 1, 1);
    expect(soap).toContain('&lt;DIDL-Lite');
    expect(soap).not.toContain('<DIDL-Lite');
    expect(soap).toContain('<NumberReturned>1</NumberReturned>');
    expect(soap).toContain('<TotalMatches>1</TotalMatches>');
  });
});

describe('parseRange', () => {
  it('returns null when the client wants the whole file', () => {
    expect(parseRange(undefined, 1000)).toBeNull();
  });

  it('reads an open-ended range, which is what a TV sends to start playing', () => {
    expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('reads a closed range, which is what it sends to seek', () => {
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
  });

  it('reads a suffix range', () => {
    expect(parseRange('bytes=-300', 1000)).toEqual({ start: 700, end: 999 });
  });

  it('clamps an end past the file rather than reading off the end', () => {
    expect(parseRange('bytes=900-99999', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('clamps a suffix longer than the file', () => {
    expect(parseRange('bytes=-99999', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('rejects a start past the end of the file, which must be a 416', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('invalid');
    expect(parseRange('bytes=5000-6000', 1000)).toBe('invalid');
  });

  it('rejects a reversed or empty range', () => {
    expect(parseRange('bytes=500-100', 1000)).toBe('invalid');
    expect(parseRange('bytes=-', 1000)).toBe('invalid');
    expect(parseRange('bytes=-0', 1000)).toBe('invalid');
  });

  it('rejects units it does not understand and multi-part ranges', () => {
    expect(parseRange('items=0-10', 1000)).toBe('invalid');
    expect(parseRange('bytes=0-10,20-30', 1000)).toBe('invalid');
    expect(parseRange('nonsense', 1000)).toBe('invalid');
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseRange('  bytes=0-99  ', 1000)).toEqual({ start: 0, end: 99 });
  });
});

describe('mimeFor', () => {
  it('knows the containers a TV will ask for', () => {
    expect(mimeFor('a.mp4')).toBe('video/mp4');
    expect(mimeFor('a.mkv')).toBe('video/x-matroska');
    expect(mimeFor('a.mp3')).toBe('audio/mpeg');
    expect(mimeFor('a.m4a')).toBe('audio/mp4');
    expect(mimeFor('cover.jpg')).toBe('image/jpeg');
  });

  it('ignores case and directories', () => {
    expect(mimeFor('C:/My Films/Some.Film.MP4')).toBe('video/mp4');
  });

  it('falls back to octet-stream rather than guessing', () => {
    expect(mimeFor('mystery.xyz')).toBe('application/octet-stream');
    expect(mimeFor('noextension')).toBe('application/octet-stream');
  });
});
