import { useEffect, useRef } from "react";

/**
 * The motion band behind a Settings tile: a short loop that shows what the
 * section it sits on actually does — the engine sweeping its providers, the
 * beam leaving for each delivery channel, retention pruning its oldest day.
 *
 * Drawn on a canvas rather than shipped as a video file, deliberately:
 *
 * - a `.webm` per section would put megabytes through `check:bundle`'s gzip
 *   budget, and the budget exists because this dashboard is served from a
 *   container on someone's LAN;
 * - a video bakes one theme into its pixels, and this page has three theme
 *   states. The painters read `--primary` and the `--status-*` tokens at draw
 *   time, so a theme switch repaints rather than looking wrong;
 * - `test:visual` compares 24 frames byte for byte, and a decoding `<video>`
 *   never lands on the same frame twice. Under `prefers-reduced-motion` — which
 *   `tools/visual/chrome.mjs` forces — a reel paints frame 0 once and stops, so
 *   the baselines stay stable and an operator who asked for less motion gets a
 *   still band rather than a loop.
 *
 * The band is decoration: it carries no information the section's own rows do
 * not, and is `aria-hidden` for that reason.
 */

/** The tokens a painter may use, resolved once per frame. */
export interface ReelInk {
  accent: string;
  ok: string;
  warn: string;
  danger: string;
}

export type ReelPainter = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  /** Seconds since the reel started; never negative, and 0 under reduced motion. */
  time: number,
  ink: ReelInk,
) => void;

/** `rgb(…)`/`oklch(…)` from a token, at the alpha a painter asks for. */
export function fade(color: string, alpha: number): string {
  // Clamped, because a percentage outside 0–100 is not a colour: canvas ignores
  // it in `fillStyle` but *throws* in `addColorStop`, and a throw inside the
  // frame callback stops the reel for good.
  const percent = Math.min(100, Math.max(0, Math.round(alpha * 100)));
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

const readInk = (element: HTMLElement): ReelInk => {
  const style = getComputedStyle(element);
  // Token names are written out rather than built, for the same reason
  // chartConfig.ts writes its own out: a name assembled at runtime cannot be
  // checked against tokens.css by the guard test.
  return {
    accent: style.getPropertyValue("--primary").trim(),
    ok: style.getPropertyValue("--status-operational-fill").trim(),
    warn: style.getPropertyValue("--status-degraded-fill").trim(),
    danger: style.getPropertyValue("--status-major-outage-fill").trim(),
  };
};

export function SettingsReel({ painter, className }: { painter: ReelPainter; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    let width = 0;
    let height = 0;
    const resize = (): void => {
      // Capped at 2: a 3× phone would triple the fill cost of a decoration.
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();

    const paint = (time: number): void => {
      ctx.clearRect(0, 0, width, height);
      painter(ctx, width, height, time, readInk(canvas));
    };

    let frame: number | undefined;
    const observer = new ResizeObserver(() => {
      resize();
      // A resize under reduced motion has no loop to repaint it.
      if (frame === undefined) paint(0);
    });
    observer.observe(canvas);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      paint(0);
    } else {
      const start = performance.now();
      const tick = (now: number): void => {
        // The frame timestamp is the start of the frame being composited, which
        // can predate the `performance.now()` above — so the first tick or two
        // arrive slightly negative. A painter that reads that as a phase gets a
        // negative one, and a negative alpha reaching `addColorStop` throws out
        // of this callback, which never schedules the next frame: the reel is
        // dead for the life of the page. `delivery` went out that way.
        paint(Math.max(0, (now - start) / 1000));
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }

    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [painter]);

  return (
    <div
      aria-hidden="true"
      data-slot="settings-reel"
      className={className}
      // Faded into the card before it reaches the first row, so no moving pixel
      // ever sits behind text — the rows keep the card's own contrast.
      style={{
        maskImage: "linear-gradient(to bottom, black 0%, black 42%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 42%, transparent 100%)",
      }}
    >
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
