import { useEffect, useState } from 'react';

import { useLeakMode } from '../leak-mode';

/**
 * Leaks event listeners: a window listener registered on mount without a
 * matching removal. Nothing else moves, so the listener counter is the only
 * signal.
 */
export function Listeners() {
  const leak = useLeakMode();
  const [open, setOpen] = useState(false);

  return (
    <section>
      <h1>Listeners</h1>
      <p className="lede">
        Page for testing event listener leaks. The monitor listens for window
        resizes while it is open. With <code>?leak=true</code> it never removes
        that listener, so one is left behind every time you close it. Nothing
        else moves, which makes the listener count the only signal.
      </p>
      <button onClick={() => setOpen((o) => !o)}>
        {open ? 'Close monitor' : 'Open monitor'}
      </button>
      {open ? <Monitor leak={leak} /> : null}
    </section>
  );
}

function Monitor({ leak }: { leak: boolean }) {
  const [width, setWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return leak
      ? undefined
      : () => window.removeEventListener('resize', onResize);
  }, [leak]);

  return (
    <p className="panel" data-testid="monitor">
      viewport {width}px
    </p>
  );
}
