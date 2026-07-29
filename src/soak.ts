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
   * Take an intermediate reading every N iterations. Default is a quarter of
   * the run, which is the minimum that lets {@link heapHalves} split it.
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
  sampleEvery = Math.max(1, Math.floor(iterations / 4)),
}: SoakOptions): Promise<SoakResult> {
  for (let i = 0; i < warmup; i++) {
    await flow(i);
  }

  const baseline = await getPageMetrics(client);
  const samples: SoakSample[] = [];

  for (let i = 0; i < iterations; i++) {
    await flow(i);
    if ((i + 1) % sampleEvery === 0 && i + 1 < iterations) {
      samples.push({ iteration: i + 1, metrics: await getPageMetrics(client) });
    }
  }

  const after = await getPageMetrics(client);
  samples.push({ iteration: iterations, metrics: after });

  return { baseline, after, samples, iterations, warmup };
}

/**
 * Heap growth over the second half of the loop, against the first half.
 *
 * The node, listener and document counters miss retention that is none of
 * those things — a stale subscriber callback closing over a component tree,
 * an unbounded cache of plain objects. That only moves the heap. But absolute
 * heap delta is too noisy to bound directly, so compare the *shape* instead:
 * a real per-iteration leak holds a roughly constant slope and grows its
 * second half as much as its first, while warm-up allocation and caching decay
 * towards flat.
 *
 * Returns `undefined` when there are too few samples to split.
 */
export function heapHalves(r: SoakResult):
  | {
      /** Heap growth from baseline to the midpoint sample. */
      first: number;
      /** Heap growth from the midpoint sample to the final reading. */
      second: number;
      midIteration: number;
    }
  | undefined {
  const half = r.iterations / 2;
  const mid = r.samples.reduce((best, s) =>
    Math.abs(s.iteration - half) < Math.abs(best.iteration - half) ? s : best,
  );
  if (mid === r.samples[r.samples.length - 1]) return undefined;

  return {
    first: mid.metrics.heap - r.baseline.heap,
    second: r.after.heap - mid.metrics.heap,
    midIteration: mid.iteration,
  };
}
