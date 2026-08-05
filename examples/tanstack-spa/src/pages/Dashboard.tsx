import { useEffect, useMemo, useRef, useState } from 'react';

import { useLeakMode } from '../leak-mode';
import { publish, subscribe, subscriberCount } from '../store';

export function Dashboard() {
  const leak = useLeakMode();
  const [open, setOpen] = useState(false);
  const [subscribers, setSubscribers] = useState(0);

  // Parent effects run after the child's, so by now the drawer has either
  // registered or cleaned up. In leaky mode this number only ever climbs.
  useEffect(() => setSubscribers(subscriberCount()), [open]);

  return (
    <section>
      <h1>Dashboard</h1>
      <p className="lede">
        Page for testing detached DOM leaks. The drawer mounts a panel and
        unmounts it again. With <code>?leak=true</code> the panel&rsquo;s store
        subscriber outlives it and keeps the whole subtree in memory, so the
        node count climbs.
      </p>
      <button
        onClick={() => {
          setOpen((o) => !o);
          publish();
        }}
      >
        {open ? 'Close details' : 'Open details'}
      </button>
      <p>
        live subscribers:{' '}
        <output data-testid="subscribers">{subscribers}</output>
      </p>
      {open ? <Details leak={leak} /> : null}
    </section>
  );
}

function Details({ leak }: { leak: boolean }) {
  const [tick, setTick] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => Array.from({ length: 60 }, (_, i) => `metric ${i}`),
    [],
  );

  useEffect(() => {
    const element = panel.current;
    const unsubscribe = subscribe((n) => {
      setTick(n);
      element?.setAttribute('data-tick', String(n));
    });

    // Returning the cleanup is the whole difference. Skip it and every closed
    // drawer keeps its subscriber, and through it the rows and the detached
    // DOM the subscriber closes over.
    return leak ? undefined : unsubscribe;
  }, [leak]);

  return (
    <div className="panel" ref={panel} data-testid="details">
      <p>updates seen: {tick}</p>
      <ul className="rows">
        {rows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </div>
  );
}
