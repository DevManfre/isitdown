import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { formatDuration } from "@/lib/format.ts";
import type { ProviderReliability } from "@/lib/types.ts";

/**
 * Which supplier is the problem, from rows rather than from memory — roadmap
 * 12.2.
 *
 * Memory over-weights the outage that happened during a demo. Mean time to
 * resolution, mean time between incidents and the longest single outage answer
 * the same question with the incident table, which has been filling up since
 * the first cycle.
 *
 * Every figure can be `null`, and each null means something different from
 * zero: no resolved incident to average, fewer than two incidents to be
 * between, nothing at all in the window. They are drawn as a dash rather than
 * as a flawless zero.
 */
export function ReliabilityTable({
  providers,
  nameOf,
}: {
  providers: ProviderReliability[];
  nameOf: (providerId: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const minutes = (value: number | null): string =>
    value === null
      ? t("reliability.no-answer")
      : formatDuration(i18n.language, value);

  const withIncidents = providers.filter((provider) => provider.incidents > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-base font-medium">
          {t("reliability.title")}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("reliability.hint")}
        </span>
      </div>

      {withIncidents.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          {t("reliability.empty")}
        </span>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("column.provider")}</TableHead>
              <TableHead>{t("column.incidents")}</TableHead>
              <TableHead>{t("reliability.mttr")}</TableHead>
              <TableHead>{t("reliability.mtbf")}</TableHead>
              <TableHead>{t("reliability.longest")}</TableHead>
              <TableHead>{t("reliability.forecast")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {withIncidents.map((provider) => {
              const delta = provider.incidents - provider.previousIncidents;
              return (
                <TableRow key={provider.providerId}>
                  <TableCell className="font-medium">
                    {nameOf(provider.providerId)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {provider.incidents}
                    {/* The direction of travel, which a count alone cannot give:
                        "six incidents" reads very differently against two last
                        month and against eleven. */}
                    <span className="ml-2 text-muted-foreground">
                      {delta === 0
                        ? "="
                        : delta > 0
                          ? `+${delta}`
                          : String(delta)}{" "}
                      {t("reliability.trend")}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {minutes(provider.mttrMinutes)}
                    {provider.resolved > 0 && (
                      <span className="ml-2 text-muted-foreground">
                        {t("reliability.resolved-count", {
                          count: provider.resolved,
                        })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {minutes(provider.mtbfMinutes)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {minutes(provider.longestOutageMinutes)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {provider.forecast === null ? (
                      <span title={t("reliability.forecast-too-new")}>
                        {t("reliability.no-answer")}
                      </span>
                    ) : (
                      <>
                        {t("reliability.forecast-value", {
                          probability: provider.forecast.probability,
                        })}
                        {/* The inputs beside the answer, so the sum can be
                            redone by whoever it is quoted to — roadmap 6.7. */}
                        <span className="ml-2 text-muted-foreground">
                          {t("reliability.forecast-basis", {
                            count: provider.forecast.incidents,
                            days: provider.forecast.basisDays,
                          })}
                        </span>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* A forecast about a vendor is the number most likely to be quoted
          out of context, so what it is travels with it rather than in a
          tooltip. */}
      {withIncidents.some((provider) => provider.forecast !== null) && (
        <span className="text-xs text-muted-foreground">
          {t("reliability.forecast-caveat")}
        </span>
      )}
    </div>
  );
}
