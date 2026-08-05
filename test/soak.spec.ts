import { expect, test } from '@playwright/test';

import {
  attachCDP,
  calibrateTypingCost,
  checkLeaks,
  expectNoLeak,
  formatSoak,
  heapHalves,
  metricHalves,
  soak,
} from '../src/index.js';
import {
  addOneListener,
  CLEAN,
  LEAKS_DOCUMENTS,
  LEAKS_DOM,
  LEAKS_HEAP_ONLY,
  LEAKS_LISTENERS,
  load,
  round,
  STEPS_ONCE,
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

test('a listener leak is caught, and reported with its slope', async ({
  page,
}) => {
  await load(page, LEAKS_LISTENERS);
  const client = await attachCDP(page);

  const result = await soak({
    client,
    iterations: ITERATIONS,
    flow: () => round(page),
  });

  console.log(formatSoak('leaks listeners (expected to fail)', result));

  // The fixture touches nothing else, so the listener counter is the only
  // signal available here.
  expect(result.after.nodes).toBe(result.baseline.nodes);
  expect(result.after.documents).toBe(result.baseline.documents);

  const finding = checkLeaks(result).find((f) => f.metric === 'listeners');
  expect(finding).toBeDefined();
  expect(finding!.growth).toBeGreaterThanOrEqual(ITERATIONS - 1);
  expect(finding!.perIteration).toBeGreaterThan(0.9);
  expect(finding!.halves!.first).toBeGreaterThan(0);
  expect(finding!.halves!.second).toBeGreaterThan(0);
  expect(finding!.message).toContain('across the halves');
});

test('a listener registered once is a step, not a leak', async ({ page }) => {
  await load(page, STEPS_ONCE);
  const client = await attachCDP(page);

  const result = await soak({
    client,
    iterations: ITERATIONS,
    // One registration, early in the measured loop, kept for the rest of the
    // run. This is what lazy global setup looks like from the outside.
    flow: async (i) => {
      if (i === 10) await addOneListener(page);
    },
  });

  console.log(formatSoak('one-off listener registration', result));

  // The counter really does end above baseline, so an endpoint comparison
  // against the default allowance of 0 would call this a leak.
  expect(result.after.listeners).toBeGreaterThan(result.baseline.listeners);
  expect(metricHalves(result, 'listeners')!.first).toBeGreaterThan(0);

  // All of that growth sits in one stretch, so it is a step, not a leak.
  expectNoLeak(result);
});

test('an early step plus a late blip is still not a leak', async ({ page }) => {
  await load(page, STEPS_ONCE);
  const client = await attachCDP(page);

  const result = await soak({
    client,
    iterations: ITERATIONS,
    // Two unrelated one-offs, one in each half. This is the case that defeats
    // a first-half-vs-second-half comparison: both halves grow, so a two-way
    // split calls it a leak. Concentration does not — half the growth lands in
    // a single stretch.
    flow: async (i) => {
      if (i === 10 || i === 55) await addOneListener(page);
    },
  });

  console.log(formatSoak('step plus late blip', result));

  const halves = metricHalves(result, 'listeners')!;
  expect(halves.first).toBeGreaterThan(0);
  expect(halves.second).toBeGreaterThan(0);

  expectNoLeak(result);
});

test('a slow but steady listener leak is caught', async ({ page }) => {
  await load(page, STEPS_ONCE);
  const client = await attachCDP(page);

  const result = await soak({
    client,
    iterations: ITERATIONS,
    // Four listeners over sixty rounds, spread across the run. Only twice the
    // growth of the pair above and caught anyway, because no single stretch
    // holds more than a quarter of it.
    flow: async (i) => {
      if (i % 15 === 5) await addOneListener(page);
    },
  });

  console.log(formatSoak('slow listener leak (expected to fail)', result));

  const finding = checkLeaks(result).find((f) => f.metric === 'listeners');
  expect(finding).toBeDefined();
  expect(finding!.growth).toBe(4);
});

test('accumulating documents are caught', async ({ page }) => {
  await load(page, LEAKS_DOCUMENTS);
  const client = await attachCDP(page);

  const result = await soak({
    client,
    iterations: 20,
    flow: () => round(page),
  });

  console.log(formatSoak('leaks documents (expected to fail)', result));

  const finding = checkLeaks(result).find((f) => f.metric === 'documents');
  expect(finding).toBeDefined();
  expect(finding!.growth).toBeGreaterThanOrEqual(20);
  expect(rejection(() => expectNoLeak(result))).toContain(
    'documents accumulated',
  );
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
