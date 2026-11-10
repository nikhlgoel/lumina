import { describe, it, expect } from 'vitest';
import { classifyStartFailure, nextStartFix, ENGINE_WILL_NOT_START } from '@core/engineStart';
import { presentAddresses, splitByPresence } from '@core/networkBind';

// The first message below is what the bundled aria2c 1.37.0 printed on this machine with a saved address that was no longer there,
// and it is why every download in the owner's log failed with "The download engine (aria2) did not start".
const MISSING_INTERFACE = 'Exception caught\nException: [SocketCore.cc:1281] errorCode=1 Failed to find given interface 10.190.179.5, cause: not available';

describe('why the download engine did not start, and the cure', () => {
  it('knows a saved connection that is not there, from the message aria2 really prints', () => {
    const f = classifyStartFailure(MISSING_INTERFACE);
    expect(f.kind).toBe('interface');
    expect(f.plain).toMatch(/normal connection/);
  });

  it('knows a busy port, in aria2’s wording and in Windows’s', () => {
    expect(classifyStartFailure('Failed to bind a socket, cause: Address already in use').kind).toBe('port');
    expect(classifyStartFailure('Failed to bind a socket, cause: Only one usage of each socket address (protocol/network address/port) is normally permitted.').kind).toBe('port');
  });

  it('puts a missing connection ahead of the generic "failed to bind"', () => {
    expect(classifyStartFailure('Failed to bind a socket: Failed to find given interface 1.2.3.4, cause: not available').kind).toBe('interface');
  });

  it('knows a setting aria2 would not accept, and says plainly when it does not know', () => {
    expect(classifyStartFailure('Unrecognized option --bt-nonsense').kind).toBe('option');
    expect(classifyStartFailure('').kind).toBe('unknown');
    expect(classifyStartFailure('something nobody has seen').plain).toMatch(/stopped as it started/);
  });

  it('adds one cure at a time, and keeps the ones already tried', () => {
    const first = nextStartFix({}, 'interface');
    expect(first).toEqual({ dropBind: true });
    expect(nextStartFix(first, 'port')).toEqual({ dropBind: true, otherPort: true });
    expect(nextStartFix({}, 'unknown')).toEqual({ minimal: true });
  });

  it('tries every cure at once when the same one has already been tried and did not help', () => {
    expect(nextStartFix({ dropBind: true }, 'interface')).toEqual({ dropBind: true, otherPort: true, minimal: true });
  });

  it('ends with words a person can act on, not an exit code', () => {
    expect(ENGINE_WILL_NOT_START).not.toMatch(/exit|code \d|aria2 exited/i);
    expect(ENGINE_WILL_NOT_START).toMatch(/reopening Lumina/);
  });
});

describe('which saved network connections still exist', () => {
  const ifaces = {
    Ethernet: [{ address: '192.168.1.20', family: 'IPv4' }, { address: 'fe80::1', family: 'IPv6' }],
    Loopback: [{ address: '127.0.0.1', family: 'IPv4' }],
    'Wi-Fi': [{ address: '10.0.0.7', family: 4 }],
  };

  it('lists the IPv4 addresses the computer has now', () => {
    expect(presentAddresses(ifaces)).toEqual(['192.168.1.20', '127.0.0.1', '10.0.0.7']);
  });

  it('skips a saved address whose connection has gone (a hotspot that changed address), without forgetting it', () => {
    const saved = ['10.190.179.5', '192.168.1.20', '169.254.230.17'];
    expect(splitByPresence(saved, presentAddresses(ifaces))).toEqual({ use: ['192.168.1.20'], missing: ['10.190.179.5', '169.254.230.17'] });
  });

  it('skips a link-local address even though the adapter is there: it has no network behind it', () => {
    const withApipa = { ...ifaces, 'Ethernet 2': [{ address: '169.254.230.17', family: 'IPv4' }] };
    expect(splitByPresence(['169.254.230.17', '10.0.0.7'], presentAddresses(withApipa))).toEqual({ use: ['10.0.0.7'], missing: ['169.254.230.17'] });
  });

  it('uses nothing, not everything, when none of the saved connections is there', () => {
    expect(splitByPresence(['10.190.179.5'], presentAddresses(ifaces))).toEqual({ use: [], missing: ['10.190.179.5'] });
    expect(splitByPresence(undefined, [])).toEqual({ use: [], missing: [] });
  });

  it('ignores a saved entry that is not an address at all', () => {
    expect(splitByPresence(['Wi-Fi', '10.0.0.7'], presentAddresses(ifaces))).toEqual({ use: ['10.0.0.7'], missing: [] });
  });
});
