import { useState } from 'react';

import { useLeakMode } from '../leak-mode';

type Entry = { at: number; payload: string[] };

/** Module-level, so it outlives every component that writes to it. */
const log: Entry[] = [];
const KEEP = 20;

/**
 * Leaks heap and nothing else: an in-memory log that nobody bounds. No DOM
 * churn, no listeners, no documents, so the counters stay flat and only the
 * heap curve gives it away.
 */
export function Activity() {
  const leak = useLeakMode();
  const [recorded, setRecorded] = useState(0);

  const record = () => {
    log.push({
      at: Date.now(),
      payload: new Array(4000).fill('x').map((c, i) => c + i),
    });
    if (!leak && log.length > KEEP) log.shift();
    setRecorded((n) => n + 1);
  };

  return (
    <section>
      <h1>Activity</h1>
      <p className="lede">
        Page for testing heap leaks. Every recorded event appends to an
        in-memory log, which normally keeps only the last {KEEP} entries. With{' '}
        <code>?leak=true</code> nothing bounds it. No DOM node, listener or
        document moves either way, so the heap is the only thing that can tell
        the two apart.
      </p>
      <button onClick={record}>Record event</button>
      <p>
        recorded <output data-testid="recorded">{recorded}</output>, kept{' '}
        <output data-testid="kept">{log.length}</output>
      </p>
    </section>
  );
}
