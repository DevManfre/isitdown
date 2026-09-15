import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { ProviderIcon } from "@/components/ProviderIcon.tsx";
import { stagger } from "@/lib/stagger.ts";
import type { CatalogProvider } from "@/lib/types.ts";

/**
 * The three ways into the dialog, named.
 *
 * All three were already on screen in the old single-page form — a chip row of
 * catalog names, a Detect link beside the base URL, and a wrapped row of
 * sixteen adapter ids — and none of them was labelled, so nothing said they
 * were alternatives rather than steps. Naming them is most of the change.
 */
export type ServiceSource = "catalog" | "url" | "manual";

const SOURCES: { key: ServiceSource; label: string; hint: string }[] = [
  { key: "catalog", label: "source.catalog", hint: "source.catalog-hint" },
  { key: "url", label: "source.url", hint: "source.url-hint" },
  { key: "manual", label: "source.manual", hint: "source.manual-hint" },
];

/**
 * The adapters, in the two families an operator actually chooses between:
 * one reads a status page somebody else publishes, the other polls an endpoint
 * of the operator's own. Sixteen lowercase ids in one wrapped row said nothing
 * about which was which, and the ids alone say nothing about what they read.
 *
 * The per-adapter keys live beside the ids rather than being built from them
 * at render time: a template key that misses renders as its own name, and the
 * catalog tests can only check a key they can see written down.
 */
const ADAPTER_FAMILIES: { title: string; adapters: { id: string; hint: string; note: string }[] }[] = [
  {
    title: "adapter.family.page",
    adapters: [
      { id: "statuspage", hint: "adapter.hint.statuspage", note: "add.note.statuspage" },
      { id: "instatus", hint: "adapter.hint.instatus", note: "add.note.instatus" },
      { id: "betterstack", hint: "adapter.hint.betterstack", note: "add.note.betterstack" },
      { id: "cachet", hint: "adapter.hint.cachet", note: "add.note.cachet" },
      { id: "uptimekuma", hint: "adapter.hint.uptimekuma", note: "add.note.uptimekuma" },
      { id: "uptimecom", hint: "adapter.hint.uptimecom", note: "add.note.uptimecom" },
      { id: "rss", hint: "adapter.hint.rss", note: "add.note.rss" },
      { id: "html", hint: "adapter.hint.html", note: "add.note.html" },
      { id: "slack", hint: "adapter.hint.slack", note: "add.note.slack" },
      { id: "aws", hint: "adapter.hint.aws", note: "add.note.aws" },
      { id: "gcp", hint: "adapter.hint.gcp", note: "add.note.gcp" },
      { id: "azure", hint: "adapter.hint.azure", note: "add.note.azure" },
    ],
  },
  {
    title: "adapter.family.probe",
    adapters: [
      { id: "http", hint: "adapter.hint.http", note: "add.note.http" },
      { id: "tcp", hint: "adapter.hint.tcp", note: "add.note.tcp" },
      { id: "dns", hint: "adapter.hint.dns", note: "add.note.dns" },
      { id: "custom", hint: "adapter.hint.custom", note: "add.note.custom" },
    ],
  },
];

const ALL_ADAPTERS = ADAPTER_FAMILIES.flatMap((family) => family.adapters);

/** What an add starts on: the format most providers publish. */
export const DEFAULT_ADAPTER = "statuspage";

/**
 * What the base URL means differs per adapter — Statuspage appends a path to
 * it, the feed adapter reads it verbatim — so the hint is a key held beside
 * the adapter rather than built from its id at render time.
 */
const adapterNote = (adapter: string): string =>
  ALL_ADAPTERS.find((entry) => entry.id === adapter)?.note ?? "add.note.custom";

/**
 * Step one: where does this service's status come from?
 *
 * Exactly one question, which is the point — the form behind it asks eight,
 * and seven of them are answerable from the answer to this one.
 */
export function SourceStep({
  source, onSourceChange,
  catalog, query, onQueryChange, onPick, picked,
  baseUrl, onBaseUrlChange, onDetect, detecting,
  adapter, onAdapterChange,
  fieldProps,
}: {
  source: ServiceSource;
  onSourceChange: (next: ServiceSource) => void;
  catalog: CatalogProvider[] | undefined;
  query: string;
  onQueryChange: (next: string) => void;
  onPick: (entry: CatalogProvider) => void;
  /** The catalog id already picked, so the grid can show which tile is live. */
  picked: string | undefined;
  baseUrl: string;
  onBaseUrlChange: (next: string) => void;
  onDetect: () => void;
  detecting: boolean;
  adapter: string;
  onAdapterChange: (next: string) => void;
  fieldProps: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  const all = catalog ?? [];
  const needle = query.trim().toLowerCase();
  const matches = all.filter((entry) =>
    needle === "" ? true : `${entry.name} ${entry.id}`.toLowerCase().includes(needle),
  );

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        type="single"
        spacing={2}
        aria-label={t("source.label")}
        className="w-full"
        value={source}
        onValueChange={(next) => {
          if (next !== "") onSourceChange(next as ServiceSource);
        }}
      >
        {SOURCES.map((option) => (
          <ToggleGroupItem
            key={option.key}
            value={option.key}
            aria-label={t(option.label)}
            // The tray's own "on" fill is the page background, which on a
            // dialog painted in that same colour is no fill at all. These
            // three are the dialog's one real choice, so the chosen one is
            // tinted and edged like the catalog tile below it.
            className="h-auto flex-1 flex-col items-start gap-1 border border-border px-3 py-2.5 text-left data-[state=on]:border-primary data-[state=on]:bg-accent"
          >
            <span className="text-[13px] font-medium">{t(option.label)}</span>
            <span className="text-[11px] leading-snug font-normal text-muted-foreground">{t(option.hint)}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {source === "catalog" && (
        <div key="catalog" className="anim-panel flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label id="catalog-label">{t("catalog.label")}</Label>
            <Input
              id="catalog-search"
              type="search"
              className="h-8 w-52"
              value={query}
              placeholder={t("catalog.search-placeholder")}
              aria-label={t("catalog.search-label")}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </div>
          <div
            role="group"
            aria-labelledby="catalog-label"
            className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto rounded-md border border-dashed border-border p-2"
          >
            {matches.length === 0 ? (
              <span className="col-span-3 text-xs text-muted-foreground">{t("catalog.empty")}</span>
            ) : (
              matches.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  // The accessible name stays the provider's name alone: the
                  // adapter under it is a footnote, not part of what the tile
                  // is called.
                  aria-label={entry.name}
                  aria-pressed={picked === entry.id}
                  // Already watched: still listed, so the grid never looks
                  // like it forgot a provider, but adding it again would only
                  // earn a 409.
                  disabled={entry.configured}
                  onClick={() => onPick(entry)}
                  style={{ animationDelay: stagger(index) }}
                  className="anim-tile flex items-center gap-2 rounded-md border border-border p-2 text-left transition-colors hover:bg-accent disabled:opacity-45 disabled:hover:bg-transparent aria-pressed:border-primary aria-pressed:bg-accent"
                >
                  <ProviderIcon name={entry.name} baseUrl={entry.baseUrl} size={18} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-medium">{entry.name}</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {entry.configured ? t("catalog.added") : entry.adapter}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {t("catalog.count", { shown: matches.length, total: all.length })}
          </span>
        </div>
      )}

      {source === "url" && (
        <div key="url" className="anim-panel flex flex-col gap-1.5">
          <Label htmlFor="service-base-url">{t("field.base-url")}</Label>
          <div className="flex gap-2">
            <Input
              id="service-base-url"
              className="flex-1 font-mono"
              placeholder={t("add.url-placeholder")}
              value={baseUrl}
              onChange={(event) => onBaseUrlChange(event.target.value)}
              {...fieldProps}
            />
            <Button type="button" disabled={detecting || baseUrl.trim() === ""} onClick={onDetect}>
              {t("action.detect-adapter")}
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">{t("add.detect-hint")}</span>
        </div>
      )}

      {source === "manual" && (
        <div key="manual" className="anim-panel flex flex-col gap-3.5">
          {ADAPTER_FAMILIES.map((family) => (
            <div key={family.title} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {t(family.title)}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <ToggleGroup
                type="single"
                spacing={1}
                aria-label={t(family.title)}
                className="grid w-full grid-cols-2 gap-1.5"
                value={adapter}
                onValueChange={(next) => {
                  if (next !== "") onAdapterChange(next);
                }}
              >
                {family.adapters.map((option) => (
                  <ToggleGroupItem
                    key={option.id}
                    value={option.id}
                    // The id alone stays the accessible name: the vendor
                    // beside it is a gloss, not part of what the adapter is
                    // called.
                    aria-label={option.id}
                    className="h-auto w-full justify-start gap-2 border border-border px-2.5 py-1.5 data-[state=on]:border-primary data-[state=on]:bg-accent"
                  >
                    <span className="font-mono text-xs">{option.id}</span>
                    <span className="truncate text-[11px] font-normal text-muted-foreground">{t(option.hint)}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          ))}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="service-base-url">{t("field.base-url")}</Label>
            <Input
              id="service-base-url"
              className="font-mono"
              value={baseUrl}
              onChange={(event) => onBaseUrlChange(event.target.value)}
              {...fieldProps}
            />
            <span className="font-mono text-xs text-muted-foreground">{t(adapterNote(adapter))}</span>
          </div>
        </div>
      )}
    </div>
  );
}
