import {
  heapHalves,
  metricStretches,
  type SoakResult,
  type Stretch,
} from './soak.js';

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)}MB`;
const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

const COUNTERS = [
  ['nodes', 'nodes'],
  ['listeners', 'listeners'],
  ['documents', 'docs'],
] as const;

/** `··+··+··+` — one character per stretch between readings. */
const spark = (stretches: Stretch[]) =>
  stretches.map((s) => (s.delta > 0 ? '+' : s.delta < 0 ? '-' : '·')).join('');

/**
 * How each counter moved between readings, and how concentrated that movement
 * was.
 *
 * The share is what decides the verdict: growth piled into one stretch is a
 * step, growth spread thin across all of them is a leak. Printing it means a
 * failing run explains itself without anyone re-deriving the shape from the
 * rows above.
 */
function stretchLines(r: SoakResult): string[] {
  return COUNTERS.flatMap(([metric, label]) => {
    const stretches = metricStretches(r, metric);
    if (stretches.length < 2) return [];

    const total = stretches.reduce((sum, s) => sum + s.delta, 0);
    if (total <= 0) return [];

    const largest = Math.max(...stretches.map((s) => s.delta));
    const share = Math.round((largest / total) * 100);

    return [
      `    ${label.padEnd(9)} ${spark(stretches)}  ${signed(total)} total, biggest stretch ${share}% of it ` +
        `(${share < 50 ? 'spread out, so accumulating' : 'concentrated, so a step'})`,
    ];
  });
}

/**
 * Render a soak result as a fixed-width block for the test log.
 *
 * The intermediate samples are the point: a single delta cannot tell a leak
 * from a cache warming up, but a series of readings shows which one you have.
 */
export function formatSoak(
  name: string,
  r: SoakResult,
  extra?: { typingCost?: number },
): string {
  const d = {
    heap: r.after.heap - r.baseline.heap,
    nodes: r.after.nodes - r.baseline.nodes,
    listeners: r.after.listeners - r.baseline.listeners,
    documents: r.after.documents - r.baseline.documents,
  };

  const row = (label: string, m: SoakResult['baseline']) =>
    `    ${label}  heap ${mb(m.heap).padStart(8)}  nodes ${String(m.nodes).padStart(6)}  listeners ${String(m.listeners).padStart(5)}  docs ${m.documents}`;

  const lines = [
    `\n[soak] ${name} — ${r.iterations} iterations`,
    row('base   ', r.baseline),
    ...r.samples.map((s) =>
      row(`@${String(s.iteration).padStart(5)}`, s.metrics),
    ),
    `    delta  heap ${d.heap >= 0 ? '+' : ''}${mb(d.heap)}  nodes ${signed(d.nodes)}  listeners ${signed(d.listeners)}  docs ${signed(d.documents)}`,
    `    per-iteration  heap ${(d.heap / r.iterations / 1024).toFixed(2)}KB  nodes ${(d.nodes / r.iterations).toFixed(2)}  listeners ${(d.listeners / r.iterations).toFixed(3)}`,
  ];

  const halves = heapHalves(r);
  if (halves) {
    lines.push(
      `    heap halves  1st ${mb(halves.first)}  2nd ${mb(halves.second)}  (split @${halves.midIteration}; a settling curve has 2nd well under 1st)`,
    );
  }
  lines.push(...stretchLines(r));
  if (extra?.typingCost) {
    lines.push(
      `    browser typing cost ${extra.typingCost.toFixed(2)} nodes/round (budgeted for)`,
    );
  }

  return lines.join('\n');
}
