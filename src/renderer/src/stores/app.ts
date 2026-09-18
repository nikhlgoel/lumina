import { create } from 'zustand';
import type { Settings, SettingsPatch } from '@shared/settings';
import type { AppInfo, Preset, RequestInfo, ToolStatus } from '@shared/types';
import { call, errorMessage, on } from '@/lib/bridge';
import { transition } from '@/lib/motion';

export type View = 'download' | 'queue' | 'library' | 'settings' | 'about' | 'browser' | 'ide';
export type Mode = 'downloader' | 'player';

export interface Toast {
  id: number;
  tone: 'info' | 'success' | 'error';
  message: string;
  action?: { label: string; run: () => void };
  leaving?: boolean;
}

export interface PendingLink {
  url: string;
  request?: RequestInfo;
  source?: 'extension' | 'clipboard' | 'system';
}

interface AppState {
  ready: boolean;
  info: AppInfo | null;
  settings: Settings | null;
  tools: ToolStatus[];
  presets: Preset[];
  mode: Mode;
  view: View;
  settingsSection: string | null;
  toasts: Toast[];
  pending: PendingLink | null;
  clipboardLink: string | null;
  pasteRequest: number;
  /** Version already announced by a toast, so a re-check doesn't nag twice. */
  announcedUpdate: string | null;
  init: () => Promise<void>;
  setView: (view: View, section?: string) => void;
  setMode: (mode: Mode) => void;
  updateSettings: (patch: SettingsPatch) => Promise<void>;
  toast: (message: string, tone?: Toast['tone'], action?: Toast['action']) => void;
  dismissToast: (id: number) => void;
  consumePending: () => PendingLink | null;
  dismissClipboardLink: () => void;
}

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  info: null,
  settings: null,
  tools: [],
  presets: [],
  mode: new URLSearchParams(location.search).get('mode') === 'player' ? 'player' : 'downloader',
  view: 'download',
  settingsSection: null,
  toasts: [],
  pending: null,
  clipboardLink: null,
  pasteRequest: 0,
  announcedUpdate: null,

  init: async () => {
    const [info, settings, tools, presets] = await Promise.all([
      call('app:info'), call('settings:get'), call('tools:status'), call('presets:list'),
    ]);
    set({ info, settings, tools, presets, ready: true });
    on('settings:changed', (s) => set({ settings: s }));
    on('tools:changed', (t) => set({ tools: t }));
    // Announce a new version once, with a way straight to it; the About page has the full card.
    on('update:changed', (u) => {
      if (!u.available || get().announcedUpdate === u.available.version) return;
      set({ announcedUpdate: u.available.version });
      get().toast(`Lumina ${u.available.version} is available`, 'info', { label: 'See what’s new', run: () => get().setView('about') });
    });
    on('app:mode', ({ mode }) => set({ mode }));
    on('app:open-url', (link) => {
      set({ pending: link, clipboardLink: null });
      get().setMode('downloader');
      get().setView('download');
    });
    on('app:clipboard-link', ({ url }) => {
      if (get().view === 'download' || get().mode === 'player') set({ clipboardLink: url });
      else get().toast('Link copied', 'info', { label: 'Download', run: () => set({ pending: { url, source: 'clipboard' }, view: 'download' }) });
    });
    on('app:navigate', ({ view, section }) => {
      get().setMode('downloader');
      get().setView(view, section);
      if (section === 'paste') set((s) => ({ pasteRequest: s.pasteRequest + 1 }));
    });
  },

  setView: (view, section) => {
    const current = get();
    if (current.view === view && current.mode === 'downloader' && (section === undefined || section === current.settingsSection)) return;
    transition(() => set({ view, mode: 'downloader', settingsSection: section ?? (view === 'settings' ? current.settingsSection : null) }), 'page');
  },

  setMode: (mode) => {
    if (get().mode === mode) return;
    transition(() => set({ mode }), mode === 'player' ? 'player-open' : 'player-close');
    void call('window:set-mode', { mode });
  },

  updateSettings: async (patch) => {
    const current = get().settings;
    if (current) {
      // Optimistic: apply locally, roll back if main rejects.
      const optimistic = { ...current } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) optimistic[k] = { ...(current as unknown as Record<string, object>)[k], ...v };
      set({ settings: optimistic as unknown as Settings });
    }
    try {
      set({ settings: await call('settings:update', patch) });
    } catch (err) {
      if (current) set({ settings: current });
      get().toast(`Couldn’t save that setting: ${errorMessage(err)}`, 'error');
    }
  },

  toast: (message, tone = 'info', action) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, tone, message, action }] }));
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 7000 : 4000);
  },

  dismissToast: (id) => {
    // Play the exit animation, then remove.
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 180);
  },

  consumePending: () => {
    const link = get().pending;
    if (link) set({ pending: null });
    return link;
  },

  dismissClipboardLink: () => set({ clipboardLink: null }),
}));
