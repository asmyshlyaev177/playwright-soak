import { expect } from '@playwright/test';

import { heapHalves, type SoakResult } from './soak.js';

export type LeakThresholds = {
  /**
   * DOM nodes allowed to remain above baseline. A fixed allowance behaves
   * better than a percentage on small DOM trees. Default 100.
   */
  nodes?: number;
  /**
   * Event listeners allowed to remain above baseline. Default 0 — listeners
   * are registered deliberately, so an unmatched one is a bug, not noise.
   */
  listeners?: number;
  /** Documents allowed to remain above baseline. Default 0. */
  documents?: number;
  /**
   * Nodes per iteration the browser charges for text editing, from
   * {@link calibrateTypingCost}. Added to the node allowance, with 10% slack.
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
   */
  heapNoise?: number;
};

/**
 * Assert that a soak run did not accumulate DOM nodes, listeners, documents,
 * or heap.
 *
 * The heap check tests the shape of the curve rather than the absolute delta —
 * see {@link heapHalves} for why. It is skipped when the run has too few
 * samples to split.
 */
export function expectNoLeak(
  result: SoakResult,
  thresholds: LeakThresholds = {},
): void {
  const {
    nodes = 100,
    listeners = 0,
    documents = 0,
    typingCost = 0,
    heapRatio = 0.5,
    heapNoise = 256 * 1024,
  } = thresholds;

  const nodeBudget = nodes + Math.ceil(typingCost * result.iterations * 1.1);

  expect(
    result.after.listeners,
    'event listeners accumulated across iterations',
  ).toBeLessThanOrEqual(result.baseline.listeners + listeners);

  expect(result.after.nodes, 'DOM nodes accumulated across iterations').toBeLessThan(
    result.baseline.nodes + nodeBudget,
  );

  expect(
    result.after.documents,
    'documents accumulated across iterations',
  ).toBeLessThanOrEqual(result.baseline.documents + documents);

  const halves = heapHalves(result);
  if (halves) {
    expect(
      halves.second,
      `heap grew as fast in the second half as the first (${fmt(halves.first)} then ${fmt(halves.second)}), which is a linear climb rather than a settling one`,
    ).toBeLessThanOrEqual(Math.max(halves.first * heapRatio, heapNoise));
  }
}

const fmt = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)}MB`;
