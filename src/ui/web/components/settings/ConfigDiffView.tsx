import { useTranslation } from "react-i18next";
import type { ConfigChange, ConfigDiff } from "@/lib/types.ts";

/** A value as one short line: strings as they are, everything else as JSON, nothing as a dash. */
export function shortValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

function Changes({ id, changes }: { id?: string; changes: ConfigChange[] }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-0.5">
      {id !== undefined && <span className="font-mono text-sm">{id}</span>}
      {changes.map((change) => (
        <span key={change.path} className="font-mono text-xs break-words text-muted-foreground">
          {t("config.diff.change", {
            path: change.path,
            from: shortValue(change.from),
            to: shortValue(change.to),
          })}
        </span>
      ))}
    </li>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-sm text-muted-foreground">{title}</h3>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

/**
 * What an import or a restore would change, grouped the way the operator thinks
 * of the fleet: providers, settings, channels. Says "nothing would change" in
 * words when that is the answer — an empty list reads as a failure to load.
 */
export function ConfigDiffView({ diff }: { diff: ConfigDiff }) {
  const { t } = useTranslation();
  if (diff.empty) {
    return <p className="text-sm text-muted-foreground">{t("config.diff.empty")}</p>;
  }
  const { added, removed, changed } = diff.services;
  return (
    <div data-testid="config-diff" className="flex max-h-[min(24rem,50vh)] flex-col gap-4 overflow-y-auto pr-1">
      {added.length > 0 && (
        <Group title={t("config.diff.services-added")}>
          {added.map((id) => (
            <li key={id} className="font-mono text-sm">{id}</li>
          ))}
        </Group>
      )}
      {removed.length > 0 && (
        <Group title={t("config.diff.services-removed")}>
          {removed.map((id) => (
            <li key={id} className="font-mono text-sm">{id}</li>
          ))}
        </Group>
      )}
      {changed.length > 0 && (
        <Group title={t("config.diff.services-changed")}>
          {changed.map((entry) => (
            <Changes key={entry.id} id={entry.id} changes={entry.changes} />
          ))}
        </Group>
      )}
      {diff.settings.length > 0 && (
        <Group title={t("config.diff.settings")}>
          <Changes changes={diff.settings} />
        </Group>
      )}
      {diff.channels.length > 0 && (
        <Group title={t("config.diff.channels")}>
          {diff.channels.map((entry) => (
            <Changes key={entry.id} id={entry.id} changes={entry.changes} />
          ))}
        </Group>
      )}
      {(diff.routing !== null || diff.recipients !== null) && (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {diff.routing !== null && <li>{t("config.diff.routing", diff.routing)}</li>}
          {diff.recipients !== null && <li>{t("config.diff.recipients", diff.recipients)}</li>}
        </ul>
      )}
    </div>
  );
}
