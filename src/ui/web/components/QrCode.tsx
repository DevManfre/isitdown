import { useEffect, useState } from "react";

/**
 * A QR code drawn as SVG — roadmap 4.26.
 *
 * Always `--qr-ink` on `--qr-ground` (black on white) with a four-module quiet zone, whatever the theme: a
 * phone's camera reads contrast, not taste, and an inverted code on the OLED
 * theme is the one that fails to scan. The generator is loaded on first use,
 * so the dashboard everyone opens does not carry a QR encoder for the screen
 * few of them have.
 *
 * Nothing is drawn until the encoder has arrived, and nothing if it cannot
 * encode the text (too long for the largest symbol): a missing code is the
 * honest answer, a half-code that does not scan is not.
 */
const QUIET = 4;

export function QrCode({ text, label, className }: { text: string; label: string; className?: string }) {
  const [modules, setModules] = useState<boolean[][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("qrcode-generator")
      .then(({ default: qrcode }) => {
        // Type 0 lets the encoder pick the smallest symbol that holds the text;
        // "M" survives a scuffed screen without growing the code much.
        const code = qrcode(0, "M");
        code.addData(text);
        code.make();
        const count = code.getModuleCount();
        const rows = Array.from({ length: count }, (_row, y) => Array.from({ length: count }, (_cell, x) => code.isDark(y, x)));
        if (!cancelled) setModules(rows);
      })
      .catch(() => {
        if (!cancelled) setModules(null);
      });
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (modules === null) return null;
  const size = modules.length + QUIET * 2;
  const path = modules
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x + QUIET} ${y + QUIET}h1v1h-1z` : "")))
    .join("");

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={className}
      data-slot="qr-code"
    >
      <rect width={size} height={size} fill="var(--qr-ground)" />
      <path d={path} fill="var(--qr-ink)" />
    </svg>
  );
}
