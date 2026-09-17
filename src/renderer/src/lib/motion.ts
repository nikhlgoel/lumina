import { flushSync } from 'react-dom';

export type TransitionKind = 'page' | 'player-open' | 'player-close';

const reducedMotion = () =>
  document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Run a state change inside a View Transition so pages and the player morph instead of snapping.
 * The kind is exposed as a class on <html> so CSS can pick the animation.
 */
export function transition(update: () => void, kind: TransitionKind) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (!doc.startViewTransition || reducedMotion()) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.transition = kind;
  const vt = doc.startViewTransition(() => flushSync(update));
  void vt.finished.finally(() => {
    if (root.dataset.transition === kind) delete root.dataset.transition;
  });
}
