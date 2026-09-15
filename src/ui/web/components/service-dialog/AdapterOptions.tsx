import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";

/**
 * The adapter that reads a page's markup instead of a machine-readable
 * endpoint. It is the one adapter whose configuration cannot be inferred from a
 * base URL — an operator has to say which element to read and, when the page
 * uses unusual wording, which words mean what — so it is also the one adapter
 * this dialog grows fields for.
 */
export const SCRAPE_ADAPTER = "html";

/** Worst first, the order the reading itself resolves them in. */
const SCRAPE_SEVERITIES: { key: string; label: string; example: string }[] = [
  { key: "major_outage", label: "status.major-outage", example: "major outage, down" },
  { key: "partial_outage", label: "status.partial-outage", example: "partial outage" },
  { key: "degraded", label: "status.degraded", example: "degraded, slow" },
  { key: "operational", label: "status.operational", example: "all systems operational" },
];

/**
 * The probe (roadmap 1.8): the adapter that reads the operator's own endpoint
 * rather than a page a provider publishes. Like the scraper, its configuration
 * cannot be inferred from a URL — only the operator knows which answer counts
 * as healthy — so it is the second adapter this dialog grows fields for.
 */
export const PROBE_ADAPTER = "http";

/** Only the two methods a poller may safely repeat; the adapter refuses the rest. */
const PROBE_METHODS = ["GET", "HEAD"] as const;

/**
 * The two probes that speak no HTTP at all (roadmap 1.9): a bare TCP connect
 * and a DNS resolution. Like the one above them, neither can be inferred from
 * a base url — only the operator knows which port, or which record, is the one
 * that matters — so each grows its own small block of fields.
 */
export const TCP_ADAPTER = "tcp";
export const DNS_ADAPTER = "dns";

/** What the DNS probe can ask for; the adapter refuses anything else. */
const DNS_RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT"] as const;

/** Whether an adapter has any of the blocks below at all. */
export const hasAdapterOptions = (adapter: string): boolean =>
  adapter === SCRAPE_ADAPTER || adapter === PROBE_ADAPTER || adapter === TCP_ADAPTER || adapter === DNS_ADAPTER;

/**
 * The fields that only one adapter each can use, lifted out of the dialog body
 * (they were four inline blocks in `ServiceDialog`, roughly half its markup).
 *
 * They read as sections rather than as one flat run of inputs because the http
 * probe alone asks ten questions, and stacked flat an operator has to read ten
 * labels to discover that four of them are about timing. The headings are the
 * questions the fields under them answer.
 */
export function AdapterOptions({
  adapter, options, setOption, header, setHeader, fieldProps,
}: {
  adapter: string;
  options: Record<string, string>;
  setOption: (key: string, value: string) => void;
  /** The probe's single request header, held apart from `options`: see `storedHeader`. */
  header: { name: string; value: string };
  setHeader: (next: { name: string; value: string }) => void;
  fieldProps: Record<string, unknown>;
}) {
  const { t } = useTranslation();

  if (adapter === SCRAPE_ADAPTER) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t("scrape.warning")}</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="service-selector">{t("scrape.selector")}</Label>
          <Input
            id="service-selector"
            className="font-mono"
            value={options["selector"] ?? ""}
            onChange={(event) => setOption("selector", event.target.value)}
            {...fieldProps}
          />
          <span className="text-xs text-muted-foreground">{t("scrape.selector-hint")}</span>
        </div>
        <OptionGroup title={t("scrape.words")}>
          {SCRAPE_SEVERITIES.map((severity) => (
            <div key={severity.key} className="grid grid-cols-[8rem_1fr] items-center gap-2">
              <Label className="text-xs font-normal text-muted-foreground" htmlFor={`service-words-${severity.key}`}>
                {t(severity.label)}
              </Label>
              <Input
                id={`service-words-${severity.key}`}
                className="font-mono"
                placeholder={t("scrape.words-placeholder", { example: severity.example })}
                value={options[severity.key] ?? ""}
                onChange={(event) => setOption(severity.key, event.target.value)}
                {...fieldProps}
              />
            </div>
          ))}
          <span className="text-xs text-muted-foreground">{t("scrape.words-hint")}</span>
        </OptionGroup>
      </div>
    );
  }

  if (adapter === PROBE_ADAPTER) {
    const method = options["method"] ?? "GET";
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t("probe.warning")}</p>

        <OptionGroup title={t("probe.group.request")}>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>{t("probe.method")}</Label>
              <ToggleGroup
                type="single"
                spacing={1}
                className="w-full"
                value={method}
                onValueChange={(next) => {
                  if (next !== "") setOption("method", next);
                }}
              >
                {PROBE_METHODS.map((option) => (
                  <ToggleGroupItem key={option} value={option}>
                    {option}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="service-probe-path">{t("probe.path")}</Label>
              <Input
                id="service-probe-path"
                className="font-mono"
                value={options["path"] ?? ""}
                onChange={(event) => setOption("path", event.target.value)}
                {...fieldProps}
              />
            </div>
          </div>
          <span className="text-xs text-muted-foreground">{t("probe.path-hint")}</span>

          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="service-probe-header-name">{t("probe.header-name")}</Label>
              <Input
                id="service-probe-header-name"
                className="font-mono"
                value={header.name}
                onChange={(event) => setHeader({ ...header, name: event.target.value })}
                {...fieldProps}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="service-probe-header-value">{t("probe.header-value")}</Label>
              <Input
                id="service-probe-header-value"
                className="font-mono"
                placeholder={t("probe.header-value-placeholder")}
                value={header.value}
                onChange={(event) => setHeader({ ...header, value: event.target.value })}
                {...fieldProps}
              />
            </div>
          </div>
          <span className="text-xs text-muted-foreground">{t("probe.header-hint")}</span>
        </OptionGroup>

        <OptionGroup title={t("probe.group.healthy")}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="service-probe-status">{t("probe.expect-status")}</Label>
            <Input
              id="service-probe-status"
              className="font-mono"
              placeholder={t("probe.expect-status-placeholder")}
              value={options["expectStatus"] ?? ""}
              onChange={(event) => setOption("expectStatus", event.target.value)}
              {...fieldProps}
            />
            <span className="text-xs text-muted-foreground">{t("probe.expect-status-hint")}</span>
          </div>

          {/* Only a GET downloads a body to match against, so the two body
              fields are not offered against a HEAD the adapter would reject
              the moment it polled. */}
          {method === "GET" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="service-probe-expect-body">{t("probe.expect-body")}</Label>
                <Input
                  id="service-probe-expect-body"
                  className="font-mono"
                  value={options["expectBody"] ?? ""}
                  onChange={(event) => setOption("expectBody", event.target.value)}
                  {...fieldProps}
                />
                <span className="text-xs text-muted-foreground">{t("probe.expect-body-hint")}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="service-probe-absent-body">{t("probe.absent-body")}</Label>
                <Input
                  id="service-probe-absent-body"
                  className="font-mono"
                  value={options["absentBody"] ?? ""}
                  onChange={(event) => setOption("absentBody", event.target.value)}
                  {...fieldProps}
                />
                <span className="text-xs text-muted-foreground">{t("probe.absent-body-hint")}</span>
              </div>
            </>
          )}
        </OptionGroup>

        <OptionGroup title={t("probe.group.timing")}>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="service-probe-slow">{t("probe.slow-ms")}</Label>
              <Input
                id="service-probe-slow"
                type="number"
                min={1}
                value={options["slowMs"] ?? ""}
                onChange={(event) => setOption("slowMs", event.target.value)}
                {...fieldProps}
              />
              <span className="text-xs text-muted-foreground">{t("probe.slow-ms-hint")}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="service-probe-tls">{t("probe.tls-warn-days")}</Label>
              <Input
                id="service-probe-tls"
                type="number"
                min={1}
                value={options["tlsWarnDays"] ?? ""}
                onChange={(event) => setOption("tlsWarnDays", event.target.value)}
                {...fieldProps}
              />
              <span className="text-xs text-muted-foreground">{t("probe.tls-warn-days-hint")}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Stored only when switched off: following is the default, and an
                option repeating the default is noise in the exported config. */}
            <Switch
              id="service-probe-redirects"
              checked={(options["followRedirects"] ?? "yes") !== "no"}
              onCheckedChange={(next) => setOption("followRedirects", next ? "" : "no")}
            />
            <Label htmlFor="service-probe-redirects">{t("probe.follow-redirects")}</Label>
          </div>
        </OptionGroup>
      </div>
    );
  }

  if (adapter === TCP_ADAPTER) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t("tcp.warning")}</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="service-tcp-port">{t("tcp.port")}</Label>
            <Input
              id="service-tcp-port"
              type="number"
              min={1}
              max={65535}
              className="font-mono"
              value={options["port"] ?? ""}
              onChange={(event) => setOption("port", event.target.value)}
              {...fieldProps}
            />
            <span className="text-xs text-muted-foreground">{t("tcp.port-hint")}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="service-tcp-slow">{t("probe.slow-ms")}</Label>
            <Input
              id="service-tcp-slow"
              type="number"
              min={1}
              value={options["slowMs"] ?? ""}
              onChange={(event) => setOption("slowMs", event.target.value)}
              {...fieldProps}
            />
            <span className="text-xs text-muted-foreground">{t("tcp.slow-ms-hint")}</span>
          </div>
        </div>
      </div>
    );
  }

  if (adapter === DNS_ADAPTER) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t("dns.warning")}</p>
        <div className="flex flex-col gap-1.5">
          <Label>{t("dns.record-type")}</Label>
          <ToggleGroup
            type="single"
            spacing={1}
            className="w-full"
            value={options["recordType"] ?? "A"}
            onValueChange={(next) => {
              if (next !== "") setOption("recordType", next);
            }}
          >
            {DNS_RECORD_TYPES.map((option) => (
              <ToggleGroupItem key={option} value={option}>
                {option}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="service-dns-expect">{t("dns.expect-value")}</Label>
          <Input
            id="service-dns-expect"
            className="font-mono"
            value={options["expectValue"] ?? ""}
            onChange={(event) => setOption("expectValue", event.target.value)}
            {...fieldProps}
          />
          <span className="text-xs text-muted-foreground">{t("dns.expect-value-hint")}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="service-dns-resolver">{t("dns.resolver")}</Label>
            <Input
              id="service-dns-resolver"
              className="font-mono"
              placeholder={t("dns.resolver-placeholder")}
              value={options["resolver"] ?? ""}
              onChange={(event) => setOption("resolver", event.target.value)}
              {...fieldProps}
            />
            <span className="text-xs text-muted-foreground">{t("dns.resolver-hint")}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="service-dns-slow">{t("probe.slow-ms")}</Label>
            <Input
              id="service-dns-slow"
              type="number"
              min={1}
              value={options["slowMs"] ?? ""}
              onChange={(event) => setOption("slowMs", event.target.value)}
              {...fieldProps}
            />
            <span className="text-xs text-muted-foreground">{t("dns.slow-ms-hint")}</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

/** A titled run of fields, so ten inputs read as three questions. */
function OptionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      {children}
    </div>
  );
}
