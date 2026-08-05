import { useEffect, useState } from 'react';

import { useLeakMode } from '../leak-mode';

/**
 * Leaks documents: an iframe attached to `document.body` rather than to the
 * component's own subtree, so React unmounting the component does not take it
 * away. Third-party embeds do this routinely.
 */
export function Embeds() {
  const leak = useLeakMode();
  const [open, setOpen] = useState(false);

  return (
    <section>
      <h1>Embeds</h1>
      <p className="lede">
        Page for testing document leaks. The preview attaches a hidden iframe to
        the page body rather than to its own subtree, the way third-party embeds
        usually do. With <code>?leak=true</code> nobody takes it away again, so
        unmounting the component leaves a whole document behind.
      </p>
      <button onClick={() => setOpen((o) => !o)}>
        {open ? 'Close preview' : 'Open preview'}
      </button>
      {open ? <Preview leak={leak} /> : null}
    </section>
  );
}

function Preview({ leak }: { leak: boolean }) {
  useEffect(() => {
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.setAttribute('data-preview', '');
    document.body.appendChild(frame);
    return leak ? undefined : () => frame.remove();
  }, [leak]);

  return (
    <p className="panel" data-testid="preview">
      preview mounted
    </p>
  );
}
