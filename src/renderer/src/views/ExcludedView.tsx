// Stands in for a view this build does not contain.
//
// `App.tsx` never routes to an excluded view, so this is never rendered. It exists for the bundler:
// `vite.config.ts` aliases the excluded view's module path here, which is what actually keeps its
// dependencies out of the build.
//
// The gentler-looking approach — `HAS_IDE ? lazy(() => import(...)) : null` — was tried first and
// measured: the no-IDE bundle did not shrink by a byte. Rollup will not drop a dynamic import to a
// module with side effects just because the branch holding it is dead, and Monaco has plenty of
// side effects. Replacing the module is the only version of this that is true. See D21.

export function IdeView() {
  return null;
}

export function BrowserView() {
  return null;
}
