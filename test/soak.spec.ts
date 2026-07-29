import { expect, test } from '@playwright/test';

import {
  attachCDP,
  calibrateTypingCost,
  expectNoLeak,
  formatSoak,
  heapHalves,
  soak,
} from '../src/index.js';
import {
  CLEAN,
  LEAKS_DOM,
  LEAKS_HEAP_ONLY,
  load,
  round,
  TYPING,
} from './fixtures.js';

/** Short runs — enough iterations for a readable curve, few enough to be quick. */
const ITERATIONS = 60;

/** Assert that `expectNoLeak` rejects a result, and return its message. */
const rejection = (fn: () => void): string => {
  try {
    fn();
  } catch (err) {
    return String((err as Error).message);
  }
  throw new Error('expected expectNoLeak to throw, but it passed');
};

test('a clean mount/unmount flow passes', async ({ page }) => {
  await load(page, CLEAN);
  const client = await attachCDP(page);

  const result = await soak({
    client,
    iterations: ITERATIONS,
    flow: () => round(page),
  });

  console.log(formatSoak('clean', result));
  expectNoLeak(result);
});

test('retained detached nodes and listeners are caught', async ({ page }) => {
  await load(page, LEAKS_DOM);
  const client = await attachCDP(page);

  const result = await soak({
    client,
    iterations: ITERATIONS,
    flow: () => round(page),
  });

  console.log(formatSoak('leaks dom (expected to fail)', result));

  expect(result.after.nodes).toBeGreaterThan(result.baseline.nodes + 100);
  expect(result.after.listeners).toBeGreaterThan(result.baseline.listeners);
  expect(rejection(() => expectNoLeak(result))).toContain('accumulated');
});

test('a heap-only leak is caught, which the counters alone would miss', async ({
  page,
}) => {
  await load(page, LEAKS_HEAP_ONLY);
  const client = await attachCDP(page);

  const result = await soak({
    client,
    iterations: ITERATIONS,
    flow: () => round(page),
  });

  console.log(formatSoak('leaks heap only (expected to fail)', result));

  // The point of the fixture: every counter stays put.
  expect(result.after.nodes).toBe(result.baseline.nodes);
  expect(result.after.listeners).toBe(result.baseline.listeners);
  expect(result.after.documents).toBe(result.baseline.documents);

  // The heap curve is what gives it away.
  const halves = heapHalves(result);
  expect(halves).toBeDefined();
  expect(halves!.second).toBeGreaterThan(halves!.first * 0.5);
  expect(rejection(() => expectNoLeak(result))).toContain('second half');
});

test('typing cost is measured and budgeted for', async ({ page }) => {
  await load(page, TYPING);
  const client = await attachCDP(page);

  const type = async (locator: ReturnType<typeof page.locator>) => {
    await locator.fill('');
    await locator.pressSequentially('abcde', { delay: 1 });
  };

  const typingCost = await calibrateTypingCost(page, client, type);
  // Chromium charges for editing; if it ever stops, the budget is simply zero
  // and the assertion below still holds.
  expect(typingCost).toBeGreaterThanOrEqual(0);

  const field = page.locator('#field');
  const result = await soak({
    client,
    iterations: ITERATIONS,
    flow: () => type(field),
  });

  console.log(formatSoak('typing', result, { typingCost }));

  expectNoLeak(result, { typingCost });
});

test('heapHalves needs enough samples to split', async ({ page }) => {
  await load(page, CLEAN);
  const client = await attachCDP(page);

  const result = await soak({
    client,
    iterations: 4,
    warmup: 1,
    sampleEvery: 4, // only the final reading is sampled
    flow: () => round(page),
  });

  expect(result.samples).toHaveLength(1);
  expect(heapHalves(result)).toBeUndefined();
  // and the heap check is skipped rather than throwing
  expectNoLeak(result);
});
