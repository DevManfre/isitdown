import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { useAnnotationEdits } from "@/hooks/queries.ts";
import { annotationColour } from "@/lib/chartConfig.ts";
import { formatDateTime } from "@/lib/format.ts";
import type { Annotation } from "@/lib/types.ts";

const COLOURS = ["accent", "warn", "danger", "neutral"] as const;

/** `datetime-local` wants the operator's own wall clock with no zone suffix. */
const localNow = (): string => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};

/**
 * Writing and listing the operator's own timeline markers — roadmap 12.1.
 *
 * The one thing on a chart IsItDown can never observe is what *we* did. Wiring
 * a deploy pipeline to `POST /annotations` is a line of CI; this is the same
 * thing by hand, and the reason both exist is that during an incident the first
 * question is "was it us or them", and a marker on the trend line answers it
 * without anybody opening a second tab.
 */
export function AnnotationBar({
  annotations,
  providerId,
}: {
  annotations: Annotation[];
  /** Absent means the marker is about the whole fleet, which a deploy usually is. */
  providerId?: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const { add, remove } = useAnnotationEdits();
  const [label, setLabel] = useState("");
  const [at, setAt] = useState(localNow);
  const [colour, setColour] = useState<string>("accent");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (trimmed === "") return;
    add.mutate(
      {
        // `datetime-local` has no zone, so it is read as this browser's own —
        // which is what the operator typed.
        at: new Date(at).toISOString(),
        label: trimmed,
        colour,
        ...(providerId === undefined ? {} : { providerId }),
      },
      { onSuccess: () => setLabel("") },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-widest text-primary">
          {t("annotation.title")}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("annotation.hint")}
        </span>
      </div>

      <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {t("annotation.label")}
          </span>
          <Input
            value={label}
            maxLength={120}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {t("annotation.when")}
          </span>
          <Input
            type="datetime-local"
            value={at}
            onChange={(event) => setAt(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {t("annotation.colour")}
          </span>
          <Select value={colour} onValueChange={setColour}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLOURS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`annotation.colour.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Button type="submit" disabled={label.trim() === "" || add.isPending}>
          {t("annotation.add")}
        </Button>
      </form>

      {annotations.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          {t("annotation.none")}
        </span>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {annotations.map((annotation) => (
            <li
              key={annotation.id}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
            >
              <span
                aria-hidden="true"
                className="inline-block size-2 rounded-full"
                style={{ background: annotationColour(annotation.colour) }}
              />
              <span className="font-medium">{annotation.label}</span>
              <span className="font-mono text-muted-foreground">
                {formatDateTime(i18n.language, annotation.at)}
              </span>
              <button
                type="button"
                aria-label={t("annotation.remove")}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => remove.mutate(annotation.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
