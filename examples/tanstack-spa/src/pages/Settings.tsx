import { useState } from 'react';

export function Settings() {
  const [name, setName] = useState('');

  return (
    <section>
      <h1>Settings</h1>
      <p className="lede">
        A text input, and nothing wrong with it either. Chromium retains about
        one DOM node per editing gesture whatever you do, so the typing soak
        test measures that cost against a control input first and budgets for
        it.
      </p>
      <label>
        Display name
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <p data-testid="greeting">Hello, {name || 'stranger'}</p>
    </section>
  );
}
