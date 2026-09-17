// Kept free of runtime dependencies so the sandboxed preload stays tiny.
export const EVENT_CHANNELS = [
  'jobs:updated', 'jobs:removed', 'settings:changed', 'library:changed', 'tools:changed',
  'app:mode', 'app:open-url', 'app:clipboard-link', 'app:navigate', 'player:command', 'extension:changed',
  'hosts:challenge', 'hosts:challenge-done', 'browser:state',
] as const;
