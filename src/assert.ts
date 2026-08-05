import type { Metrics } from './metrics.js';
import {
  type Halves,
  metricHalves,
  metricStretches,
  type SoakResult,
} from './soak.js';

export type LeakThresholds = {
  /**
   * DOM nodes allowed to remain above baseline. A fixed allowance behaves
   * better than a percentage on small DOM trees. Default 100.
   */
  nodes?: number;
  /**
   * Event listeners allowed to remain above baseline. Default 0 — listeners
   * are registered deliberately, so an unmatched one is a bug, not noise.
   *
   * Growth still has to appear on both sides of the run to count, so a one-off
   * registration or a browser blip does not trip this at 0.
   */
  listeners?: number;
  /** Documents allowed to remain above baseline. Default 0. */
  documents?: number;
  /**
   * Nodes per iteration the browser charges for text editing, from
   * `calibrateTypingCost`. Added to the node allowance, with 10% slack.
   * Default 0.
   */
  typingCost?: number;
  /**
   * Fraction of first-half heap growth the second half may reach before the
   * curve counts as linear rather than decaying. Default 0.5 — across five
   * frameworks the worst observed healthy ratio was 0.23.
   */
  heapRatio?: number;
  /**
   * Absolute heap slack, so a flow whose heap is already flat is not judged on
   * the ratio between two noise readings. Default 256KB.
   *
   * Note this floor also means the heap check only really bites once first-half
   * growth exceeds twice it — around 200 iterations on a typical app. Shorter
   * runs are effectively counter-only.
   */
  heapNoise?: number;
};

export type LeakFinding = {
  metric: 'nodes' | 'listeners' | 'documents' | 'heap';
  /** Growth from baseline to the final reading. Bytes for `heap`. */
  growth: number;
  /** Growth per iteration. */
  perIteration: number;
  /** Growth either side of the midpoint, when there were samples enough to split. */
  halves?: Halves;
  message: string;
};

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)}MB`;

/**
 * Is this counter's growth spread across the run, or piled into one moment?
 *
 * A leak repeats, so its growth spreads: no single stretch between readings
 * holds much of the total. Two common things are not leaks and must not read as
 * one — a global listener registered lazily on first interaction, which steps
 * once and stays, and the transient listeners Chromium registers and drops a
 * moment later — and both put all their growth in one stretch.
 *
 * So the test is concentration: no stretch may account for half the growth or
 * more. Comparing the two halves of the run does not work, because an early
 * step plus a late blip grows both halves. Counting the stretches that grow
 * does, but the bar moves with the sample rate, and a leak that fires four
 * times across nine stretches is still a leak. Concentration is scale-free:
 * sample more finely and a real leak only looks more spread out, while a step
 * stays pinned at all of it.
 *
 * The blind spot is a leak living underneath one much larger step, which stays
 * concentrated and passes. Warmup exists to take the usual such step — first
 * render, lazy imports — before the baseline is read.
 *
 * Below two stretches there is no shape to judge, so fall back to reporting.
 */
function accumulates(result: SoakResult, metric: keyof Metrics): boolean {
  const stretches = metricStretches(result, metric);
  if (stretches.length < 2) return true;

  const total = stretches.reduce((sum, s) => sum + s.delta, 0);
  const largest = Math.max(...stretches.map((s) => s.delta));
  return largest * 2 < total;
}

/** `+15 then +15 across the halves, split @30` */
const shape = (halves: Halves | undefined) =>
  halves
    ? `, +${halves.first} then +${halves.second} across the halves, split @${halves.midIteration}`
    : '';

/**
 * Check a soak result against the thresholds and return what failed.
 *
 * Pure — no assertion library, no throwing. Use this when you want to decide
 * for yourself, or feed the findings into your runner's reporter.
 */
export function checkLeaks(
  result: SoakResult,
  thresholds: LeakThresholds = {},
): LeakFinding[] {
  const {
    nodes = 100,
    listeners = 0,
    documents = 0,
    typingCost = 0,
    heapRatio = 0.5,
    heapNoise = 256 * 1024,
  } = thresholds;

  const findings: LeakFinding[] = [];
  const { baseline, after, iterations } = result;

  const counter = (
    metric: 'nodes' | 'listeners' | 'documents',
    allowance: number,
    describe: (growth: number, halves: Halves | undefined) => string,
  ) => {
    const growth = after[metric] - baseline[metric];
    if (growth <= allowance) return;
    if (!accumulates(result, metric)) return;

    const halves = metricHalves(result, metric);
    findings.push({
      metric,
      growth,
      perIteration: growth / iterations,
      halves,
      message: describe(growth, halves),
    });
  };

  const typingAllowance = Math.ceil(typingCost * iterations * 1.1);
  const nodeBudget = nodes + typingAllowance;
  counter(
    'nodes',
    // Historically a `>=` boundary, kept so a flow that lands exactly on the
    // budget is treated as spent rather than clear.
    nodeBudget - 1,
    (growth, halves) =>
      `DOM nodes accumulated: +${growth} over ${iterations} iterations (${(growth / iterations).toFixed(2)}/iteration${shape(halves)}), budget ${nodeBudget}${typingCost ? ` (${nodes} + ${typingAllowance} for typing)` : ''}`,
  );

  counter(
    'listeners',
    listeners,
    (growth, halves) =>
      `event listeners accumulated: +${growth} over ${iterations} iterations (${(growth / iterations).toFixed(2)}/iteration${shape(halves)}), allowed ${listeners}`,
  );

  counter(
    'documents',
    documents,
    (growth, halves) =>
      `documents accumulated: +${growth} over ${iterations} iterations${shape(halves)}, allowed ${documents}`,
  );

  const halves = metricHalves(result, 'heap');
  if (halves) {
    const allowed = Math.max(halves.first * heapRatio, heapNoise);
    if (halves.second > allowed) {
      const growth = after.heap - baseline.heap;
      findings.push({
        metric: 'heap',
        growth,
        perIteration: growth / iterations,
        halves,
        message: `heap grew as fast in the second half as the first (${mb(halves.first)} then ${mb(halves.second)}, split @${halves.midIteration}), which is a linear climb rather than a settling one; allowed ${mb(allowed)}`,
      });
    }
  }

  return findings;
}

/**
 * Throw if a soak run accumulated DOM nodes, listeners, documents or heap.
 *
 * Throws a plain `Error`, which every test runner reports as a failure. The
 * package deliberately does not import an assertion library at runtime: doing
 * so loads a second copy of `@playwright/test` whenever the package is
 * consumed through a link, which Playwright rejects outright.
 */
export function expectNoLeak(
  result: SoakResult,
  thresholds: LeakThresholds = {},
): void {
  const findings = checkLeaks(result, thresholds);
  if (!findings.length) return;

  throw new Error(
    `playwright-soak: leak detected over ${result.iterations} iterations\n` +
      findings.map((f) => `  - ${f.message}`).join('\n'),
  );
}
