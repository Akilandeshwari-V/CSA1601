import { useEffect, useRef, useState } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const easeOut = (t) => 1 - (1 - t) ** 3;

/** Number that eases from its previous value to the new one. Shows the final value at once if the user prefers reduced motion. */
export default function CountUp({ value, format = (v) => String(Math.round(v)), duration = 850 }) {
  const [shown, setShown] = useState(reduced() ? value : 0);
  const from = useRef(reduced() ? value : 0);
  useEffect(() => {
    if (reduced() || !Number.isFinite(value)) { setShown(value); from.current = value; return undefined; }
    const start = performance.now(), a = from.current, b = value;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const v = a + (b - a) * easeOut(t);
      setShown(v); from.current = v;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format(shown)}</>;
}
