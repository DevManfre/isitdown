import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { WidgetCard } from "@/widgets/catalog/WidgetCard.tsx";
import type { IncidentTerm, IncidentWords } from "@/lib/types.ts";

/** Rows the title table shows: enough to see a pattern, few enough to read. */
const TERM_ROWS = 10;
const COMPONENT_ROWS = 10;

/**
 * Recurring phrases first, then the single words they do not already say: a
 * row for "error" under "elevated error rates" is the same finding twice.
 */
function termRows(words: IncidentWords): IncidentTerm[] {
  const phrases = words.phrases;
  const covered = new Set(phrases.flatMap((phrase) => phrase.term.split(" ")));
  return [...phrases, ...words.words.filter((word) => !covered.has(word.term))].slice(0, TERM_ROWS);
}

/**
 * What keeps breaking, in the providers' own words — roadmap 6.9.
 *
 * Shut by default: it is the kind of thing that is interesting once a month
 * and noise the rest of the time, so it folds rather than taking a place in
 * the Patterns tab's first screen (dashboard-design-direction: hide, don't
 * delete). The fold mounts the body on first open, so a shut card costs one
 * query and nothing else.
 */
export function IncidentWordsCard({
  data,
  isPending,
  isError,
  onRetry,
  nameOf,
}: {
  data: IncidentWords | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  nameOf: (providerId: string) => string;
}) {
  const { t } = useTranslation();
  const terms = data === undefined ? [] : termRows(data);
  const top = terms[0];
  const worst = data?.components[0];
  const quoted = top === undefined ? undefined : t("words.quoted", { term: top.term });

  const conclusion =
    data === undefined || data.incidents === 0
      ? undefined
      : [
          top === undefined
            ? undefined
            : t("words.conclusion-term", { term: top.term, count: top.incidents, total: data.incidents }),
          worst === undefined
            ? undefined
            : t("words.conclusion-component", {
                component: worst.name,
                provider: nameOf(worst.providerId),
                count: worst.badDays,
              }),
        ]
          .filter((part) => part !== undefined)
          .join(" ");

  return (
    <WidgetCard
      title={t("words.title")}
      busy={isPending}
      conclusion={conclusion}
      disclosure={{ id: "history-words", summary: quoted }}
    >
      {isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-8 w-full" />
          ))}
        </div>
      ) : isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm">
          <span>{t("words.error")}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t("action.retry")}
          </Button>
        </div>
      ) : data === undefined || data.incidents === 0 ? (
        <span className="text-sm text-muted-foreground">{t("words.empty")}</span>
      ) : (
        <div className="flex flex-col gap-6">
          <span className="text-xs text-muted-foreground">{t("words.hint")}</span>
          {terms.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("words.term")}</TableHead>
                  <TableHead>{t("column.incidents")}</TableHead>
                  <TableHead>{t("column.provider")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {terms.map((term) => (
                  <TableRow key={term.term}>
                    <TableCell className="font-medium">{term.term}</TableCell>
                    <TableCell className="font-mono text-xs">{term.incidents}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {term.providers.map(nameOf).join(", ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {data.components.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("words.component")}</TableHead>
                  <TableHead>{t("words.bad-days")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.components.slice(0, COMPONENT_ROWS).map((component) => (
                  <TableRow key={`${component.providerId}/${component.componentId}`}>
                    <TableCell>
                      <span className="font-medium">{component.name}</span>
                      <span className="ml-2 text-muted-foreground">{nameOf(component.providerId)}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{component.badDays}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </WidgetCard>
  );
}
