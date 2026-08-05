import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  attachCDP,
  calibrateTypingCost,
  checkLeaks,
  expectNoLeak,
  formatSoak,
  soak,
  type SoakResult,
} from 'playwright-soak';

/**
 * Short enough for CI, long enough for the heap curve to have a shape. At the
 * default sample rate this is ten readings, so eight stretches between them.
 */
const ITERATIONS = 80;

/**
 * Each leak kind below gets the same flow twice over: once against the app as
 * written, once against `?leak=true`, which drops exactly one cleanup. Same
 * flow, same thresholds, opposite verdicts.
 */
async function run(
  page: Page,
  path: string,
  flow: () => Promise<void>,
  iterations = ITERATIONS,
): Promise<SoakResult> {
  await page.goto(path);
  const client = await attachCDP(page);
  return soak({ client, iterations, flow });
}

const toggle = (page: Page, open: string, close: string) => async () => {
  await page.getByRole('button', { name: open }).click();
  await page.getByRole('button', { name: close }).click();
};

test.describe('detached DOM nodes', () => {
  const drawer = (page: Page) => toggle(page, 'Open details', 'Close details');

  test('mounting and unmounting the drawer is clean', async ({ page }) => {
    const result = await run(page, '/', drawer(page));
    console.log(formatSoak('drawer', result));
    expectNoLeak(result);
  });

  test('a retained subscriber holds the drawer DOM alive', async ({ page }) => {
    const result = await run(page, '/?leak=true', drawer(page));
    console.log(formatSoak('drawer (expected to fail)', result));

    const metrics = checkLeaks(result).map((f) => f.metric);
    expect(metrics).toContain('nodes');
    // The subscriber closes over the panel, so the heap climbs alongside it.
    expect(metrics).toContain('heap');
    expect(await page.getByTestId('subscribers').textContent()).not.toBe('0');
  });
});

test.describe('event listeners', () => {
  const monitor = (page: Page) => toggle(page, 'Open monitor', 'Close monitor');

  test('opening and closing the monitor is clean', async ({ page }) => {
    const result = await run(page, '/listeners', monitor(page));
    console.log(formatSoak('monitor', result));
    expectNoLeak(result);
  });

  test('a window listener without cleanup is caught', async ({ page }) => {
    const result = await run(page, '/listeners?leak=true', monitor(page));
    console.log(formatSoak('monitor (expected to fail)', result));

    const finding = checkLeaks(result).find((f) => f.metric === 'listeners');
    expect(finding).toBeDefined();
    expect(finding!.perIteration).toBeGreaterThan(0.9);
    // The panel itself is cleaned up, so the counter is the only signal here.
    expect(result.after.nodes).toBe(result.baseline.nodes);
  });
});

test.describe('documents', () => {
  /** Fewer rounds: each leaked round mounts a whole document. */
  const ROUNDS = 20;
  const preview = (page: Page) => toggle(page, 'Open preview', 'Close preview');

  test('opening and closing the preview is clean', async ({ page }) => {
    const result = await run(page, '/embeds', preview(page), ROUNDS);
    console.log(formatSoak('preview', result));
    expectNoLeak(result);
  });

  test('an iframe left on the body is caught', async ({ page }) => {
    const result = await run(page, '/embeds?leak=true', preview(page), ROUNDS);
    console.log(formatSoak('preview (expected to fail)', result));

    const finding = checkLeaks(result).find((f) => f.metric === 'documents');
    expect(finding).toBeDefined();
    expect(finding!.growth).toBeGreaterThanOrEqual(ROUNDS);
    expect(
      await page.locator('iframe[data-preview]').count(),
    ).toBeGreaterThanOrEqual(ROUNDS);
  });
});

test.describe('heap', () => {
  const recordEvent = (page: Page) => () =>
    page.getByRole('button', { name: 'Record event' }).click();

  test('a bounded activity log is clean', async ({ page }) => {
    const result = await run(page, '/activity', recordEvent(page));
    console.log(formatSoak('activity log', result));

    expect(result.after.nodes).toBe(result.baseline.nodes);
    expectNoLeak(result);
  });

  test('an unbounded activity log is caught by the curve alone', async ({
    page,
  }) => {
    const result = await run(page, '/activity?leak=true', recordEvent(page));
    console.log(formatSoak('activity log (expected to fail)', result));

    // Every counter stays exactly put. This is the pair the counters cannot
    // tell apart, and the reason the heap curve is checked at all.
    expect(result.after.nodes).toBe(result.baseline.nodes);
    expect(result.after.listeners).toBe(result.baseline.listeners);
    expect(result.after.documents).toBe(result.baseline.documents);

    expect(checkLeaks(result).map((f) => f.metric)).toEqual(['heap']);
  });
});

test.describe('flows that should stay quiet', () => {
  test('navigating between routes does not leak', async ({ page }) => {
    const result = await run(page, '/', async () => {
      await page.getByRole('link', { name: 'Reports' }).click();
      await expect(page.getByTestId('reports')).toBeVisible();
      await page.getByRole('link', { name: 'Dashboard' }).click();
      await expect(
        page.getByRole('button', { name: 'Open details' }),
      ).toBeVisible();
    });

    console.log(formatSoak('route navigation', result));
    expectNoLeak(result);
  });

  test('typing in the settings form does not leak', async ({ page }) => {
    await page.goto('/settings');
    const client = await attachCDP(page);

    const type = async (locator: Locator) => {
      await locator.fill('');
      await locator.pressSequentially('ada', { delay: 1 });
    };

    // Before the baseline, so the control input's own nodes are baselined
    // rather than counted as growth.
    const typingCost = await calibrateTypingCost(page, client, type);

    const field = page.locator('#name');
    const result = await soak({
      client,
      iterations: ITERATIONS,
      flow: () => type(field),
    });

    console.log(formatSoak('typing', result, { typingCost }));
    expectNoLeak(result, { typingCost });
  });
});
