---
name: interpreting-results
description: >
  Decide whether a playwright-soak run actually leaked and which threshold to
  move. Covers expectNoLeak, checkLeaks, LeakFinding, LeakThresholds (nodes,
  listeners, documents, typingCost, heapRatio, heapNoise), reading the
  formatSoak log block, and the heapHalves / metricHalves / metricStretches
  helpers behind the verdict. Load when a soak test fails and it is unclear
  whether the growth is real, when tuning leak thresholds for an application,
  when a soak test is called flaky, or when asserting on one metric rather
  than the whole result.
metadata:
  type: core
  library: playwright-soak
  library_version: '0.1.0'
sources:
  - 'asmyshlyaev177/playwright-soak:src/assert.ts'
  - 'asmyshlyaev177/playwright-soak:src/format.ts'
  - 'asmyshlyaev177/playwright-soak:src/soak.ts'
  - 'asmyshlyaev177/playwright-soak:README.md'
  - 'asmyshlyaev177/playwright-soak:test/soak.spec.ts'
---

# playwright-soak — Interpreting a soak result

A verdict is never read off the endpoints. The counters fail on
**concentration**: growth counts as a leak only when no single stretch between
readings holds half of it or more. A leak repeats, so its growth spreads across
every stretch; a cache warming up, a lazily registered global or one of the
transient listeners Chromium adds and drops again piles all its growth into one
stretch and leaves the rest flat.

The heap is judged on shape rather than size. `checkLeaks` compares second-half
growth to first-half growth and never bounds the absolute delta.

## Setup

```ts
import { expect, test } from '@playwright/test';
import { attachCDP, checkLeaks, formatSoak, soak } from 'playwright-soak';

test('the monitor panel leaks no listeners', async ({ page }) => {
  await page.goto('/listeners');
  const client = await attachCDP(page);

  const result = await soak({
    client,
    iterations: 200,
    flow: async () => {
      await page.getByRole('button', { name: 'Open monitor' }).click();
      await page.getByRole('button', { name: 'Close monitor' }).click();
    },
  });

  console.log(formatSoak('monitor', result));
  expect(checkLeaks(result)).toEqual([]);
});
```

## Core Patterns

### Read the log block a failing run prints

```text
[soak] drawer — 200 iterations
    base     heap   2.77MB  nodes     45  listeners   163  docs 1
    @   25   heap   2.90MB  nodes     45  listeners   163  docs 1
    @  200   heap   3.21MB  nodes     45  listeners   163  docs 1
    delta  heap +0.44MB  nodes +0  listeners +0  docs +0
    per-iteration  heap 2.27KB  nodes 0.00  listeners 0.000
    heap halves  1st 0.30MB  2nd 0.14MB  (split @100; a settling curve has 2nd well under 1st)
    listeners ·+·····+·  +2 total, biggest stretch 50% of it (concentrated, so a step)
```

The last kind of line is the verdict for a counter, one character per stretch:
`+` grew, `-` shrank, `·` held. Under 50% in one stretch reads as accumulating;
50% or more reads as a step and is discarded. A settling heap curve has a
second half well under its first.

### Ask which metric moved, and treat each differently

```ts
const findings = checkLeaks(result);
for (const f of findings) {
  console.log(f.metric, f.growth, f.perIteration, f.halves, f.message);
}
```

| Finding     | What it points at                                                    |
| ----------- | -------------------------------------------------------------------- |
| `nodes`     | Detached DOM held by a closure, a cache or a stale ref               |
| `listeners` | A handler added without a matching removal                           |
| `documents` | An iframe still attached and never unmounted, not a detached one     |
| `heap`      | Retention none of the counters see: closures, growing arrays, caches |

A removed iframe has its document torn down by Chromium, so `documents` stays
flat; a rising count means frames that are still in the tree.

### Assert on one metric when that is the only signal available

```ts
const finding = checkLeaks(result).find((f) => f.metric === 'listeners');
expect(finding).toBeDefined();
expect(finding!.perIteration).toBeGreaterThan(0.9);
expect(result.after.nodes).toBe(result.baseline.nodes);
```

`checkLeaks` returns findings and throws nothing, so it composes with any
assertion library. `expectNoLeak` is the same check with a throw attached.

### Inspect the series directly when the verdict is disputed

```ts
import { heapHalves, metricHalves, metricStretches } from 'playwright-soak';

console.log(heapHalves(result)); // { first, second, midIteration } | undefined
console.log(metricHalves(result, 'nodes'));
console.log(metricStretches(result, 'listeners')); // [{ from, to, delta }, ...]
```

Both halves helpers return `undefined` when there are too few samples to split,
which is also when the heap check is skipped rather than failed.

## Common Mistakes

### CRITICAL checkLeaks used as if it asserts

Wrong:

```ts
checkLeaks(result, { nodes: 200 });
```

Correct:

```ts
expect(checkLeaks(result, { nodes: 200 })).toEqual([]);
```

`checkLeaks` is pure — it returns a `LeakFinding[]` and never throws — so
calling it for a side effect leaves the test green on every leak. Use
`expectNoLeak` when the return value is not needed.

Source: `src/assert.ts:99-108`

### HIGH Endpoint delta asserted instead of expectNoLeak

Wrong:

```ts
expect(result.after.nodes - result.baseline.nodes).toBeLessThan(100);
expect(result.after.listeners).toBe(result.baseline.listeners);
```

Correct:

```ts
expectNoLeak(result);
```

A before/after delta cannot separate a leak from a one-off step: a global
listener registered lazily on first interaction ends above baseline and fails
this assertion, while growth spread thinly across the run can pass under it. A
flow ending `+4` listeners can be a leak where one ending `+2` is not.

Source: `src/assert.ts:61-91`, `test/soak.spec.ts:98-121`

### HIGH Thresholds raised until the run goes green

Wrong:

```ts
expectNoLeak(result, { nodes: 5000, listeners: 50 });
```

Correct:

```ts
expectNoLeak(result, { nodes: 100 });
```

The counter checks already discard one-off steps and browser blips before
reporting anything, so a reported counter is spread-out accumulation by
construction; a larger allowance only moves the iteration count at which the
same leak is noticed. `listeners` defaults to `0` for this reason — an
unmatched listener is a bug, not noise.

Source: `src/assert.ts:61-91`, `src/assert.ts:121-138`

### HIGH heapNoise dropped to zero to make the heap check strict

Wrong:

```ts
expectNoLeak(result, { heapNoise: 0, heapRatio: 0.1 });
```

Correct:

```ts
const result = await soak({ client, flow, iterations: 400 });
expectNoLeak(result);
```

`heapNoise` is the floor that stops an already-flat flow from being judged on
the ratio between two noise readings; remove it and the run fails at random.
Length is the lever for heap sensitivity — the check bites once first-half
growth exceeds twice the floor.

Source: `src/assert.ts:38-45`, `src/assert.ts:165-178`

### MEDIUM Heap finding read as the heap grew too much

Wrong:

```ts
expectNoLeak(result, { heapRatio: 2 });
```

Correct:

```ts
const halves = heapHalves(result);
console.log(halves?.first, halves?.second, halves?.midIteration);
```

The heap finding says the curve climbed as fast in its second half as its
first, not that it climbed far: a flow allocating megabytes and then settling
passes, while one allocating steadily fails at a fraction of the size. Widening
`heapRatio` disables the only check that catches a leak moving no counter.

Source: `src/assert.ts:165-178`, `src/soak.ts:143-168`

### MEDIUM A node finding on a typing flow charged to the application

Wrong:

```ts
expectNoLeak(result, { nodes: 400 });
```

Correct:

```ts
const typingCost = await calibrateTypingCost(page, client, type);
expectNoLeak(result, { typingCost });
```

Chromium retains roughly one node per text-editing gesture as its own
bookkeeping, so any flow that types accrues nodes no application change will
remove; `typingCost` budgets for it and scales with the iteration count.

Source: `src/assert.ts:140-149`, `src/typing.ts:7-27`

### HIGH Tension: threshold tuning versus signal preservation

Applications with a large or noisy DOM do sometimes need a larger `nodes`
allowance, and the same edit silences genuine accumulation. Agents asked to
make a red suite green raise `nodes` and `listeners`, when the growth they are
absorbing is exactly the growth the concentration rule already declared to be a
leak rather than a step.

See also: `typing-flows/SKILL.md` § Common Mistakes

See also: `writing-soak-tests/SKILL.md` — `iterations` and `sampleEvery` decide
which of these checks can fire at all.
