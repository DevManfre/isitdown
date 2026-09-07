import { cn } from "@/lib/utils.ts";

/**
 * The product's mark: the rounded square and pulse trace from
 * `docs/img/social-preview.html`, the same drawing the social preview and the
 * favicon use. `public/favicon.svg` repeats this geometry as a static file
 * because the browser chrome fetches an icon by URL and cannot render a
 * component — change one, change the other.
 *
 * The gradient hexes are the mark's own rather than theme tokens: a logo does
 * not restyle itself between light and dark, and it is the one place in the
 * dashboard where a colour is identity instead of semantics.
 *
 * Decorative wherever it is used so far — the rail sets it beside the product
 * name — so it is hidden from the accessibility tree rather than labelled,
 * which would have a screen reader read "IsItDown" twice.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      data-slot="brand-mark"
      className={cn("shrink-0", className)}
    >
      <defs>
        {/* The id is document-global, so it carries the component's name rather
            than a bare "mark" that a provider logo could collide with. */}
        <linearGradient id="brand-mark-gradient" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#968ae0" />
          <stop offset="0.7" stopColor="#5d5294" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#brand-mark-gradient)" />
      <g transform="translate(13.14 13.14) scale(1.5714)">
        <path
          d="M2 12h4l2.5-6 3.5 12 3-8 2 2h5"
          fill="none"
          stroke="#fff"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
