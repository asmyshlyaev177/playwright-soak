# playwright-soak

Soak-test Playwright flows for memory leaks. Repeat a user flow a few hundred
times, force garbage collection, and assert that DOM nodes, event listeners,
documents and heap do not accumulate.

No runtime dependencies. Peer dep on `@playwright/test`. Chromium only — the
readings come from the Chrome DevTools Protocol.

```sh
npm install -D playwright-soak
```

## Usage

```ts
import { test } from '@playwright/test';
import { attachCDP, expectNoLeak, formatSoak, soak } from 'playwright-soak';

test('opening and closing the drawer does not leak', async ({ page }) => {
  await page.goto('/dashboard');

  const client = await attachCDP(page);
  const result = await soak({
    client,
    flow: async () => {
      await page.getByRole('button', { name: 'Open' }).click();
      await page.getByRole('button', { name: 'Close' }).click();
    },
  });

  console.log(formatSoak('drawer', result));
  expectNoLeak(result);
});
```

`soak` warms up (5 rounds by default), takes a baseline, runs the flow 200
times taking periodic readings, and takes a final reading. It asserts nothing —
`expectNoLeak` does that, so you can apply your own judgement to the samples
instead if you prefer.

Output:

```
[soak] drawer — 200 iterations
    base     heap   3.40MB  nodes    270  listeners   325  docs 4
    @    50  heap   3.73MB  nodes    270  listeners   325  docs 4
    @   100  heap   3.80MB  nodes    270  listeners   325  docs 4
    @   150  heap   3.88MB  nodes    270  listeners   325  docs 4
    @   200  heap   3.93MB  nodes    270  listeners   325  docs 4
    delta  heap +0.53MB  nodes +0  listeners +0  docs +0
    per-iteration  heap 2.72KB  nodes 0.00  listeners 0.000
    heap halves  1st 0.40MB  2nd 0.13MB  (split @100; a settling curve has 2nd well under 1st)
```

## Why the heap curve matters

Counting nodes, listeners and documents misses a whole class of leak. A stale
subscriber callback closing over a component tree, or an unbounded cache of
plain objects, moves **none** of those counters — it only moves the heap. But
absolute heap delta is too noisy to bound directly, so `expectNoLeak` tests the
*shape*: a real per-iteration leak holds a roughly constant slope and grows its
second half as much as its first, while warm-up allocation and caching decay
towards flat.

The package's own test suite includes a fixture that leaks a closure per round
and nothing else. Its counters are exactly flat and its heap halves are
identical (2.63MB then 2.63MB) — caught by the curve check alone.

## Typing flows

Chromium retains about **one DOM node per text-editing gesture**. That is its
own bookkeeping — a plain `<input>` created with `document.createElement` and
bound to nothing shows the same slope, with no framework involved. At 200
iterations it swamps any fixed node budget, which is why typing soak tests get
written off as flaky.

Measure it against exactly such a control input and budget for it:

```ts
const type = async (locator) => {
  await locator.fill('');
  await locator.pressSequentially('hello', { delay: 5 });
};

const typingCost = await calibrateTypingCost(page, client, type);
const result = await soak({ client, flow: () => type(page.locator('#name')) });

expectNoLeak(result, { typingCost });
```

Call `calibrateTypingCost` **before** the baseline reading, so the control's own
nodes sit inside the baseline rather than appearing as growth.

## API

| export | purpose |
| --- | --- |
| `attachCDP(page)` | Open a CDP session with `Performance` enabled. |
| `getPageMetrics(client)` | Collect garbage twice, then read `{ heap, nodes, listeners, documents }`. |
| `soak({ client, flow, iterations, warmup, sampleEvery })` | Warm up, baseline, loop, sample, final reading. |
| `expectNoLeak(result, thresholds?)` | Assert no accumulation. See thresholds below. |
| `heapHalves(result)` | First-half vs. second-half heap growth, or `undefined` if unsplittable. |
| `calibrateTypingCost(page, client, gesture, rounds?)` | Nodes the browser charges per editing gesture. |
| `formatSoak(name, result, extra?)` | Fixed-width block for the test log. |

### Thresholds

| option | default | meaning |
| --- | --- | --- |
| `nodes` | `100` | DOM nodes allowed above baseline. A fixed allowance behaves better than a percentage on small trees. |
| `listeners` | `0` | Listeners are registered deliberately; an unmatched one is a bug, not noise. |
| `documents` | `0` | Detached documents allowed above baseline. |
| `typingCost` | `0` | From `calibrateTypingCost`. Added to the node allowance with 10% slack. |
| `heapRatio` | `0.5` | Fraction of first-half growth the second half may reach. Across five frameworks the worst healthy ratio observed was 0.23. |
| `heapNoise` | `256KB` | Absolute slack, so an already-flat flow is not judged on the ratio between two noise readings. |

## Notes

Garbage is collected **twice** before every reading. A single pass
intermittently leaves detached subtrees in the node count — about one reading
in six.

Prefer flows that return to their starting state, so session history stays
bounded. A flow that only pushes history entries grows browser-side bookkeeping
that is not your leak.

## Relationship to memlab

[memlab](https://github.com/facebook/memlab) answers a different question, and
the two work well together. memlab diffs V8 heap snapshots across one
action/back cycle and tells you *which object* leaked and *what retains it* —
far better diagnostics than counters. It is Puppeteer-only
([facebook/memlab#138](https://github.com/facebook/memlab/issues/138)) and
heavier to run.

This package is the smoke alarm: cheap enough to run on every PR inside an
existing Playwright suite, and able to distinguish slow accumulation from
one-off caching by watching the curve over hundreds of rounds. When it goes
red, reach for memlab to find out what is holding the memory.

## Credit

The warmup/baseline/loop structure, the double collection and the fixed
100-node allowance come from Den Odell's
[Your SPA is leaking memory — soak test it](https://denodell.com/blog/your-spa-is-leaking-memory-soak-test-it).

## License

MIT
