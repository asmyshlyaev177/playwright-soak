import type { CDPSession } from '@playwright/test';

import { getPageMetrics, type Metrics } from './metrics.js';

export type SoakSample = { iteration: number; metrics: Metrics };

export type SoakResult = {
  /** Reading taken after warmup, before the measured loop. */
  baseline: Metrics;
  /** Reading taken after the last iteration. */
  after: Metrics;
  /** Readings taken during the loop, ending with `after`. */
  samples: SoakSample[];
  iterations: number;
  warmup: number;
};

export type SoakOptions = {
  client: CDPSession;
  /** The user flow to repeat. Receives the zero-based iteration index. */
  flow: (iteration: number) => Promise<void>;
  /** Measured iterations. Default 200. */
  iterations?: number;
  /**
   * Flow runs before the baseline reading. Lazy module loading, first-render
   * caches and connection setup all allocate once; letting them happen before
   * the baseline keeps them out of the measurement. Default 5.
   */
  warmup?: number;
  /**
   * Take an intermediate reading every N iterations. Default is an eighth of
   * the run.
   *
   * Readings are cheap next to the two forced collections each one already
   * costs, and resolution is what the counter checks run on: the more stretches
   * between readings there are, the more clearly a leak spread across all of
   * them separates from a step concentrated in one.
   */
  sampleEvery?: number;
};

/**
 * Warm up, take a baseline, run `flow` `iterations` times taking periodic
 * readings, then take a final reading.
 *
 * Nothing is asserted here — pass the result to {@link expectNoLeak} or read
 * the samples yourself. Keeping measurement and judgement separate matters
 * because sensible thresholds are app-specific.
 */
export async function soak({
  client,
  flow,
  iterations = 200,
  warmup = 5,
  sampleEvery = Math.max(1, Math.floor(iterations / 8)),
}: SoakOptions): Promise<SoakResult> {
  for (let i = 0; i < warmup; i++) {
    await runFlow(flow, i, 'warmup', warmup);
  }

  const baseline = await getPageMetrics(client);
  const samples: SoakSample[] = [];

  for (let i = 0; i < iterations; i++) {
    await runFlow(flow, i, 'iteration', iterations);
    if ((i + 1) % sampleEvery === 0 && i + 1 < iterations) {
      samples.push({ iteration: i + 1, metrics: await getPageMetrics(client) });
    }
  }

  const after = await getPageMetrics(client);
  samples.push({ iteration: iterations, metrics: after });

  return { baseline, after, samples, iterations, warmup };
}

/**
 * Run one round, and if it throws say *where*.
 *
 * A flow that fails on round 3 of 200 otherwise surfaces as a bare locator
 * timeout with no hint that it came from inside a loop — and, worse, no hint
 * that warmup rounds ran before the loop started, which is the usual cause
 * when a flow assumes it is the first thing to touch the page.
 */
async function runFlow(
  flow: (i: number) => Promise<void>,
  index: number,
  phase: 'warmup' | 'iteration',
  total: number,
): Promise<void> {
  try {
    await flow(index);
  } catch (cause) {
    throw new Error(
      `playwright-soak: flow threw on ${phase} ${index + 1} of ${total}` +
        (phase === 'iteration'
          ? ' (warmup rounds ran before this, so page state is not fresh)'
          : ''),
      { cause },
    );
  }
}

/** Growth of one metric between two consecutive readings. */
export type Stretch = {
  /** Iteration the previous reading was taken at. 0 means the baseline. */
  from: number;
  /** Iteration this reading was taken at. */
  to: number;
  delta: number;
};

/**
 * Growth of one metric between each pair of consecutive readings.
 *
 * This is the series the counter checks judge. A leak repeats, so its growth is
 * spread across the whole series. A cache warming up, a global registered
 * lazily on first interaction, or one of the transient listeners Chromium
 * registers and drops a moment later all pile their growth into a single
 * stretch and leave the rest flat.
 */
export function metricStretches(
  r: SoakResult,
  metric: keyof Metrics,
): Stretch[] {
  const readings = [{ iteration: 0, metrics: r.baseline }, ...r.samples];

  return readings.slice(1).map((reading, i) => ({
    from: readings[i].iteration,
    to: reading.iteration,
    delta: reading.metrics[metric] - readings[i].metrics[metric],
  }));
}

export type Halves = {
  /** Growth from baseline to the midpoint sample. */
  first: number;
  /** Growth from the midpoint sample to the final reading. */
  second: number;
  midIteration: number;
};

/**
 * Split one metric's growth at the midpoint of the run.
 *
 * This is how a leak is told apart from a one-off. A per-iteration leak keeps a
 * roughly constant slope, so it grows its second half about as much as its
 * first. Warm-up allocation, lazily registered globals and browser noise all
 * land on one side of the split and leave the other flat.
 *
 * Returns `undefined` when there are too few samples to split.
 */
export function metricHalves(
  r: SoakResult,
  metric: keyof Metrics,
): Halves | undefined {
  const half = r.iterations / 2;
  const mid = r.samples.reduce((best, s) =>
    Math.abs(s.iteration - half) < Math.abs(best.iteration - half) ? s : best,
  );
  if (mid === r.samples[r.samples.length - 1]) return undefined;

  return {
    first: mid.metrics[metric] - r.baseline[metric],
    second: r.after[metric] - mid.metrics[metric],
    midIteration: mid.iteration,
  };
}

/**
 * Heap growth over the second half of the loop, against the first half.
 *
 * The node, listener and document counters miss retention that is none of
 * those things: a stale subscriber callback closing over a component tree, an
 * unbounded cache of plain objects. That only moves the heap, and absolute heap
 * delta is too noisy to bound directly, so {@link checkLeaks} judges the shape
 * of this split instead of the size of the delta.
 *
 * Returns `undefined` when there are too few samples to split.
 */
export function heapHalves(r: SoakResult): Halves | undefined {
  return metricHalves(r, 'heap');
}
