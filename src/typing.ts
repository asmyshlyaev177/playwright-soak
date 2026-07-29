import type { CDPSession, Locator, Page } from '@playwright/test';

import { getPageMetrics } from './metrics.js';

export type TypingGesture = (locator: Locator) => Promise<void>;

/**
 * Measure how many DOM nodes the browser retains per text-editing gesture,
 * independently of the page under test.
 *
 * Chromium charges roughly one node per editing interaction — its own
 * bookkeeping, nothing to do with your framework or your components. A plain
 * `<input>` created with `document.createElement`, never bound to anything,
 * shows the same slope. At a few hundred iterations that swamps any fixed node
 * budget, which is why typing soak tests get written off as flaky.
 *
 * So measure it against exactly such a control input, and hand the number to
 * {@link expectNoLeak} as `typingCost` so it can be budgeted for rather than
 * charged to your code.
 *
 * Call this *before* the baseline reading: the control's own nodes then sit
 * inside the baseline instead of appearing as growth.
 *
 * @param gesture The same typing gesture the flow performs, so the measured
 * cost matches what the flow will incur.
 * @returns Nodes retained per gesture. Never negative.
 */
export async function calibrateTypingCost(
  page: Page,
  client: CDPSession,
  gesture: TypingGesture,
  rounds = 20,
): Promise<number> {
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.setAttribute('data-playwright-soak-control', '');
    document.body.appendChild(input);
  });
  const control = page.locator('[data-playwright-soak-control]');

  // One gesture first, so the input's own one-off allocations land in `before`.
  await gesture(control);
  const before = await getPageMetrics(client);

  for (let i = 0; i < rounds; i++) {
    await gesture(control);
  }
  const after = await getPageMetrics(client);

  await page.evaluate(() => {
    document.querySelector('[data-playwright-soak-control]')?.remove();
  });

  return Math.max(0, (after.nodes - before.nodes) / rounds);
}
