import { useTranslation } from "react-i18next";

/**
 * The fleet's 90-day average as one arc.
 *
 * Hand-drawn SVG rather than a Recharts `RadialBarChart` like `UptimeRing` and
 * `FleetSummary` use: those two draw a ring per provider and a ring per fleet
 * respectively, where a chart library's axis, tooltip and animation plumbing
 * earns its place. This is a single static arc in the hero, drawn once per
 * render, and a whole polar chart for one number is weight the bundle budget
 * pays for on every view.
 *
 * Colour comes from the tokens, never from a literal: the arc is the accent
 * (this is the product's own figure, not a severity verdict) over the neutral
 * track every other unsampled reading uses.
 */
export function UptimeArc({
  value,
  size = 112,
  color = "var(--color-accent)",
  label,
}: {
  value: number;
  size?: number;
  /** What the arc says to a screen reader. Defaults to the fleet sentence. */
  label?: string;
  /** The arc's own colour. Defaults to the accent — the fleet's aggregate is
   *  the product's figure; a per-provider arc passes its severity instead. */
  color?: string;
}) {
  const { t, i18n } = useTranslation();

  const stroke = Math.max(4, Math.round(size * 0.055));
  const radius = size / 2 - stroke;
  const circumference = 2 * Math.PI * radius;
  // A measured but tiny average still draws a visible sliver, the floor
  // `UptimeRing` uses for the same reason; 0 is "never measured" and draws
  // nothing but the track.
  const drawn = value > 0 ? Math.max(2, Math.min(100, value)) : 0;
  const formatted = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(value);

  return (
    <svg
      data-slot="uptime-arc"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label ?? t("overview.stat.arc", { uptime: formatted })}
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--status-unknown-fill)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${((drawn / 100) * circumference).toFixed(2)} ${circumference.toFixed(2)}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="anim-ring"
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="fill-foreground font-mono"
        fontSize={Math.round(size * 0.16)}
      >
        {formatted}%
      </text>
    </svg>
  );
}
