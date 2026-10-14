import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { slugify } from "@/lib/slugify.ts";

/** The most providers one provider may name, same as the schema behind it. */
export const MAX_DEPENDS_ON = 20;

/**
 * The providers one provider runs on — roadmap 2.9.
 *
 * Chips for what is declared, a field to add more. The suggestions are the
 * providers already configured, but typing a slug nobody monitors is allowed:
 * a cloud you only depend on is still worth naming. Declared by the operator,
 * never inferred — the hint says so, because nothing about the field would.
 */
export function DependsOnField({
  value,
  onChange,
  options,
  selfId,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  options: { id: string; name: string }[];
  /** The provider being edited, which cannot depend on itself. */
  selfId: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const nameOf = (id: string): string => options.find((entry) => entry.id === id)?.name ?? id;
  const needle = query.trim().toLowerCase();
  const suggestions = options
    .filter((entry) => entry.id !== selfId && !value.includes(entry.id))
    .filter(
      (entry) =>
        needle === "" || entry.id.includes(needle) || entry.name.toLowerCase().includes(needle),
    )
    .slice(0, 5);
  const full = value.length >= MAX_DEPENDS_ON;

  const add = (id: string): void => {
    if (id === "" || id === selfId || value.includes(id) || full) return;
    onChange([...value, id]);
    setQuery("");
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="service-depends-on">{t("field.depends-on")}</Label>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((id) => (
            <li
              key={id}
              className="inline-flex h-8 items-center gap-2 rounded-full bg-muted pr-1 pl-3 text-sm"
            >
              {nameOf(id)}
              <button
                type="button"
                aria-label={t("field.depends-on-remove", { name: nameOf(id) })}
                className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => onChange(value.filter((entry) => entry !== id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id="service-depends-on"
        value={query}
        disabled={full}
        placeholder={t("field.depends-on-add")}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Enter adds what is typed rather than submitting the whole dialog.
          if (event.key !== "Enter") return;
          event.preventDefault();
          add(suggestions[0]?.id ?? slugify(query));
        }}
      />
      {suggestions.length > 0 && needle !== "" && (
        <ul className="flex flex-col rounded-md border border-border p-1">
          {suggestions.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="flex min-h-9 w-full items-center justify-between rounded px-3 text-left text-sm hover:bg-muted"
                onClick={() => add(entry.id)}
              >
                <span>{entry.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{entry.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="text-xs text-muted-foreground">{t("field.depends-on-hint")}</span>
    </div>
  );
}
