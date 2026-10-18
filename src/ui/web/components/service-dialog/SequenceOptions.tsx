import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";

/**
 * The transactional probe (roadmap 2.14): two or three requests in a row, with
 * a value pulled out of one answer and carried into the next. Like the other
 * probes its configuration cannot be inferred from a URL, so it has its own
 * block of fields — one group per step, the last of them the verdict.
 */
export const SEQUENCE_ADAPTER = "sequence";

/** The methods a step may use; the adapter refuses anything else. */
const STEP_METHODS = ["GET", "HEAD", "POST"] as const;

const HEADER_PREFIX = "header.";

/** What the `{{name}}` and `${VAR}` placeholders look like, passed in so the catalog carries no braces. */
const EXAMPLE_VARIABLE = "{{token}}";
const EXAMPLE_SECRET = "${PROBE_PASSWORD}";

/** Placeholders that are syntax, not prose: what a path, a status set and an extract rule look like. */
const EXAMPLE_PATH = "/api/login";
const EXAMPLE_STATUS = "200-299";
const EXAMPLE_EXTRACT = "token=json:data.token";

/** The headers a step stores as `stepN.header.<Name>`, back as `Name: value` lines. */
const headerLines = (options: Record<string, string>, n: number): string =>
  Object.entries(options)
    .filter(([key, value]) => key.startsWith(`step${n}.${HEADER_PREFIX}`) && value.trim() !== "")
    .map(([key, value]) => `${key.slice(`step${n}.${HEADER_PREFIX}`.length)}: ${value}`)
    .join("\n");

type Fields = {
  options: Record<string, string>;
  setOption: (key: string, value: string) => void;
  fieldProps: Record<string, unknown>;
};

function StepFields({ n, last, options, setOption, fieldProps }: Fields & { n: number; last: boolean }) {
  const { t } = useTranslation();
  const key = (name: string): string => `step${n}.${name}`;
  const method = options[key("method")] ?? "GET";

  // The text is held here rather than derived from the options: a half-typed
  // line has no colon yet and would otherwise vanish as soon as it was typed.
  const [headers, setHeaders] = useState(() => headerLines(options, n));
  const changeHeaders = (text: string): void => {
    setHeaders(text);
    const next = new Map<string, string>();
    for (const line of text.split("\n")) {
      const at = line.indexOf(":");
      if (at < 1) continue;
      next.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
    }
    for (const existing of Object.keys(options)) {
      if (existing.startsWith(key(HEADER_PREFIX)) && !next.has(existing.slice(key(HEADER_PREFIX).length))) {
        setOption(existing, "");
      }
    }
    for (const [name, value] of next) setOption(key(`${HEADER_PREFIX}${name}`), value);
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <p className="text-sm font-medium">
        {last ? t("sequence.step-last", { n }) : t("sequence.step", { n })}
      </p>
      <div className="flex flex-col gap-1.5">
        <Label>{t("sequence.method")}</Label>
        <ToggleGroup
          type="single"
          spacing={1}
          value={method}
          onValueChange={(next) => {
            if (next !== "") setOption(key("method"), next);
          }}
        >
          {STEP_METHODS.map((option) => (
            <ToggleGroupItem key={option} value={option}>
              {option}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="grid grid-cols-[1fr_8rem] gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`service-seq-${n}-path`}>{t("sequence.path")}</Label>
          <Input
            id={`service-seq-${n}-path`}
            className="font-mono"
            placeholder={EXAMPLE_PATH}
            value={options[key("path")] ?? ""}
            onChange={(event) => setOption(key("path"), event.target.value)}
            {...fieldProps}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`service-seq-${n}-status`}>{t("sequence.expect-status")}</Label>
          <Input
            id={`service-seq-${n}-status`}
            className="font-mono"
            placeholder={EXAMPLE_STATUS}
            value={options[key("expectStatus")] ?? ""}
            onChange={(event) => setOption(key("expectStatus"), event.target.value)}
            {...fieldProps}
          />
        </div>
      </div>
      {method === "POST" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`service-seq-${n}-body`}>{t("sequence.body")}</Label>
          <Textarea
            id={`service-seq-${n}-body`}
            className="font-mono"
            rows={3}
            value={options[key("body")] ?? ""}
            onChange={(event) => setOption(key("body"), event.target.value)}
            {...fieldProps}
          />
          <span className="text-xs text-muted-foreground">
            {t("sequence.body-hint", { secret: EXAMPLE_SECRET })}
          </span>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`service-seq-${n}-headers`}>{t("sequence.headers")}</Label>
        <Textarea
          id={`service-seq-${n}-headers`}
          className="font-mono"
          rows={2}
          placeholder={`Authorization: Bearer ${EXAMPLE_VARIABLE}`}
          value={headers}
          onChange={(event) => changeHeaders(event.target.value)}
          {...fieldProps}
        />
        <span className="text-xs text-muted-foreground">
          {t("sequence.headers-hint", { variable: EXAMPLE_VARIABLE })}
        </span>
      </div>
      {!last && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`service-seq-${n}-extract`}>{t("sequence.extract")}</Label>
          <Textarea
            id={`service-seq-${n}-extract`}
            className="font-mono"
            rows={2}
            placeholder={EXAMPLE_EXTRACT}
            value={options[key("extract")] ?? ""}
            onChange={(event) => setOption(key("extract"), event.target.value)}
            {...fieldProps}
          />
          <span className="text-xs text-muted-foreground">{t("sequence.extract-hint")}</span>
        </div>
      )}
    </div>
  );
}

export function SequenceOptions({ options, setOption, fieldProps }: Fields) {
  const { t } = useTranslation();
  const [third, setThird] = useState(() => Object.keys(options).some((key) => key.startsWith("step3.")));

  const dropThird = (): void => {
    for (const key of Object.keys(options)) if (key.startsWith("step3.")) setOption(key, "");
    setThird(false);
  };

  const count = third ? 3 : 2;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("sequence.warning")}</p>
      {Array.from({ length: count }, (_, index) => (
        <StepFields
          key={index + 1}
          n={index + 1}
          last={index + 1 === count}
          options={options}
          setOption={setOption}
          fieldProps={fieldProps}
        />
      ))}
      {third ? (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={dropThird}>
          {t("sequence.remove-step")}
        </Button>
      ) : (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setThird(true)}>
          {t("sequence.add-step")}
        </Button>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="service-seq-expect-body">{t("probe.expect-body")}</Label>
          <Input
            id="service-seq-expect-body"
            className="font-mono"
            value={options["expectBody"] ?? ""}
            onChange={(event) => setOption("expectBody", event.target.value)}
            {...fieldProps}
          />
          <span className="text-xs text-muted-foreground">{t("sequence.expect-body-hint")}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="service-seq-slow">{t("probe.slow-ms")}</Label>
          <Input
            id="service-seq-slow"
            type="number"
            min={1}
            value={options["slowMs"] ?? ""}
            onChange={(event) => setOption("slowMs", event.target.value)}
            {...fieldProps}
          />
          <span className="text-xs text-muted-foreground">{t("sequence.slow-ms-hint")}</span>
        </div>
      </div>
    </div>
  );
}
