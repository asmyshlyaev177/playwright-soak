---
name: writing-soak-tests
description: >
  Write a Playwright memory-leak soak test with playwright-soak. Covers
  attachCDP, soak({ client, flow, iterations, warmup, sampleEvery }),
  getPageMetrics, shaping a flow that survives repetition, and the
  playwright.config.ts a few-hundred-iteration run needs (Chromium-only
  projects, raised timeout, production build rather than dev server). Load
  when adding a memory leak or soak test, repeating a user flow to detect
  detached DOM nodes, event listener growth or heap climb, or when a soak run
  times out or errors instead of reporting a verdict.
metadata:
  type: core
  library: playwright-soak
  library_version: '0.1.0'
sources:
  - 'asmyshlyaev177/playwright-soak:src/soak.ts'
  - 'asmyshlyaev177/playwright-soak:src/metrics.ts'
  - 'asmyshlyaev177/playwright-soak:README.md'
  - 'asmyshlyaev177/playwright-soak:playwright.config.ts'
  - 'asmyshlyaev177/playwright-soak:examples/tanstack-spa/e2e/soak.spec.ts'
  - 'asmyshlyaev177/playwright-soak:examples/tanstack-spa/playwright.config.ts'
---

# playwright-soak — Writing a soak test

`soak` repeats a flow, forces garbage collection, and records four counters —
`heap`, `nodes`, `listeners`, `documents` — at intervals across the run. It
asserts nothing. `expectNoLeak` reads the resulting series and throws.

The readings come from the Chrome DevTools Protocol, so runs are Chromium-only.
`@playwright/test` is a peer dependency and a type-only import.

## Setup

```ts
import { test } from '@playwright/test';
import { attachCDP, expectNoLeak, formatSoak, soak } from 'playwright-soak';

test('opening and closing the drawer does not leak', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'CDP metrics are Chromium-only');

  await page.goto('/dashboard');
  const client = await attachCDP(page);

  const result = await soak({
    client,
    iterations: 200,
    flow: async () => {
      await page.getByRole('button', { name: 'Open details' }).click();
      await page.getByRole('button', { name: 'Close details' }).click();
    },
  });

  console.log(formatSoak('drawer', result));
  expectNoLeak(result);
});
```

The matching Playwright project:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Hundreds of iterations plus two forced collections per reading run well
  // past the 30s default.
  timeout: 3 * 60 * 1000,
  fullyParallel: false,
  workers: 1,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    // A production build, not the dev server: HMR allocates on its own
    // schedule and lands in the heap curve as noise.
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
  },
});
```

## Core Patterns

### Size the loop for the signal you want

```ts
const result = await soak({
  client,
  flow,
  iterations: 200, // default 200
  warmup: 5, // default 5, runs before the baseline reading
  sampleEvery: 25, // default Math.max(1, Math.floor(iterations / 8))
});
```

`warmup` takes first render, lazy imports and connection setup before the
baseline, so those one-off allocations are not counted as growth. `sampleEvery`
sets how many stretches the run has to judge: eight or more separates a leak
spread thin across the run from a step piled into one moment. The heap check
needs first-half growth above twice `heapNoise` (256KB) before it can fire,
which on a typical application means a run of a few hundred iterations.

### Drive flows that return to their starting state

```ts
const result = await soak({
  client,
  flow: async () => {
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page.getByTestId('reports')).toBeVisible();
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(
      page.getByRole('button', { name: 'Open details' }),
    ).toBeVisible();
  },
});
```

Each round ends where it started, so session history stays bounded. A flow that
only pushes history entries grows browser-side bookkeeping that is not the
application's leak. Awaiting a visible landmark at each end keeps rounds from
overlapping.

### Prove the check can fail before trusting it

```ts
import { expect, test } from '@playwright/test';
import { attachCDP, checkLeaks, formatSoak, soak } from 'playwright-soak';

test('a retained subscriber holds the drawer DOM alive', async ({ page }) => {
  await page.goto('/?leak=true');
  const client = await attachCDP(page);

  const result = await soak({
    client,
    iterations: 80,
    flow: async () => {
      await page.getByRole('button', { name: 'Open details' }).click();
      await page.getByRole('button', { name: 'Close details' }).click();
    },
  });

  console.log(formatSoak('drawer (expected to fail)', result));
  expect(checkLeaks(result).map((f) => f.metric)).toContain('nodes');
});
```

A green soak test proves nothing until a deliberately leaky variant of the same
flow goes red under the same thresholds. Drive the leak from a query parameter
or a test-only flag so both halves share one flow.

### Take readings without the loop

```ts
import { attachCDP, getPageMetrics } from 'playwright-soak';

const client = await attachCDP(page);
const before = await getPageMetrics(client);
await page.getByRole('button', { name: 'Import' }).click();
const after = await getPageMetrics(client);
console.log(after.nodes - before.nodes, after.heap - before.heap);
```

`getPageMetrics` collects garbage twice, then reads the counters. One pass
intermittently leaves detached subtrees in the node count, which is why it runs
twice.

## Common Mistakes

### CRITICAL Soak result computed but never asserted

Wrong:

```ts
const result = await soak({ client, flow });
console.log(formatSoak('drawer', result));
```

Correct:

```ts
const result = await soak({ client, flow });
console.log(formatSoak('drawer', result));
expectNoLeak(result);
```

`soak` only measures — it returns readings and throws nothing — so a spec that
logs the result and stops there passes on every leak, forever.

Source: `src/soak.ts:42-49`

### HIGH Flow derives page state from the iteration index

Wrong:

```ts
flow: async (i) => {
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('page')).toHaveText(String(i + 1));
};
```

Correct:

```ts
flow: async () => {
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Previous' }).click();
};
```

`warmup` rounds run before iteration 0, so the page has already advanced five
steps by the time the index reads zero; the flow must track its own state
rather than deriving it from the loop counter.

Source: `src/soak.ts:57-59`, `src/soak.ts:85-102`

### HIGH Non-Chromium projects left in the Playwright config

Wrong:

```ts
projects: [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
];
```

Correct:

```ts
projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }];
```

`attachCDP` opens a CDP session, which Firefox and WebKit do not implement, so
those projects error before a single reading is taken. Keep other engines by
guarding the test with `test.skip(browserName !== 'chromium', ...)` instead.

Source: `src/metrics.ts:15-26`

### HIGH Run too short for the heap check to engage

Wrong:

```ts
const result = await soak({ client, flow, iterations: 20 });
expectNoLeak(result);
```

Correct:

```ts
const result = await soak({ client, flow, iterations: 200 });
expectNoLeak(result);
```

The heap check compares second-half growth against
`max(firstHalf * heapRatio, heapNoise)`, and with `heapNoise` at 256KB a short
run rarely clears the floor — so a leak that moves only the heap, such as an
unbounded cache of plain objects, passes on the counters alone.

Source: `src/assert.ts:38-45`, `src/assert.ts:165-178`

### HIGH Default Playwright timeout left in place

Wrong:

```ts
export default defineConfig({ testDir: './e2e' });
```

Correct:

```ts
export default defineConfig({
  testDir: './e2e',
  timeout: 3 * 60 * 1000,
  fullyParallel: false,
  workers: 1,
});
```

Two forced collections per reading on top of a few hundred rounds run past the
30s default, and the failure surfaces as a locator timeout, which reads like a
flaky selector rather than a run that is simply longer than the budget.

Source: `playwright.config.ts:6-8`, `examples/tanstack-spa/playwright.config.ts:5-9`

### MEDIUM Page reloaded inside the flow

Wrong:

```ts
flow: async () => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Open details' }).click();
};
```

Correct:

```ts
await page.goto('/dashboard');
const client = await attachCDP(page);
const result = await soak({
  client,
  flow: async () => {
    await page.getByRole('button', { name: 'Open details' }).click();
    await page.getByRole('button', { name: 'Close details' }).click();
  },
});
```

A full navigation replaces the document and drops everything the previous one
retained, so accumulation resets every round and all four counters read flat —
the run passes while measuring nothing.

Source: `README.md` (Usage), `examples/tanstack-spa/e2e/soak.spec.ts:23-32`

### MEDIUM sampleEvery set so coarse the run has no shape

Wrong:

```ts
const result = await soak({ client, flow, iterations: 200, sampleEvery: 200 });
```

Correct:

```ts
const result = await soak({ client, flow, iterations: 200 });
```

Every check reads the series between readings, so with a single reading
`metricHalves` returns `undefined` and the heap check is skipped entirely,
while the counter checks lose the concentration test and report a harmless
one-off step as a leak.

Source: `src/soak.ts:153-168`, `src/assert.ts:84-91`, `test/soak.spec.ts:242-257`

### MEDIUM Soaking the dev server instead of a production build

Wrong:

```ts
webServer: { command: 'npm run dev', url: 'http://localhost:5173' }
```

Correct:

```ts
webServer: {
  command: 'npm run build && npm run preview',
  url: 'http://localhost:4173',
  reuseExistingServer: false,
}
```

The HMR client allocates on its own schedule, so its growth lands in the heap
curve and is charged to the flow; `reuseExistingServer: false` also stops a
server left over from an earlier run from quietly serving stale code.

Source: `examples/tanstack-spa/playwright.config.ts:14-24`

### HIGH Tension: fast CI runs blunt the heap check

Short runs keep a soak suite cheap enough for every pull request, but the heap
check cannot fire until first-half growth clears twice `heapNoise`. Agents
optimising for CI time trim `iterations` and produce a suite that still catches
node, listener and document leaks but has silently stopped catching heap-only
ones — and a green run reads as broader coverage than it is.

See also: `interpreting-results/SKILL.md` § Common Mistakes

See also: `typing-flows/SKILL.md` — a flow that types needs `calibrateTypingCost`
called before the baseline, which constrains the order of this spec.
