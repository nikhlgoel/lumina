import { describe, it, expect } from 'vitest';
import {
  BOOT_REPLY, DHCP_ACK, DHCP_DISCOVER, DHCP_OFFER, DHCP_REQUEST,
  buildDiscover, buildReply, bytesToIp, ipToBytes, isLinkLocal, isOfferFor, looksVirtual, offerAddressFor, parseDhcp, rankLinkCandidates,
} from '@core/dhcp';

/** Build a request frame the way a television's DHCP client would. */
function frame(o: {
  type?: number; xid?: number; mac?: string; requestedIp?: string; serverId?: string;
  hostname?: string; broadcast?: boolean; op?: number; cookie?: number;
} = {}): Uint8Array {
  const buf = new Uint8Array(300);
  const view = new DataView(buf.buffer);
  buf[0] = o.op ?? 1;
  buf[1] = 1;
  buf[2] = 6;
  view.setUint32(4, o.xid ?? 0x12345678);
  view.setUint16(10, o.broadcast ? 0x8000 : 0);
  const mac = (o.mac ?? 'aa:bb:cc:dd:ee:ff').split(':').map((h) => parseInt(h, 16));
  buf.set(mac, 28);
  view.setUint32(236, o.cookie ?? 0x63825363);

  let i = 240;
  const put = (tag: number, bytes: number[]) => { buf[i++] = tag; buf[i++] = bytes.length; buf.set(bytes, i); i += bytes.length; };
  if (o.type !== undefined) put(53, [o.type]);
  if (o.requestedIp) put(50, ipToBytes(o.requestedIp));
  if (o.serverId) put(54, ipToBytes(o.serverId));
  if (o.hostname) put(12, [...new TextEncoder().encode(o.hostname)]);
  buf[i++] = 255;
  return buf.slice(0, i);
}

/** Read one option back out of a reply, so assertions test the wire bytes rather than an object. */
function option(buf: Uint8Array, tag: number): number[] | null {
  for (let i = 240; i < buf.length; ) {
    const t = buf[i]!;
    if (t === 255) return null;
    if (t === 0) { i += 1; continue; }
    const len = buf[i + 1]!;
    if (t === tag) return [...buf.slice(i + 2, i + 2 + len)];
    i += 2 + len;
  }
  return null;
}

describe('parseDhcp', () => {
  it('reads a DISCOVER from a television', () => {
    const r = parseDhcp(frame({ type: DHCP_DISCOVER, mac: '00:1a:2b:3c:4d:5e', hostname: 'LIVINGROOM-TV' }))!;
    expect(r.messageType).toBe(DHCP_DISCOVER);
    expect(r.mac).toBe('00:1a:2b:3c:4d:5e');
    expect(r.hostname).toBe('LIVINGROOM-TV');
    expect(r.xid).toBe(0x12345678);
  });

  it('reads the address a REQUEST is asking to keep', () => {
    const r = parseDhcp(frame({ type: DHCP_REQUEST, requestedIp: '169.254.7.9', serverId: '169.254.1.1' }))!;
    expect(r.requestedIp).toBe('169.254.7.9');
    expect(r.serverId).toBe('169.254.1.1');
  });

  it('notices the broadcast flag, which decides how the reply must be sent', () => {
    expect(parseDhcp(frame({ type: DHCP_DISCOVER, broadcast: true }))!.broadcast).toBe(true);
    expect(parseDhcp(frame({ type: DHCP_DISCOVER }))!.broadcast).toBe(false);
  });

  it('ignores anything that is not a DHCP request', () => {
    expect(parseDhcp(new Uint8Array(10))).toBeNull();            // too short to hold a cookie
    expect(parseDhcp(frame({ cookie: 0xdeadbeef }))).toBeNull();  // not DHCP at all
    expect(parseDhcp(frame({ op: 2 }))).toBeNull();               // a reply, not a request
  });

  it('survives an option whose length runs past the end of the frame', () => {
    const buf = frame({ type: DHCP_DISCOVER });
    const bad = new Uint8Array(buf.length + 2);
    bad.set(buf.slice(0, buf.length - 1));
    bad[buf.length - 1] = 12;
    bad[buf.length] = 200; // claims 200 bytes with only a couple left
    expect(() => parseDhcp(bad)).not.toThrow();
    expect(parseDhcp(bad)!.messageType).toBe(DHCP_DISCOVER);
  });

  it('accepts a frame padded out with zero bytes, as real clients send', () => {
    const padded = new Uint8Array(400);
    padded.set(frame({ type: DHCP_DISCOVER }));
    expect(parseDhcp(padded)!.messageType).toBe(DHCP_DISCOVER);
  });
});

describe('buildReply', () => {
  const reply = buildReply({
    type: DHCP_OFFER, xid: 0xabcd1234, clientIp: '169.254.9.9', serverIp: '169.254.1.1',
    subnetMask: '255.255.0.0', leaseSeconds: 3600, mac: '00:1a:2b:3c:4d:5e',
  });

  it('is a reply, echoing the transaction the client opened', () => {
    expect(reply[0]).toBe(BOOT_REPLY);
    expect(new DataView(reply.buffer, reply.byteOffset).getUint32(4)).toBe(0xabcd1234);
  });

  it('carries the offered address where a client looks for it', () => {
    expect(bytesToIp(reply, 16)).toBe('169.254.9.9');
    expect(bytesToIp(reply, 20)).toBe('169.254.1.1');
  });

  it('copies the client hardware address back', () => {
    expect([...reply.slice(28, 34)]).toEqual([0x00, 0x1a, 0x2b, 0x3c, 0x4d, 0x5e]);
  });

  it('says which message it is, who sent it, and what the mask is', () => {
    expect(option(reply, 53)).toEqual([DHCP_OFFER]);
    expect(option(reply, 54)).toEqual([169, 254, 1, 1]);
    expect(option(reply, 1)).toEqual([255, 255, 0, 0]);
  });

  it('offers no router and no DNS, because there is nowhere to route to', () => {
    // A TV given a gateway that goes nowhere can hang on an internet check that never passes.
    expect(option(reply, 3)).toBeNull();
    expect(option(reply, 6)).toBeNull();
  });

  it('encodes the lease as four big-endian bytes', () => {
    expect(option(reply, 51)).toEqual([0, 0, 0x0e, 0x10]); // 3600
  });

  it('never writes a lease shorter than a minute', () => {
    const short = buildReply({
      type: DHCP_ACK, xid: 1, clientIp: '169.254.2.2', serverIp: '169.254.1.1',
      subnetMask: '255.255.0.0', leaseSeconds: 0, mac: 'aa:bb:cc:dd:ee:ff',
    });
    expect(option(short, 51)).toEqual([0, 0, 0, 60]);
  });

  it('round-trips: our own reply is not mistaken for a request', () => {
    expect(parseDhcp(reply)).toBeNull();
  });
});

describe('offerAddressFor', () => {
  it('keeps the television on the subnet this machine already has', () => {
    expect(offerAddressFor('169.254.13.42', '00:1a:2b:3c:4d:5e')!.startsWith('169.254.')).toBe(true);
  });

  it('gives the same television the same address every time', () => {
    const a = offerAddressFor('169.254.13.42', '00:1a:2b:3c:4d:5e');
    expect(offerAddressFor('169.254.13.42', '00:1a:2b:3c:4d:5e')).toBe(a);
  });

  it('gives two different televisions different addresses', () => {
    expect(offerAddressFor('169.254.13.42', '00:1a:2b:3c:4d:5e'))
      .not.toBe(offerAddressFor('169.254.13.42', 'aa:bb:cc:dd:ee:ff'));
  });

  it('never hands out this machine’s own address', () => {
    for (let n = 0; n < 500; n++) {
      const mac = ['00', '11', '22', '33', ((n >> 8) & 0xff).toString(16).padStart(2, '0'), (n & 0xff).toString(16).padStart(2, '0')].join(':');
      expect(offerAddressFor('169.254.13.42', mac)).not.toBe('169.254.13.42');
    }
  });

  it('never offers a subnet, broadcast, or reserved link-local address', () => {
    for (let n = 0; n < 500; n++) {
      const mac = ['aa', 'bb', 'cc', 'dd', ((n >> 8) & 0xff).toString(16).padStart(2, '0'), (n & 0xff).toString(16).padStart(2, '0')].join(':');
      const ip = offerAddressFor('169.254.1.1', mac)!;
      const [, , third, fourth] = ip.split('.').map(Number);
      expect(fourth, ip).not.toBe(0);
      expect(fourth, ip).not.toBe(255);
      expect(third, ip).not.toBe(0);
      expect(third, ip).not.toBe(255);
    }
  });

  it('works on an ordinary private subnet too, not only link-local', () => {
    expect(offerAddressFor('192.168.1.5', '00:1a:2b:3c:4d:5e')!.startsWith('192.168.')).toBe(true);
  });

  it('refuses an address it cannot make sense of', () => {
    expect(offerAddressFor('not-an-ip', 'aa:bb:cc:dd:ee:ff')).toBeNull();
    expect(offerAddressFor('169.254.1', 'aa:bb:cc:dd:ee:ff')).toBeNull();
    expect(offerAddressFor('169.254.1.999', 'aa:bb:cc:dd:ee:ff')).toBeNull();
  });
});

describe('isLinkLocal', () => {
  it('recognises the range a direct cable self-assigns', () => {
    expect(isLinkLocal('169.254.13.42')).toBe(true);
    expect(isLinkLocal('192.168.1.5')).toBe(false);
    expect(isLinkLocal('10.0.0.1')).toBe(false);
  });
});

describe('choosing which link to serve — the guard that protects other networks', () => {
  const nic = (name: string, address: string, internal = false) => ({ name, address, family: 'IPv4', internal });

  it('ranks a real adapter above a virtualisation one', () => {
    // Taken from the development machine, which has two VMware link-local adapters. Serving DHCP
    // there would have fought VMware's own DHCP service.
    const ranked = rankLinkCandidates([
      nic('VMware Network Adapter VMnet1', '169.254.230.17'),
      nic('VMware Network Adapter VMnet8', '169.254.235.17'),
      nic('Ethernet', '169.254.13.42'),
    ]);
    expect(ranked[0]!.name).toBe('Ethernet');
    expect(ranked[0]!.virtual).toBe(false);
    expect(ranked.slice(1).every((c) => c.virtual)).toBe(true);
  });

  it('never offers an adapter that already has a routable address', () => {
    // A routable address means something upstream handed it out — there is a DHCP server there.
    const ranked = rankLinkCandidates([nic('Wi-Fi', '10.20.218.189'), nic('vEthernet (WSL)', '172.17.32.1')]);
    expect(ranked).toEqual([]);
  });

  it('never offers loopback or any internal adapter', () => {
    expect(rankLinkCandidates([nic('Loopback', '169.254.1.1', true)])).toEqual([]);
  });

  it('recognises the usual virtual adapter names', () => {
    for (const name of ['VMware Network Adapter VMnet8', 'VirtualBox Host-Only Network', 'vEthernet (WSL)', 'Hyper-V Virtual Ethernet', 'ZeroTier One', 'Tailscale', 'TAP-Windows Adapter V9']) {
      expect(looksVirtual(name), name).toBe(true);
    }
    for (const name of ['Ethernet', 'Ethernet 2', 'Realtek PCIe GbE Family Controller', 'USB 10/100 LAN']) {
      expect(looksVirtual(name), name).toBe(false);
    }
  });
});

describe('asking a link whether someone else already serves DHCP', () => {
  it('builds a DISCOVER a real server would answer', () => {
    const probe = buildDiscover(0x11223344, 'aa:bb:cc:dd:ee:ff');
    const parsed = parseDhcp(probe)!;
    expect(parsed.messageType).toBe(DHCP_DISCOVER);
    expect(parsed.xid).toBe(0x11223344);
    // Broadcast flag: we have no address yet, so the reply has to be broadcast.
    expect(parsed.broadcast).toBe(true);
  });

  it('recognises another server’s OFFER as a reason to stand down', () => {
    const other = buildReply({
      type: DHCP_OFFER, xid: 0x11223344, clientIp: '192.168.1.50', serverIp: '192.168.1.1',
      subnetMask: '255.255.255.0', leaseSeconds: 86400, mac: 'aa:bb:cc:dd:ee:ff',
    });
    expect(isOfferFor(other, 0x11223344)).toBe(true);
  });

  it('ignores a reply to somebody else’s probe', () => {
    const other = buildReply({
      type: DHCP_OFFER, xid: 0x55667788, clientIp: '192.168.1.50', serverIp: '192.168.1.1',
      subnetMask: '255.255.255.0', leaseSeconds: 86400, mac: 'aa:bb:cc:dd:ee:ff',
    });
    expect(isOfferFor(other, 0x11223344)).toBe(false);
  });

  it('is not fooled by noise on the port', () => {
    expect(isOfferFor(new Uint8Array(10), 1)).toBe(false);
    expect(isOfferFor(buildDiscover(1, 'aa:bb:cc:dd:ee:ff'), 1)).toBe(false); // a request, not an offer
  });
});
