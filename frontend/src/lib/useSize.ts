// Measure an element so charts get explicit width/height — more reliable than Recharts'
// ResponsiveContainer inside grid/flex layouts. Re-measures on ResizeObserver, window resize,
// next frame, and a couple of short timeouts (fonts / late layout passes / headless quirks).
import { useLayoutEffect, useRef, useState } from "react";

export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const update = () => {
      if (!alive) return;
      const r = el.getBoundingClientRect();
      const w = Math.floor(r.width);
      const h = Math.floor(r.height);
      setSize((s) => (s.width === w && s.height === h ? s : { width: w, height: h }));
    };
    update();
    const raf = requestAnimationFrame(update);
    const t1 = setTimeout(update, 120);
    const t2 = setTimeout(update, 600);
    window.addEventListener("resize", update);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, []);
  return [ref, size];
}
