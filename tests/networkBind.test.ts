import { describe, expect, it } from 'vitest';
import { bindArg, bindArgFromSlots, cleanBindList, isBindAddress, offerableAddresses, weightedBindList } from '@core/networkBind';

describe('which addresses may be bound to', () => {
  it('accepts plain IPv4 addresses', () => {
    for (const ok of ['192.168.1.3', '10.0.0.255', '172.17.32.1', '0.0.0.0']) expect(isBindAddress(ok)).toBe(true);
  });

  it('rejects anything else, because the value ends up on a command line', () => {
    for (const bad of ['', 'Wi-Fi', '192.168.1', '192.168.1.256', '1.2.3.4 --dir=/x', '1.2.3.4,5.6.7.8', '::1', '1.2.3.4\n', 'a.b.c.d']) {
      expect(isBindAddress(bad)).toBe(false);
    }
  });
});

describe('cleaning a saved list', () => {
  it('drops invalid and repeated entries and keeps order', () => {
    expect(cleanBindList(['192.168.1.3', 'junk', ' 10.0.0.2 ', '192.168.1.3'])).toEqual(['192.168.1.3', '10.0.0.2']);
  });

  it('copes with nothing saved', () => {
    expect(cleanBindList(undefined)).toEqual([]);
    expect(cleanBindList([])).toEqual([]);
  });

  it('keeps at most eight', () => {
    const many = Array.from({ length: 12 }, (_, i) => `10.0.0.${i + 1}`);
    expect(cleanBindList(many)).toHaveLength(8);
  });
});

describe('the aria2 argument', () => {
  it('does nothing without a usable address', () => {
    expect(bindArg([])).toBeNull();
    expect(bindArg(['not an address'])).toBeNull();
  });

  it('pins everything to one address when there is one', () => {
    expect(bindArg(['192.168.1.3'])).toBe('--interface=192.168.1.3');
  });

  it('shares the downloads between several, which is the link aggregation', () => {
    expect(bindArg(['192.168.1.3', '192.168.2.7'])).toBe('--multiple-interface=192.168.1.3,192.168.2.7');
  });
});

describe('weighting connections by how fast each line measured', () => {
  const TETHER = '10.81.5.107';
  const WIFI = '192.168.1.3';
  const count = (l: string[], a: string) => l.filter((x) => x === a).length;

  it('gives the fast line most of the slots (the measured 34 MB/s tether and 2 MB/s Wi-Fi)', () => {
    const l = weightedBindList([TETHER, WIFI], [34.4e6, 1.9e6]);
    expect(l).toHaveLength(8);
    expect(count(l, TETHER)).toBe(8 - count(l, WIFI));
    expect(count(l, TETHER)).toBeGreaterThanOrEqual(7);
  });

  it('drops a line under 5% of the total instead of giving it a connection', () => {
    const l = weightedBindList([TETHER, WIFI], [40e6, 1e6]);
    expect(count(l, WIFI)).toBe(0);
    expect(bindArgFromSlots(l)).toBe(`--interface=${TETHER}`);
  });

  it('splits evenly for lines of similar speed', () => {
    const l = weightedBindList([TETHER, WIFI], [20e6, 20e6]);
    expect(count(l, TETHER)).toBe(4);
    expect(count(l, WIFI)).toBe(4);
  });

  it('falls back to equal shares (the plain list) when nothing was measured', () => {
    expect(weightedBindList([TETHER, WIFI], [0, 0])).toEqual([TETHER, WIFI]);
    expect(weightedBindList([TETHER, WIFI], [])).toEqual([TETHER, WIFI]);
  });

  it('alternates the lines rather than dealing all of one first', () => {
    const l = weightedBindList([TETHER, WIFI], [30e6, 10e6]);
    expect(l.slice(0, 2)).toEqual([TETHER, WIFI]);
  });

  it('builds the aria2 argument, repeating an address to weight it', () => {
    expect(bindArgFromSlots([TETHER, TETHER, TETHER, WIFI])).toBe(`--multiple-interface=${TETHER},${TETHER},${TETHER},${WIFI}`);
    expect(bindArgFromSlots([TETHER, TETHER])).toBe(`--interface=${TETHER}`);
    expect(bindArgFromSlots(['junk'])).toBeNull();
  });
});

describe('which addresses are offered', () => {
  it('lists IPv4 only, never loopback, and marks link-local ones', () => {
    const list = offerableAddresses({
      'Wi-Fi': [{ address: '192.168.1.3', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
      Ethernet: [{ address: '169.254.149.14', family: 'IPv4', internal: false }],
      Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    });
    expect(list).toEqual([
      { name: 'Wi-Fi', address: '192.168.1.3', linkLocal: false, virtual: false },
      { name: 'Ethernet', address: '169.254.149.14', linkLocal: true, virtual: false },
    ]);
  });

  it('marks virtual adapters and puts them after the real connections', () => {
    const list = offerableAddresses({
      'VMware Network Adapter VMnet8': [{ address: '192.168.100.1', family: 'IPv4', internal: false }],
      'vEthernet (WSL)': [{ address: '172.17.32.1', family: 'IPv4', internal: false }],
      Ethernet: [{ address: '192.168.1.10', family: 'IPv4', internal: false }],
      'Wi-Fi': [{ address: '192.168.1.3', family: 'IPv4', internal: false }],
    });
    expect(list.map((a) => a.name)).toEqual(['Ethernet', 'Wi-Fi', 'VMware Network Adapter VMnet8', 'vEthernet (WSL)']);
    expect(list.filter((a) => a.virtual).map((a) => a.name)).toEqual(['VMware Network Adapter VMnet8', 'vEthernet (WSL)']);
  });
});
