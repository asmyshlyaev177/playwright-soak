import type { CDPSession, Page } from '@playwright/test';

/** A single reading of the renderer's retained-object counters. */
export type Metrics = {
  /** `JSHeapUsedSize` — bytes of live JS heap after collection. */
  heap: number;
  /** `Nodes` — DOM nodes the renderer still holds, attached or not. */
  nodes: number;
  /** `JSEventListeners` — registered listeners across all documents. */
  listeners: number;
  /** `Documents` — live documents, including detached ones. */
  documents: number;
};

/**
 * Open a CDP session for metrics collection.
 *
 * Chromium only: the counters come from the Chrome DevTools Protocol, which
 * Firefox and WebKit do not implement. Leaks are rarely engine-specific, so a
 * Chromium-only guard still catches the overwhelming majority of them.
 */
export async function attachCDP(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  return client;
}

/**
 * Force collection, then read the counters.
 *
 * Collection runs twice on purpose: a single pass intermittently leaves
 * detached subtrees in the node count, which shows up as a flaky reading
 * roughly one time in six.
 */
export async function getPageMetrics(client: CDPSession): Promise<Metrics> {
  await client.send('HeapProfiler.collectGarbage');
  await client.send('HeapProfiler.collectGarbage');

  const { metrics } = await client.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((i) => [i.name, i.value]));

  return {
    heap: m.JSHeapUsedSize,
    nodes: m.Nodes,
    listeners: m.JSEventListeners,
    documents: m.Documents,
  };
}
