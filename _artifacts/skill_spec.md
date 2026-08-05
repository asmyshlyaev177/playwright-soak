# playwright-soak — Skill Spec

playwright-soak repeats a Playwright flow a few hundred times, forces garbage
collection between readings, and fails the test when DOM nodes, event
listeners, documents or the JS heap keep piling up. It reads the counters over
the Chrome DevTools Protocol, so it is Chromium-only, and it judges growth by
how it is spread across the run rather than by where it ended up.

## Domains

| Domain                           | Description                                                                                    | Skills                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------- |
| Measuring a repeated flow        | The CDP session, the loop, and the Playwright configuration a run of that length needs         | `writing-soak-tests`   |
| Judging what the readings mean   | Turning a series of readings into a verdict, and knowing which threshold is load-bearing       | `interpreting-results` |
| Budgeting the browser's own cost | Separating retention the browser charges for its own bookkeeping from retention the app causes | `typing-flows`         |

## Skill Inventory

| Skill                  | Type | Domain       | What it covers                                                                                | Failure modes |
| ---------------------- | ---- | ------------ | --------------------------------------------------------------------------------------------- | ------------- |
| `writing-soak-tests`   | core | measurement  | `attachCDP`, `soak`, `iterations`/`warmup`/`sampleEvery`, `getPageMetrics`, Playwright config | 8             |
| `interpreting-results` | core | judgement    | `expectNoLeak`, `checkLeaks`, `LeakThresholds`, `formatSoak`, `heapHalves`, `metricStretches` | 5             |
| `typing-flows`         | core | browser-cost | `calibrateTypingCost`, `TypingGesture`, `typingCost`                                          | 4             |

The library has three skills and no framework adapters, so the tree generator's
minimal-library fast path applies: a flat structure, every skill typed `core`
and standing alone, no router skill and no core overview.

## Failure Mode Inventory

### writing-soak-tests (8 failure modes)

| #   | Mistake                                              | Priority | Source                                             | Cross-skill?           |
| --- | ---------------------------------------------------- | -------- | -------------------------------------------------- | ---------------------- |
| 1   | Soak result computed but never asserted              | CRITICAL | `src/soak.ts:42-49`                                | `interpreting-results` |
| 2   | Flow derives page state from the iteration index     | HIGH     | `src/soak.ts:57-59`, `src/soak.ts:85-102`          | —                      |
| 3   | Non-Chromium projects left in the Playwright config  | HIGH     | `src/metrics.ts:15-26`                             | —                      |
| 4   | Default Playwright timeout left in place             | HIGH     | `playwright.config.ts:6-8`                         | —                      |
| 5   | Run too short for the heap check to engage           | HIGH     | `src/assert.ts:38-45`, `src/assert.ts:165-178`     | `interpreting-results` |
| 6   | Page reloaded inside the flow                        | MEDIUM   | `README.md`, `examples/.../soak.spec.ts:23-32`     | —                      |
| 7   | `sampleEvery` set so coarse the run has no shape     | MEDIUM   | `src/soak.ts:153-168`, `test/soak.spec.ts:242-257` | —                      |
| 8   | Soaking the dev server instead of a production build | MEDIUM   | `examples/.../playwright.config.ts:14-24`          | —                      |

### interpreting-results (5 failure modes)

| #   | Mistake                                              | Priority | Source                                         | Cross-skill? |
| --- | ---------------------------------------------------- | -------- | ---------------------------------------------- | ------------ |
| 1   | `checkLeaks` used as if it asserts                   | CRITICAL | `src/assert.ts:99-108`                         | —            |
| 2   | Endpoint delta asserted instead of `expectNoLeak`    | HIGH     | `src/assert.ts:61-91`, `test/soak.spec.ts:98`  | —            |
| 3   | Thresholds raised until the run goes green           | HIGH     | `src/assert.ts:61-91`, `src/assert.ts:121-138` | —            |
| 4   | `heapNoise` dropped to zero to make the check strict | HIGH     | `src/assert.ts:38-45`, `src/assert.ts:165-178` | —            |
| 5   | Heap finding read as "the heap grew too much"        | MEDIUM   | `src/assert.ts:165-178`, `src/soak.ts:143-168` | —            |

### typing-flows (4 failure modes)

| #   | Mistake                                         | Priority | Source                                        | Cross-skill? |
| --- | ----------------------------------------------- | -------- | --------------------------------------------- | ------------ |
| 1   | `calibrateTypingCost` called after the baseline | HIGH     | `src/typing.ts:20-22`, `src/typing.ts:34-54`  | —            |
| 2   | `typingCost` measured but never passed          | HIGH     | `src/typing.ts:7-27`, `src/assert.ts:140-149` | —            |
| 3   | Calibration gesture differs from the flow's     | HIGH     | `src/typing.ts:24-26`                         | —            |
| 4   | Node allowance raised instead of budgeting      | MEDIUM   | `src/assert.ts:140-141`                       | —            |

## Tensions

| Tension                                     | Skills                                        | Agent implication                                                                               |
| ------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Fast CI runs blunt the heap check           | `writing-soak-tests` ↔ `interpreting-results` | Trimming iterations for speed silently drops heap-only leak coverage while the run still passes |
| Threshold tuning versus signal preservation | `interpreting-results` ↔ `typing-flows`       | Making a red suite green absorbs exactly the growth the concentration rule called a leak        |

## Cross-References

| From                   | To                     | Reason                                                                          |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------- |
| `writing-soak-tests`   | `interpreting-results` | `iterations` and `sampleEvery` decide which checks can fire at all              |
| `interpreting-results` | `typing-flows`         | A node finding on a flow that types is usually the browser's per-gesture charge |
| `typing-flows`         | `writing-soak-tests`   | Calibration must run before the baseline, which constrains the surrounding spec |

## Subsystems & Reference Candidates

| Skill                  | Subsystems | Reference candidates |
| ---------------------- | ---------- | -------------------- |
| `writing-soak-tests`   | —          | —                    |
| `interpreting-results` | —          | —                    |
| `typing-flows`         | —          | —                    |

The public API is ten exports across five source files, so no skill has an
independent subsystem and none approaches the point where a `references/`
file would earn its place.

## Remaining Gaps

| Skill                  | Question                                                                                 | Status |
| ---------------------- | ---------------------------------------------------------------------------------------- | ------ |
| `writing-soak-tests`   | Which Playwright config settings are hard requirements versus maintainer preference?     | open   |
| `writing-soak-tests`   | What iteration count should an agent default to, given 60/80/200 all appear in the repo? | open   |
| `interpreting-results` | When is raising the nodes allowance legitimate rather than a way of hiding a leak?       | open   |
| `interpreting-results` | Which mistakes are AI-agent-specific, and what makes a generated soak test recognisable? | open   |
| `typing-flows`         | Do other gesture families (drag, scroll) carry a comparable per-gesture browser cost?    | open   |

These stayed open because the maintainer interview was skipped. Every failure
mode in the skills is therefore grounded in source, tests or the README; none
carries `maintainer interview` as its source. The repository has no published
GitHub issues or discussions to mine, and no `docs/`, FAQ or migration guide.

## Recommended Skill File Structure

- **Core skills:** `writing-soak-tests`, `interpreting-results`, `typing-flows`
- **Framework skills:** none — the package has one peer dependency
  (`@playwright/test`) and is imported the same way from any application
  framework
- **Lifecycle skills:** none — the README's getting-started material is the
  Setup section of `writing-soak-tests`, and there is no migration history
- **Composition skills:** none — see below
- **Reference files:** none

## Composition Opportunities

| Library                  | Integration points                                                          | Composition skill needed?                                                            |
| ------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `@playwright/test`       | Peer dependency, type-only import; supplies `Page`, `Locator`, `CDPSession` | No — it is the host runner, so its seam is the Setup section of `writing-soak-tests` |
| `memlab`                 | Named in the README as the follow-up once a soak run goes red               | No — it is Puppeteer-only, so there is no shared code path to document               |
| `@tanstack/react-router` | Used by the example application only                                        | No — the example is a fixture, not an integration                                    |
