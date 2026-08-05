# example-tanstack

A small TanStack Router SPA that exists so `playwright-soak` has something real
to measure. Every route is written correctly; adding `?leak=true` to the URL
drops exactly one cleanup and turns that route into a textbook leak.

So each kind of leak gets a matched pair in
[e2e/soak.spec.ts](e2e/soak.spec.ts) — same flow, same thresholds, opposite
verdicts:

| route        | the bug when `?leak=true`                                  | what moves           |
| ------------ | ---------------------------------------------------------- | -------------------- |
| `/`          | a store subscriber that outlives the drawer it closes over | `nodes`, `heap`      |
| `/listeners` | `addEventListener` on `window` with no matching removal    | `listeners`          |
| `/embeds`    | an iframe attached to `document.body` and never removed    | `documents`, `nodes` |
| `/activity`  | an in-memory log nobody bounds                             | `heap` only          |

`/reports` and `/settings` are along for the ride: one gives route navigation
something to switch between, the other gives typing calibration an input.

The `/activity` pair is the one worth reading. Both versions leave every counter
at exactly the same value, so nodes, listeners and documents cannot tell them
apart. Only the shape of the heap separates them:

```text
bounded    1st 1.51MB  2nd 0.09MB   ← fills, then holds
unbounded  1st 3.71MB  2nd 3.60MB   ← climbs at a constant rate
```

## Running it

```sh
pnpm install
pnpm run test:example   # from the repo root; builds the package first
```

`pnpm run example:dev` serves the app on
[localhost:4174](http://localhost:4174) if you want to click around. The soak
tests build it and serve the production output instead, because the dev server's
HMR client allocates on its own schedule and muddies the heap curve.
