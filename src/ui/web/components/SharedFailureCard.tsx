import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { statusColor, statusFill } from "@/lib/chartConfig.ts";
import type { SharedFailure } from "@/lib/sharedFailure.ts";
import { ROUTE_PATHS } from "../../routePaths.ts";

const SIZE = { width: 520, height: 280 };
const CENTER = { x: SIZE.width / 2, y: SIZE.height / 2 };
const RADIUS = { x: 200, y: 105 };

/**
 * Who is down because of whom — roadmap 2.9, drawn while it is true.
 *
 * Hub and spokes: the declared upstream in the middle, the providers that name
 * it around it. Only direct dependencies, because only those are declared; and
 * nothing here is inferred, which the hint says in so many words. The caller
 * decides whether there is a shared failure at all, so a quiet fleet draws
 * nothing.
 */
export function SharedFailureCard({
  failure,
  nameOf,
}: {
  failure: SharedFailure;
  nameOf: (id: string) => string;
}) {
  const { t } = useTranslation();
  const cause = nameOf(failure.cause);
  const n = failure.dependents.length;

  return (
    <section
      aria-label={t("shared-failure.kicker")}
      className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-widest text-primary">
          {t("shared-failure.kicker")}
        </span>
        <span className="rounded-full bg-muted px-2.5 py-0.5 font-mono text-xs text-muted-foreground">
          {t("shared-failure.count", { count: n })}
        </span>
      </div>
      <h2 className="text-xl font-semibold">{t("shared-failure.title", { cause })}</h2>
      <p className="text-sm text-muted-foreground">{t("shared-failure.hint", { cause })}</p>
      <div className="flex flex-wrap items-center gap-6">
        <svg
          viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
          role="img"
          aria-label={t("shared-failure.graph", { cause })}
          className="h-auto min-w-0 flex-1 basis-80"
        >
          {failure.dependents.map((provider, index) => {
            const angle = (2 * Math.PI * index) / n - Math.PI / 2;
            const x = CENTER.x + RADIUS.x * Math.cos(angle);
            const y = CENTER.y + RADIUS.y * Math.sin(angle);
            return (
              <g key={provider.id}>
                <line
                  x1={CENTER.x}
                  y1={CENTER.y}
                  x2={x}
                  y2={y}
                  stroke={statusColor(provider.overallStatus)}
                  strokeWidth={1.5}
                  opacity={0.7}
                />
                <rect
                  x={x - 40}
                  y={y - 16}
                  width={80}
                  height={32}
                  rx={8}
                  fill={statusFill(provider.overallStatus)}
                  stroke={statusColor(provider.overallStatus)}
                />
                <text x={x} y={y + 4} textAnchor="middle" fontSize={12} fill="currentColor">
                  {provider.name}
                </text>
              </g>
            );
          })}
          <circle
            cx={CENTER.x}
            cy={CENTER.y}
            r={38}
            fill="var(--color-card)"
            stroke="var(--color-primary)"
            strokeWidth={2}
          />
          <text
            x={CENTER.x}
            y={CENTER.y + 4}
            textAnchor="middle"
            fontSize={13}
            fontWeight={600}
            fill="currentColor"
          >
            {cause}
          </text>
        </svg>
        <ul className="flex min-w-0 flex-1 basis-60 flex-col text-sm">
          {failure.dependents.map((provider) => (
            <li
              key={provider.id}
              className="flex min-h-8 items-center justify-between border-b border-border"
            >
              <Link
                className="hover:underline"
                to={ROUTE_PATHS.providerDetail.replace(":providerId", provider.id)}
              >
                {provider.name}
              </Link>
              <span className="font-mono text-xs text-muted-foreground">{provider.id}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
