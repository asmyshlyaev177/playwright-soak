import type { Page } from '@playwright/test';

/**
 * Self-contained fixture pages, loaded with `setContent` so the suite needs no
 * server. Each exposes `window.round()`, which the soak flow calls once per
 * iteration.
 */

const shell = (body: string, script: string) => `
<!doctype html>
<html><body>
<div id="root">${body}</div>
<script>${script}</script>
</body></html>`;

/** Mounts and unmounts a subtree, cleaning up after itself. Must not leak. */
export const CLEAN = shell(
  `<button id="toggle">toggle</button><div id="host"></div>`,
  `
  const host = document.getElementById('host');
  window.round = () => {
    const panel = document.createElement('div');
    panel.className = 'panel';
    for (let i = 0; i < 20; i++) {
      const row = document.createElement('span');
      row.textContent = 'row ' + i;
      panel.appendChild(row);
    }
    const onClick = () => panel.classList.toggle('on');
    panel.addEventListener('click', onClick);
    host.appendChild(panel);

    panel.removeEventListener('click', onClick);
    host.removeChild(panel);
  };
`,
);

/** Retains a detached subtree and its listener every round. */
export const LEAKS_DOM = shell(
  `<div id="host"></div>`,
  `
  window.__kept = [];
  window.round = () => {
    const panel = document.createElement('div');
    for (let i = 0; i < 5; i++) panel.appendChild(document.createElement('span'));
    panel.addEventListener('click', () => void window.__kept.length);
    document.getElementById('host').appendChild(panel);
    document.getElementById('host').removeChild(panel);
    window.__kept.push(panel);
  };
`,
);

/**
 * Retains a closure over a sizeable payload every round, and nothing else.
 *
 * Node, listener and document counts all stay flat here — this is the leak
 * shape that counter-only checks miss, and the reason `expectNoLeak` also
 * looks at the heap curve.
 */
export const LEAKS_HEAP_ONLY = shell(
  `<div id="root-content">no dom churn here</div>`,
  `
  window.__kept = [];
  window.round = () => {
    const payload = new Array(4000).fill('x').map((c, i) => c + i);
    window.__kept.push(() => payload.length);
  };
`,
);

/** A page with a plain text input, for typing-cost calibration. */
export const TYPING = shell(
  `<input id="field" /><div id="echo"></div>`,
  `
  const field = document.getElementById('field');
  const echo = document.getElementById('echo');
  field.addEventListener('input', () => { echo.textContent = field.value; });
  window.round = () => {};
`,
);

export async function load(page: Page, html: string) {
  await page.setContent(html);
  await page.waitForFunction(() => typeof (window as never as { round?: unknown }).round === 'function');
}

/** Run one round of the fixture's own logic. */
export const round = (page: Page) =>
  page.evaluate(() => (window as never as { round: () => void }).round());
