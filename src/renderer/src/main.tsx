import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Apply the stored color scheme before first paint to avoid a light flash in dark mode.
document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Let the splash finish its assembly (about a second), then fade it out once React has painted.
const splash = document.getElementById('splash');
if (splash) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = Math.max(0, (reduced ? 150 : 1150) - performance.now());
  requestAnimationFrame(() => setTimeout(() => {
    splash.classList.add('done');
    setTimeout(() => splash.remove(), 300);
  }, wait));
}
