// "Editor theme" — pick the colours the code editor and the integrated terminal use, and import a
// VS Code colour theme.
//
// The honest framing matters here and is repeated in the UI rather than buried in a doc: Lumina can
// use a VS Code *colour theme*, which is a JSON file of hex values and contains no code. It cannot
// run VS Code extensions. And because Monaco does not use TextMate grammars, an imported theme's
// backgrounds and terminal colours are exact while its token colours are mapped to the nearest of
// Lumina's roles.
import { useEffect, useState } from 'react';
import { Check, Download, Trash2 } from 'lucide-react';
import type { EditorTheme } from '@shared/types';
import { BUILT_IN_THEMES } from '@core/theme';
import { call, errorMessage } from '@/lib/bridge';
import { setThemes } from '@/lib/editorTheme';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { Button } from '@/components/ui';
import { Group, Row, type SectionProps } from '../controls';

/** A miniature of the theme: its real background with a few real token colours on it. */
function Preview({ theme }: { theme: EditorTheme }) {
  const line = (role: keyof EditorTheme['tokens'], text: string) => (
    <div style={{ color: theme.tokens[role]?.color, fontStyle: theme.tokens[role]?.fontStyle }}>{text}</div>
  );
  return (
    <div
      className="overflow-hidden rounded-lg border font-mono text-[10px] leading-[1.45]"
      style={{ background: theme.ui.background, borderColor: theme.ui.border }}
      aria-hidden
    >
      <div className="flex">
        <div className="shrink-0 px-1.5 py-2 text-right" style={{ color: theme.ui.lineNumber, background: theme.ui.gutter }}>
          <div>1</div><div>2</div><div>3</div><div>4</div>
        </div>
        <div className="min-w-0 flex-1 px-2 py-2">
          {line('comment', '// a preview')}
          <div style={{ color: theme.ui.foreground, background: theme.ui.lineHighlight }}>
            <span style={{ color: theme.tokens.keyword?.color }}>const </span>
            <span style={{ color: theme.tokens.variable?.color }}>total </span>
            <span style={{ color: theme.tokens.operator?.color }}>= </span>
            <span style={{ color: theme.tokens.number?.color }}>42</span>
          </div>
          <div>
            <span style={{ color: theme.tokens.function?.color }}>greet</span>
            <span style={{ color: theme.tokens.punctuation?.color }}>(</span>
            <span style={{ color: theme.tokens.string?.color }}>&quot;hello&quot;</span>
            <span style={{ color: theme.tokens.punctuation?.color }}>)</span>
          </div>
          {line('type', 'interface Thing {}')}
        </div>
      </div>
    </div>
  );
}

function ThemeCard({ theme, selected, onPick, onRemove }: {
  theme: EditorTheme;
  selected: boolean;
  onPick: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="relative">
      <button
        onClick={onPick}
        aria-pressed={selected}
        className={cn(
          'w-full rounded-xl border p-2 text-left transition-[border-color,box-shadow] active:scale-[0.99]',
          selected ? 'border-accent shadow-[0_0_0_1px_var(--accent)]' : 'border-line hover:border-line-strong',
        )}
      >
        <Preview theme={theme} />
        <span className="mt-2 flex items-center gap-1.5 px-1">
          <span className="truncate text-[13px] font-semibold">{theme.name}</span>
          {selected && <Check className="size-3.5 shrink-0 text-accent" />}
          <span className="ml-auto shrink-0 text-[11px] text-ink-3">{theme.kind}</span>
        </span>
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${theme.name}`}
          title="Remove this imported theme"
          className="absolute top-3 right-3 rounded-md bg-overlay/80 p-1 text-ink-3 backdrop-blur transition-colors hover:text-danger"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function EditorThemeSection({ s, set }: SectionProps) {
  const toast = useApp((x) => x.toast);
  const [themes, setList] = useState<EditorTheme[]>(BUILT_IN_THEMES);
  const [busy, setBusy] = useState(false);
  const selected = s.appearance.editorTheme || 'auto';

  const adopt = (list: EditorTheme[]) => { setList(list); setThemes(list); };

  useEffect(() => {
    void call('theme:list').then(adopt).catch(() => {});
  }, []);

  const importTheme = async () => {
    setBusy(true);
    try {
      const result = await call('theme:import');
      if (!result) return; // the user cancelled the file dialog
      adopt(result.themes);
      // Selecting what was just imported is what everyone expects; picking the first is right even
      // when a .vsix carried several, because the rest are one click away.
      if (result.imported[0]) await set({ appearance: { editorTheme: result.imported[0] } });
      const extra = result.skipped.length > 0 ? ` (${result.skipped.length} skipped)` : '';
      toast(`Imported ${result.imported.length} theme${result.imported.length === 1 ? '' : 's'}${extra}`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (theme: EditorTheme) => {
    try {
      adopt(await call('theme:remove', { id: theme.id }));
      if (selected === theme.id) await set({ appearance: { editorTheme: 'auto' } });
      toast(`Removed “${theme.name}”`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const imported = themes.filter((t) => t.source === 'imported');
  const builtIn = themes.filter((t) => t.source !== 'imported');

  return (
    <>
      <Group
        title="Editor theme"
        description="Used by the code editor and the integrated terminal, so the two always match."
      >
        <Row
          id="editorThemeAuto"
          label="Match the app"
          description="Follow Lumina’s own light/dark setting — Lumina Dark when dark, Lumina Light when light."
        >
          <Button variant={selected === 'auto' ? 'primary' : 'ghost'} size="sm" onClick={() => void set({ appearance: { editorTheme: 'auto' } })}>
            {selected === 'auto' ? 'On' : 'Use'}
          </Button>
        </Row>
      </Group>

      <Group title="Built in">
        <div className="grid grid-cols-2 gap-3 py-4">
          {builtIn.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              selected={selected === theme.id}
              onPick={() => void set({ appearance: { editorTheme: theme.id } })}
            />
          ))}
        </div>
      </Group>

      <Group
        title="Imported"
        description={
          <>
            Lumina can use a <strong>VS Code colour theme</strong> — a <code className="font-mono">.json</code> file, or a
            theme extension packaged as <code className="font-mono">.vsix</code>. Those are data, not programs: nothing
            from the file is ever run. <strong>Code-running VS Code extensions are not supported.</strong> One honest
            limit: the editor background, gutter, selection and terminal colours come out exact, but because Monaco
            doesn’t use TextMate grammars, syntax colours are mapped to Lumina’s nearest token roles.
          </>
        }
        action={
          <Button variant="primary" size="sm" disabled={busy} icon={<Download className="size-3.5" />} onClick={() => void importTheme()}>
            Import theme…
          </Button>
        }
      >
        {imported.length === 0 ? (
          <Row label="Nothing imported yet" description="Import a .json or .vsix colour theme to add it here." />
        ) : (
          <div className="grid grid-cols-2 gap-3 py-4">
            {imported.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                selected={selected === theme.id}
                onPick={() => void set({ appearance: { editorTheme: theme.id } })}
                onRemove={() => void remove(theme)}
              />
            ))}
          </div>
        )}
      </Group>
    </>
  );
}
