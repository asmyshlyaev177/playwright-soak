---
name: typing-flows
description: >
  Soak a form field or text input with playwright-soak without the run failing
  on Chromium's own bookkeeping. Covers calibrateTypingCost, the TypingGesture
  signature, the typingCost threshold on expectNoLeak, and passing the measured
  cost to formatSoak. Load when a soak test that types into an input reports
  accumulating DOM nodes, when a typing or form soak test is called flaky, or
  when a flow uses fill / pressSequentially / press inside the soak loop.
metadata:
  type: core
  library: playwright-soak
  library_version: '0.1.0'
sources:
  - 'asmyshlyaev177/playwright-soak:src/typing.ts'
  - 'asmyshlyaev177/playwright-soak:src/assert.ts'
  - 'asmyshlyaev177/playwright-soak:README.md'
  - 'asmyshlyaev177/playwright-soak:examples/tanstack-spa/e2e/soak.spec.ts'
---

# playwright-soak — Soaking a typing flow

Chromium retains about **one DOM node per text-editing gesture**. That is its
own bookkeeping, not the application's: a plain `<input>` built with
`document.createElement` and bound to nothing shows the same slope. Over a few
hundred iterations it swamps the default 100-node allowance, which is why
typing soak tests get written off as flaky.

`calibrateTypingCost` measures that slope against exactly such a control input,
and `typingCost` budgets for it.

## Setup

```ts
import { type Locator, test } from '@playwright/test';
import {
  attachCDP,
  calibrateTypingCost,
  expectNoLeak,
  formatSoak,
  soak,
} from 'playwright-soak';

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
    iterations: 200,
    flow: () => type(field),
  });

  console.log(formatSoak('typing', result, { typingCost }));
  expectNoLeak(result, { typingCost });
});
```

## Core Patterns

### Define the gesture once and hand it to both

```ts
const type = async (locator: Locator) => {
  await locator.fill('');
  await locator.pressSequentially('hello', { delay: 5 });
};

const typingCost = await calibrateTypingCost(page, client, type);
const result = await soak({ client, flow: () => type(page.locator('#name')) });
```

`TypingGesture` is `(locator: Locator) => Promise<void>`. Calibration appends a
control input to `document.body`, runs the gesture once so the input's own
one-off allocations are excluded, measures across `rounds` further calls (20 by
default, changeable with a fourth argument), then removes the control.

### Print the budget alongside the result

```ts
console.log(formatSoak('typing', result, { typingCost }));
```

```text
    per-iteration  heap 1.84KB  nodes 1.03  listeners 0.000
    browser typing cost 1.00 nodes/round (budgeted for)
```

Without that line a reviewer sees a node slope of roughly one per iteration and
no indication it was expected.

### Read what the budget becomes

`expectNoLeak` turns the measurement into a node budget of
`nodes + ceil(typingCost * iterations * 1.1)` — the fixed 100-node allowance
plus the browser's charge across the whole run with 10% slack — and reports
growth that reaches it. At 1 node per gesture that is a budget of 320 over 200
iterations and 540 over 400, so the same threshold keeps working when the run
length changes. Growth past it belongs to the application.

## Common Mistakes

### HIGH calibrateTypingCost called after the baseline

Wrong:

```ts
const result = await soak({ client, flow: () => type(field) });
const typingCost = await calibrateTypingCost(page, client, type);
expectNoLeak(result, { typingCost });
```

Correct:

```ts
const typingCost = await calibrateTypingCost(page, client, type);
const result = await soak({ client, flow: () => type(field) });
expectNoLeak(result, { typingCost });
```

Calibration appends a control `<input>` and types into it; run after `soak` has
taken its baseline, the nodes that gesture retains land inside the measured
window and are charged to the flow instead of sitting inside the baseline.

Source: `src/typing.ts:20-22`, `src/typing.ts:34-54`

### HIGH typingCost measured but never passed to expectNoLeak

Wrong:

```ts
const typingCost = await calibrateTypingCost(page, client, type);
const result = await soak({ client, iterations: 200, flow: () => type(field) });
expectNoLeak(result);
```

Correct:

```ts
const typingCost = await calibrateTypingCost(page, client, type);
const result = await soak({ client, iterations: 200, flow: () => type(field) });
expectNoLeak(result, { typingCost });
```

`typingCost` defaults to `0`, so the measurement changes nothing unless it is
handed to the check — and at roughly one node per gesture, 200 iterations clear
the default 100-node allowance on browser bookkeeping alone.

Source: `src/typing.ts:7-27`, `src/assert.ts:140-149`

### HIGH Calibration gesture differs from the flow's gesture

Wrong:

```ts
const typingCost = await calibrateTypingCost(page, client, (l) =>
  l.fill('hello'),
);
const result = await soak({
  client,
  flow: () => field.pressSequentially('hello', { delay: 5 }),
});
```

Correct:

```ts
const type = async (locator: Locator) => {
  await locator.fill('');
  await locator.pressSequentially('hello', { delay: 5 });
};
const typingCost = await calibrateTypingCost(page, client, type);
const result = await soak({ client, flow: () => type(field) });
```

The cost is charged per call of the gesture handed to it, and `fill()` is a
single edit where `pressSequentially('hello')` is five, so the budget comes out
about a fifth of what the flow actually spends and the run fails on the
shortfall.

Source: `src/typing.ts:24-26`, `examples/tanstack-spa/e2e/soak.spec.ts:148-170`

### MEDIUM Node allowance hand-tuned instead of budgeted

Wrong:

```ts
expectNoLeak(result, { nodes: 400 });
```

Correct:

```ts
expectNoLeak(result, { typingCost });
```

`typingCost` scales with the iteration count while a fixed allowance does not,
so a hand-picked number is right at one run length and wrong at every other —
too tight once the run grows, and blind to a real leak once it shrinks. It also
loses the record of _why_ the number is large.

Source: `src/assert.ts:140-141`

### MEDIUM Field left filled between rounds

Wrong:

```ts
const type = async (locator: Locator) => {
  await locator.pressSequentially('hello', { delay: 5 });
};
```

Correct:

```ts
const type = async (locator: Locator) => {
  await locator.fill('');
  await locator.pressSequentially('hello', { delay: 5 });
};
```

Without the reset each round appends to the previous value, so the field's
content — and anything the application derives from it — grows with the loop,
which reads as accumulation on the heap that no cleanup would remove.

Source: `test/soak.spec.ts:216-240`, `examples/tanstack-spa/e2e/soak.spec.ts:148-170`

See also: `interpreting-results/SKILL.md` — a node finding on a flow that types
is the first thing to check `typingCost` against.

See also: `writing-soak-tests/SKILL.md` — calibration must run before the
baseline, which fixes the order of the surrounding spec.
