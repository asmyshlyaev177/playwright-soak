import { heapHalves, type SoakResult } from './soak.js';

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)}MB`;
const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

/**
 * Render a soak result as a fixed-width block for the test log.
 *
 * The intermediate samples are the point: a single delta cannot tell a leak
 * from a cache warming up, but four readings show which one you have.
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
    ...r.samples.map((s) => row(`@${String(s.iteration).padStart(5)}`, s.metrics)),
    `    delta  heap ${d.heap >= 0 ? '+' : ''}${mb(d.heap)}  nodes ${signed(d.nodes)}  listeners ${signed(d.listeners)}  docs ${signed(d.documents)}`,
    `    per-iteration  heap ${(d.heap / r.iterations / 1024).toFixed(2)}KB  nodes ${(d.nodes / r.iterations).toFixed(2)}  listeners ${(d.listeners / r.iterations).toFixed(3)}`,
  ];

  const halves = heapHalves(r);
  if (halves) {
    lines.push(
      `    heap halves  1st ${mb(halves.first)}  2nd ${mb(halves.second)}  (split @${halves.midIteration}; a settling curve has 2nd well under 1st)`,
    );
  }
  if (extra?.typingCost) {
    lines.push(
      `    browser typing cost ${extra.typingCost.toFixed(2)} nodes/round (budgeted for)`,
    );
  }

  return lines.join('\n');
}
