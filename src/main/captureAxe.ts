// Development-only: an accessibility audit of the real screens with axe-core.
// Run: LUMINA_CAPTURE=<dir> LUMINA_AXE=<path to axe.min.js> LUMINA_CAPTURE_ONLY='probe-axe' electron . --user-data-dir=<scratch>
// axe is not a dependency of the project (it is fetched by whoever runs this); each step writes the violations found on one screen to probe-axe-<screen>.json.
import fs from 'node:fs';

type Step = { name: string; script: string; delay?: number };

const RUN = `(async () => {
  const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, resultTypes: ['violations'] });
  return JSON.stringify(r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 140), why: (n.any[0] || n.all[0] || n.none[0] || {}).message })) })));
})()`;

/** `goto` and `openSettings` are the capture harness's own navigation helpers, passed in so the two files do not import each other. */
export function axeSteps(axePath: string, nav: { goto: (label: string) => string; openSettings: (label: string) => string }): Step[] {
  const { goto, openSettings } = nav;
  let src = '';
  try { src = fs.readFileSync(axePath, 'utf8'); } catch { return []; }
  const screens: [string, string][] = [
    ['download', goto('Download')], ['queue', goto('Queue')], ['library', goto('Library')], ['about', goto('About')],
    ['settings-general', openSettings('General')], ['settings-player', openSettings('Player')], ['settings-downloads', openSettings('Downloads')],
    ['settings-torrents', openSettings('Torrents')], ['settings-privacy', openSettings('Privacy')], ['settings-network', openSettings('Network')],
  ];
  return [...screens.map(([name, nav]) => ({ name: `probe-axe-${name}`, delay: 1500, script: `${nav}; new Promise((r) => setTimeout(r, 1800)).then(() => { ${src}\n; return ${RUN}; })` }))];
}

/** A script that runs axe on whatever is on screen right now (a panel that is open, a screen that took several steps to reach), or null when axe is not at that path. */
export function axeNow(axePath: string | undefined): string | null {
  if (!axePath) return null;
  try {
    return `(async () => { ${fs.readFileSync(axePath, 'utf8')}\n; return ${RUN}; })()`;
  } catch {
    return null;
  }
}
