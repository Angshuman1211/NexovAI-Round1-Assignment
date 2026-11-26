import { useEffect, useRef, type MutableRefObject } from "react";

/** Live audio bars. Reads the level from a ref inside its own rAF loop so it
 *  animates at 60fps without re-rendering anything above it. */
export function Waveform({
  levelRef, active, bars = 28, className = "",
}: {
  levelRef: MutableRefObject<number>;
  active: boolean;
  bars?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heights = useRef<number[]>(Array(bars).fill(0.08));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr; canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const level = active ? levelRef.current : 0;
      // Shift the history left and push the newest sample on the right, so
      // the bars read as a travelling waveform rather than a static meter.
      const hist = heights.current;
      for (let i = 0; i < hist.length - 1; i++) hist[i] = hist[i + 1];
      const jitter = 0.55 + Math.random() * 0.45;
      hist[hist.length - 1] = Math.max(0.08, level * jitter);

      const gap = 3;
      const barW = Math.max(2, (w - gap * (bars - 1)) / bars);
      for (let i = 0; i < bars; i++) {
        // Taper the ends so the shape sits inside the pill rather than
        // slamming against its edges.
        const edge = Math.sin((i / (bars - 1)) * Math.PI);
        const amp = hist[i] * (0.35 + 0.65 * edge);
        const barH = Math.max(3, amp * h * 0.9);
        const x = i * (barW + gap);
        const y = (h - barH) / 2;
        ctx.fillStyle = active ? "rgba(236,241,240,0.92)" : "rgba(236,241,240,0.22)";
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, barW / 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active, bars, levelRef]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
