# playwright-soak

[![npm](https://img.shields.io/npm/v/playwright-soak.svg)](https://www.npmjs.com/package/playwright-soak)
[![Tests](https://github.com/asmyshlyaev177/playwright-soak/actions/workflows/tests.yml/badge.svg)](https://github.com/asmyshlyaev177/playwright-soak/actions/workflows/tests.yml)
[![npm downloads](https://img.shields.io/npm/dm/playwright-soak.svg)](https://www.npmjs.com/package/playwright-soak)
[![license](https://img.shields.io/npm/l/playwright-soak.svg)](./LICENSE)

Your single-page app probably leaks memory. Most do, a little. The leaks worth
chasing are the ones that repeat _per interaction_, since those are what turn a
long session into a sluggish, half-frozen tab. They are also easy to miss in
development, where you reload the page every few minutes anyway.

playwright-soak catches them from inside a Playwright test. Give it a flow:
open a drawer and close it, switch routes, type in a field. It repeats that flow
a few hundred times, forces garbage collection, and fails the test if DOM nodes,
event listeners, documents or the heap keep piling up.

Think smoke alarm rather than debugger. It tells you _that_ something
accumulates and on which flow. Finding the object that holds the memory is a
different job, and [memlab](#relationship-to-memlab) is better at it.

```sh
npm install -D playwright-soak
```

No runtime dependencies. `@playwright/test` is a peer dependency and a type-only
import. Chromium only, since the readings come from the Chrome DevTools
Protocol.

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

`soak` warms up (5 rounds by default), takes a baseline, runs the flow 200 times
taking readings along the way, then takes a final one. It asserts nothing by
itself. `expectNoLeak` does that, so you can skip it and judge the samples
yourself if you would rather.

Output:

```text
[soak] drawer — 200 iterations
    base     heap   2.77MB  nodes     45  listeners   163  docs 1
    @   25  heap   2.90MB  nodes     45  listeners   163  docs 1
    @   50  heap   2.97MB  nodes     45  listeners   164  docs 1
    @   75  heap   3.03MB  nodes     45  listeners   163  docs 1
    @  100  heap   3.07MB  nodes     45  listeners   163  docs 1
    @  125  heap   3.18MB  nodes     45  listeners   163  docs 1
    @  150  heap   3.21MB  nodes     45  listeners   163  docs 1
    @  175  heap   3.22MB  nodes     45  listeners   163  docs 1
    @  200  heap   3.21MB  nodes     45  listeners   163  docs 1
    delta  heap +0.44MB  nodes +0  listeners +0  docs +0
    per-iteration  heap 2.27KB  nodes 0.00  listeners 0.000
    heap halves  1st 0.30MB  2nd 0.14MB  (split @100; a settling curve has 2nd well under 1st)
```

The intermediate rows are the point. A single before/after delta cannot tell a
leak apart from a cache warming up, and a series can.

That run also caught Chromium doing its thing: one listener appears at `@50` and
is gone again by `@75`. Judging endpoints alone, a blip landing on the last
reading instead would have failed the build.

## What counts as a leak

Four things get read after every forced collection, and each catches a different
kind of retention:

| signal      | catches                                                               |
| ----------- | --------------------------------------------------------------------- |
| `nodes`     | detached DOM kept alive by a closure, a cache or a stale ref          |
| `listeners` | handlers added without a matching removal                             |
| `documents` | iframes and documents that mount per interaction and never unmount    |
| `heap`      | retention that is none of the above: closures, growing arrays, caches |

None of them is judged on where it ended up. A leak repeats, so its growth
spreads thin across every stretch between readings. A cache warming up, a
lazily registered global, one of the transient listeners Chromium adds and drops
again: each piles all its growth into a single stretch. So the counters fail on
concentration, not on size — **no one stretch may hold half the growth or
more** — and that is why the intermediate samples exist.

It cuts both ways. A flow that ends `+2` listeners can pass while one that ends
`+4` fails:

```text
listeners ·+·····+·  +2 total, biggest stretch 50% of it (concentrated, so a step)
listeners ·+·+·+·+·  +4 total, biggest stretch 25% of it (spread out, so accumulating)
```

Measuring concentration rather than counting the stretches that grow keeps the
verdict stable when you change `sampleEvery`: sample more finely and a real leak
only looks more spread out, while a step stays pinned at all of it.

The blind spot is a leak living underneath one much larger step, which stays
concentrated and passes. Warmup exists to take the usual such step — first
render, lazy imports — before the baseline is read.

## Why the heap curve matters

Counting nodes, listeners and documents misses a whole class of leak. A stale
subscriber callback closing over a component tree, or an unbounded cache of
plain objects, moves **none** of those counters. It only moves the heap.

Absolute heap growth is too noisy to put a number on, so `expectNoLeak` looks at
the shape instead. A real per-iteration leak holds a roughly constant slope and
grows its second half about as much as its first. Warm-up allocation and caching
decay towards flat.

The package's own test suite has a fixture that leaks one closure per round and
nothing else. Its counters are exactly flat and its heap halves come out level
(2.46MB, then 2.81MB), so the curve check is the only thing that catches it.

## Typing flows

Chromium retains about **one DOM node per text-editing gesture**. That is its
own bookkeeping. A plain `<input>` built with `document.createElement` and bound
to nothing shows the same slope, with no framework involved. Over 200 iterations
it swamps any fixed node budget, which is why typing soak tests get written off
as flaky.

So measure it against exactly such a control input, and budget for it:

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
nodes sit inside the baseline instead of showing up as growth.

## API

| export                                                    | purpose                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `attachCDP(page)`                                         | Open a CDP session with `Performance` enabled.                            |
| `getPageMetrics(client)`                                  | Collect garbage twice, then read `{ heap, nodes, listeners, documents }`. |
| `soak({ client, flow, iterations, warmup, sampleEvery })` | Warm up, baseline, loop, sample, final reading.                           |
| `checkLeaks(result, thresholds?)`                         | Pure. Returns the findings, throws nothing.                               |
| `expectNoLeak(result, thresholds?)`                       | Throws a plain `Error` if `checkLeaks` finds anything.                    |
| `heapHalves(result)`                                      | First-half vs. second-half heap growth, or `undefined` if unsplittable.   |
| `metricHalves(result, metric)`                            | The same split, for any one of the four metrics.                          |
| `metricStretches(result, metric)`                         | Growth of one metric between each pair of consecutive readings.           |
| `calibrateTypingCost(page, client, gesture, rounds?)`     | Nodes the browser charges per editing gesture.                            |
| `formatSoak(name, result, extra?)`                        | Fixed-width block for the test log.                                       |

### Thresholds

| option       | default | meaning                                                                                                                            |
| ------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `nodes`      | `100`   | DOM nodes allowed above baseline. A fixed allowance behaves better than a percentage on small trees.                               |
| `listeners`  | `0`     | Listeners get registered deliberately, so an unmatched one is a bug rather than noise. Growth still has to be spread out to count. |
| `documents`  | `0`     | Detached documents allowed above baseline.                                                                                         |
| `typingCost` | `0`     | From `calibrateTypingCost`. Added to the node allowance with 10% slack.                                                            |
| `heapRatio`  | `0.5`   | Fraction of first-half growth the second half may reach. Across five frameworks the worst healthy ratio was 0.23.                  |
| `heapNoise`  | `256KB` | Absolute slack, so an already-flat flow is not judged on the ratio between two noise readings.                                     |

## Example app

[examples/tanstack-spa](./examples/tanstack-spa) is a small TanStack Router SPA
carrying one route per kind of leak, each written correctly. Adding `?leak=true`
drops exactly one cleanup, so every kind gets a matched pair of tests with the
same flow and the same thresholds:

| route        | the bug when `?leak=true`                                  | what moves           |
| ------------ | ---------------------------------------------------------- | -------------------- |
| `/`          | a store subscriber that outlives the drawer it closes over | `nodes`, `heap`      |
| `/listeners` | `addEventListener` on `window` with no matching removal    | `listeners`          |
| `/embeds`    | an iframe attached to `document.body` and never removed    | `documents`, `nodes` |
| `/activity`  | an in-memory log nobody bounds                             | `heap` only          |

The leaky half of the drawer pair, abridged:

```text
[soak] drawer (expected to fail) — 80 iterations
    base     heap   2.83MB  nodes    675  listeners   163  docs 1
    @   40  heap   3.50MB  nodes   5675  listeners   163  docs 1
    @   80  heap   4.18MB  nodes  10675  listeners   163  docs 1
    delta  heap +1.36MB  nodes +10000  listeners +0  docs +0
    per-iteration  heap 17.35KB  nodes 125.00  listeners 0.000
    heap halves  1st 0.68MB  2nd 0.68MB  (split @40; a settling curve has 2nd well under 1st)
    nodes     ++++++++  +10000 total, biggest stretch 13% of it (spread out, so accumulating)
```

The `/activity` pair is the one worth reading, though: both versions leave every
counter at exactly the same value, so only the heap tells them apart.

```sh
pnpm install
pnpm run test:example
```

## Agent skills

The package ships three [TanStack Intent](https://tanstack.com/intent) skills
in [skills/](./skills), so a coding agent reads how to use this rather than
inferring it from the type signatures:

| skill                  | covers                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `writing-soak-tests`   | wiring `attachCDP` and `soak` into a spec, sizing the loop, the Playwright config it needs |
| `interpreting-results` | whether a red run is a real leak, and which threshold is load-bearing                      |
| `typing-flows`         | calibrating and budgeting the nodes Chromium charges per editing gesture                   |

If you use an agent, run `npx @tanstack/intent@latest install` once in your own
project. It writes guidance into your agent's config telling it to discover and
load skills from installed packages, so these arrive and update with the
version of playwright-soak you have installed rather than with the model.

## Notes

Garbage is collected **twice** before every reading. One pass intermittently
leaves detached subtrees in the node count, roughly one reading in six.

`formatSoak` prints a line per counter that moved, so a failure explains itself
rather than leaving you to re-derive the shape from the rows above. The
characters are one per stretch: `+` grew, `-` shrank, `·` held.

`expectNoLeak` throws a plain `Error` rather than calling an assertion library.
That keeps `@playwright/test` a type-only import: the built output contains no
reference to it, so consuming the package through a link cannot load a second
copy of Playwright, which Playwright rejects outright.

Warmup rounds run before the measured loop, so the page is not in its initial
state at iteration 0. A flow that advances a counter has to track that itself
rather than deriving it from the loop index. When a flow throws, `soak` reports
which round it was and reminds you warmup ran.

The heap check only bites once first-half growth exceeds twice `heapNoise`,
which on a typical app means around 200 iterations. Shorter runs are effectively
counter-only.

Prefer flows that return to their starting state, so session history stays
bounded. A flow that only pushes history entries grows browser-side bookkeeping
that is not your leak.

## Relationship to memlab

[memlab](https://github.com/facebook/memlab) answers a different question, and
the two work well together. memlab diffs V8 heap snapshots across one
action/back cycle and tells you _which object_ leaked and _what retains it_, far
better diagnostics than counters. It is Puppeteer-only
([facebook/memlab#138](https://github.com/facebook/memlab/issues/138)) and
heavier to run.

This package is cheap enough to run on every PR inside a Playwright suite you
already have, and watching the curve over hundreds of rounds lets it separate
slow accumulation from one-off caching. When it goes red, reach for memlab to
find out what is holding the memory.

## Development

```sh
pnpm install
pnpm run build             # tsup, ESM + CJS + d.ts
pnpm run test              # the package's own fixtures
pnpm run test:example      # builds the package, then the example app suite
pnpm run typecheck
pnpm run typecheck:example # builds first: the example imports the built types
pnpm run lint
pnpm run format
```

The two `:example` scripts build the package before running, because the example
imports `playwright-soak` by name and resolves it through the workspace link to
`dist/`. Running the underlying `pnpm --filter example-tanstack ...` directly
works on your machine only for as long as a stale `dist/` happens to be lying
around.

Commits follow [Conventional Commits](https://www.conventionalcommits.org).
semantic-release cuts the version and publishes from `master` through GitHub
Actions using npm trusted publishing, so releases carry a provenance attestation
and no npm token lives in the repo.

## Credit

The warmup/baseline/loop structure, the double collection and the fixed
100-node allowance come from Den Odell's
[Your SPA is leaking memory — soak test it](https://denodell.com/blog/your-spa-is-leaking-memory-soak-test-it).

## License

MIT
