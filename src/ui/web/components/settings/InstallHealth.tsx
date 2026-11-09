import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useInstallHealth } from "@/hooks/queries.ts";
import { formatRelative } from "@/lib/format.ts";
import type { AbandonedProvider, InstallCheck } from "@/lib/types.ts";

/**
 * Keys are literals, one per (check, state), not built from the id: the
 * catalog's orphan test can only see a key it can read.
 */
function checkText(check: InstallCheck): string {
  switch (check.id) {
    case "channels":
      return "install-health.channels.warn";
    case "channel-test":
      return check.days === undefined
        ? "install-health.channel-test.never"
        : "install-health.channel-test.stale";
    case "backup":
      return "install-health.backup.warn";
    case "retention":
      return "install-health.retention.warn";
    case "version":
      return check.state === "warn"
        ? "install-health.version.warn"
        : "install-health.version.unknown";
    case "token":
      return "install-health.token.warn";
  }
}

function FixLink({ to, children }: { to: string; children: string }) {
  // The manual is the one fix that is not a place in the dashboard.
  return to.startsWith("https://") ? (
    <Button asChild variant="outline" size="sm">
      <a href={to} target="_blank" rel="noreferrer">
        {children}
      </a>
    </Button>
  ) : (
    <Button asChild variant="outline" size="sm">
      <Link to={to}>{children}</Link>
    </Button>
  );
}

function AbandonedRow({ provider }: { provider: AbandonedProvider }) {
  const { t, i18n } = useTranslation();
  const when = formatRelative(i18n.language, provider.since);
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <span className="min-w-0 text-sm">
        {t(
          provider.reason === "disabled"
            ? "install-health.abandoned.disabled"
            : "install-health.abandoned.failing",
          { name: provider.name, when },
        )}
      </span>
      <FixLink to="/settings/services">{t("install-health.abandoned.review")}</FixLink>
    </li>
  );
}

/**
 * Roadmap 5.15 and 5.16, at the top of the Settings launcher: the things the
 * installation would like looked at, and nothing else. A line that is in
 * order is counted, not listed — a checklist of six ticks is noise — and when
 * everything is in order it says so in one sentence.
 *
 * Suggestions only. Nothing here removes or changes anything; each row leads to
 * the place where the operator does.
 */
export function InstallHealth() {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useInstallHealth();

  if (isPending && !isError) {
    return (
      <Card className="gap-3 p-5" aria-busy="true">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </Card>
    );
  }
  if (data === undefined) {
    return (
      <Card className="flex-row items-center justify-between gap-4 p-5" role="alert">
        <span className="text-sm">{t("install-health.error")}</span>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t("action.retry")}
        </Button>
      </Card>
    );
  }

  const attention = data.checks.filter((check) => check.state !== "ok");
  if (attention.length === 0 && data.abandoned.length === 0) {
    return (
      <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
        <CircleCheck className="size-4" aria-hidden="true" />
        {t("install-health.all-good")}
      </p>
    );
  }

  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-medium">{t("install-health.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("install-health.summary", {
            ok: data.checks.length - attention.length,
            total: data.checks.length,
          })}
        </p>
      </div>
      <ul className="flex flex-col divide-y">
        {attention.map((check) => (
          <li key={check.id} className="flex items-center justify-between gap-4 py-3">
            <span className="flex min-w-0 items-start gap-2 text-sm">
              <TriangleAlert
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              {t(checkText(check), { days: check.days })}
            </span>
            <FixLink to={check.fix}>{t("install-health.fix")}</FixLink>
          </li>
        ))}
        {data.abandoned.map((provider) => (
          <AbandonedRow key={provider.id} provider={provider} />
        ))}
      </ul>
    </Card>
  );
}
