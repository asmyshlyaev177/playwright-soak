type Listener = (tick: number) => void;

const listeners = new Set<Listener>();
let tick = 0;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function publish(): void {
  tick += 1;
  for (const fn of listeners) fn(tick);
}

export const subscriberCount = (): number => listeners.size;
