import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { useDeferredWrite } from "@/components/settings/SettingsToasts.tsx";
import { useSettingsReceipt } from "@/components/settings/useSettingsReceipt.ts";
import { useOperatorSeries, useOperatorSeriesMutations } from "@/hooks/queries.ts";
import type { NewOperatorSeries, OperatorSeries } from "@/lib/types.ts";

/** A Prometheus server's usual address, as a placeholder — a URL, not prose. */
const PROMETHEUS_PLACEHOLDER = "http://prometheus:9090";
const QUERY_PLACEHOLDER = 'sum(rate(http_requests_total{code=~"5.."}[5m]))';

/**
 * Settings → Data → Your metrics — roadmap 6.11, as agreed in the prototype.
 * The series already declared, each removable behind an undo, then the form
 * that adds one: a Prometheus query, or a CSV file of `timestamp,value` rows.
 * What a series is for is drawn on Incidents → Timeline, under the Gantt.
 */
export function OperatorSeriesRows() {
  const { t } = useTranslation();
  const { data } = useOperatorSeries();
  const series = data?.series ?? [];

  return (
    <>
      <SettingRow label={t("series.settings.label")} description={t("series.settings.hint")} align="top">
        {series.length === 0 ? (
          <span className="text-sm text-muted-foreground">{t("series.settings.none")}</span>
        ) : (
          <ul className="flex flex-col items-end gap-1.5">
            {series.map((entry) => (
              <SeriesItem key={entry.id} series={entry} />
            ))}
          </ul>
        )}
      </SettingRow>
      <AddSeriesRow />
    </>
  );
}

function SeriesItem({ series }: { series: OperatorSeries }) {
  const { t } = useTranslation();
  const { remove } = useOperatorSeriesMutations();
  const defer = useDeferredWrite();
  const receipt = useSettingsReceipt();
  const [removing, setRemoving] = useState(false);
  if (removing) return null;
  return (
    <li className="flex items-center gap-2 text-sm">
      <span>{series.name}</span>
      <span className="text-muted-foreground">
        {series.source === "prometheus" ? t("series.source.prometheus") : t("series.points", { count: series.points })}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t("series.remove", { name: series.name })}
        onClick={() => {
          setRemoving(true);
          defer("data", {
            text: t("series.removed", { name: series.name }),
            commit: () => remove.mutateAsync(series.id).catch((failure: unknown) => {
              setRemoving(false);
              receipt("data").onError(failure);
            }),
            onUndo: () => setRemoving(false),
          });
        }}
      >
        {t("action.remove")}
      </Button>
    </li>
  );
}

function AddSeriesRow() {
  const { t } = useTranslation();
  const { add } = useOperatorSeriesMutations();
  const receipt = useSettingsReceipt();
  const ids = { name: useId(), unit: useId(), url: useId(), query: useId(), file: useId(), error: useId() };
  const [source, setSource] = useState<"prometheus" | "csv">("prometheus");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [csv, setCsv] = useState<{ file: string; text: string } | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const ready = name.trim() !== "" && (source === "prometheus" ? url.trim() !== "" && query.trim() !== "" : csv !== undefined);

  const submit = (): void => {
    if (!ready) return;
    const body: NewOperatorSeries =
      source === "prometheus"
        ? { source, name: name.trim(), unit: unit.trim(), url: url.trim(), query: query.trim() }
        : { source, name: name.trim(), unit: unit.trim(), csv: csv?.text ?? "" };
    setError(undefined);
    const { onSuccess } = receipt("data", t("series.added", { name: name.trim() }));
    add.mutate(body, {
      onSuccess: () => {
        setName("");
        setUnit("");
        setUrl("");
        setQuery("");
        setCsv(undefined);
        onSuccess();
      },
      // Inline, beside the field that caused it: "line 12: cannot read…" means
      // nothing as a toast that has gone by the time the file is open.
      onError: (failure) => setError(failure instanceof Error ? failure.message : String(failure)),
    });
  };

  const described = error === undefined ? undefined : ids.error;

  return (
    <SettingRow label={t("series.add.label")} description={t("series.add.hint")} align="top">
      <form
        className="flex w-full max-w-md flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <ToggleGroup
          type="single"
          value={source}
          onValueChange={(next) => {
            if (next === "prometheus" || next === "csv") setSource(next);
          }}
          aria-label={t("series.add.source")}
          className="self-start"
        >
          <ToggleGroupItem value="prometheus">{t("series.source.prometheus")}</ToggleGroupItem>
          <ToggleGroupItem value="csv">{t("series.source.csv")}</ToggleGroupItem>
        </ToggleGroup>

        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <label className="flex flex-col gap-1 text-sm text-muted-foreground" htmlFor={ids.name}>
            {t("series.add.name")}
            <Input id={ids.name} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground" htmlFor={ids.unit}>
            {t("series.add.unit")}
            <Input id={ids.unit} value={unit} onChange={(event) => setUnit(event.target.value)} maxLength={16} />
          </label>
        </div>

        {source === "prometheus" ? (
          <>
            <label className="flex flex-col gap-1 text-sm text-muted-foreground" htmlFor={ids.url}>
              {t("series.add.url")}
              <Input
                id={ids.url}
                type="url"
                className="font-mono"
                placeholder={PROMETHEUS_PLACEHOLDER}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted-foreground" htmlFor={ids.query}>
              {t("series.add.query")}
              <Textarea
                id={ids.query}
                rows={2}
                className="font-mono"
                placeholder={QUERY_PLACEHOLDER}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-invalid={error !== undefined}
                aria-describedby={described}
              />
            </label>
            <span className="text-sm text-muted-foreground">{t("series.add.query-hint")}</span>
          </>
        ) : (
          <label className="flex flex-col gap-1 text-sm text-muted-foreground" htmlFor={ids.file}>
            {t("series.add.file")}
            <Input
              id={ids.file}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="cursor-pointer"
              aria-invalid={error !== undefined}
              aria-describedby={described}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file === undefined) return;
                void file.text().then((text) => {
                  setCsv({ file: file.name, text });
                  if (name.trim() === "") setName(file.name.replace(/\.[^.]+$/, ""));
                });
              }}
            />
            <span>{t("series.add.file-hint")}</span>
          </label>
        )}

        {error !== undefined && (
          <p id={ids.error} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" variant="outline" size="sm" className="self-start" disabled={!ready || add.isPending}>
          {t("series.add.action")}
        </Button>
      </form>
    </SettingRow>
  );
}
