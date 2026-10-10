import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";

/**
 * The adapter that reads a page's markup instead of a machine-readable
 * endpoint. It is the one adapter whose configuration cannot be inferred from a
 * base URL — an operator has to say which element to read and, when the page
 * uses unusual wording, which words mean what — so it is also the one adapter
 * this dialog grows fields for.
 */
export const SCRAPE_ADAPTER = "html";
/**
 * The content watchdog (roadmap 1.12): the page that is only prose. It needs
 * the one thing no URL can say — what the page reads while nothing is wrong.
 */
export const WATCHDOG_ADAPTER = "watchdog";
/** The declared JSON mapping — roadmap 11.1. */
export const JSON_ADAPTER = "json";

/** Worst first, the order the reading itself resolves them in. */
const SCRAPE_SEVERITIES: { key: string; label: string; example: string }[] = [
  {
    key: "major_outage",
    label: "status.major-outage",
    example: "major outage, down",
  },
  {
    key: "partial_outage",
    label: "status.partial-outage",
    example: "partial outage",
  },
  { key: "degraded", label: "status.degraded", example: "degraded, slow" },
  {
    key: "operational",
    label: "status.operational",
    example: "all systems operational",
  },
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

/**
 * The vendor's own mail, read from a mailbox (roadmap 1.4). Nothing about it
 * can be inferred from a URL — whose mail, which login — so it grows fields.
 */
export const IMAP_ADAPTER = "imap";

/** What the DNS probe can ask for; the adapter refuses anything else. */
const DNS_RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT"] as const;

/**
 * The adapters that read a page over HTTP, and so can carry credentials for a
 * source behind a token (roadmap 1.5). Mirrors `AUTHENTICATED_READERS` in
 * `src/adapters/index.ts`, which the dashboard cannot import.
 */
export const AUTH_ADAPTERS = new Set([
  "statuspage",
  "rss",
  "slack",
  "aws",
  "gcp",
  "azure",
  SCRAPE_ADAPTER,
  WATCHDOG_ADAPTER,
  JSON_ADAPTER,
  "instatus",
  "betterstack",
  "cachet",
  "uptimekuma",
  "uptimecom",
]);

/** Whether an adapter has any of the blocks below at all. */
export const hasAdapterOptions = (adapter: string): boolean =>
  AUTH_ADAPTERS.has(adapter) ||
  adapter === SCRAPE_ADAPTER ||
  adapter === WATCHDOG_ADAPTER ||
  adapter === JSON_ADAPTER ||
  adapter === PROBE_ADAPTER ||
  adapter === TCP_ADAPTER ||
  adapter === DNS_ADAPTER ||
  adapter === IMAP_ADAPTER;

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
  adapter,
  options,
  setOption,
  header,
  setHeader,
  fieldProps,
}: {
  adapter: string;
  options: Record<string, string>;
  setOption: (key: string, value: string) => void;
  /** The single request header a probe or a page source sends, held apart from `options`: see `storedHeader`. */
  header: { name: string; value: string };
  setHeader: (next: { name: string; value: string }) => void;
  fieldProps: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  const credentials = (
    <AuthOptions
      options={options}
      setOption={setOption}
      header={header}
      setHeader={setHeader}
      fieldProps={fieldProps}
    />
  );

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
          <span className="text-xs text-muted-foreground">
            {t("scrape.selector-hint")}
          </span>
        </div>
        <OptionGroup title={t("scrape.words")}>
          {SCRAPE_SEVERITIES.map((severity) => (
            <div
              key={severity.key}
              className="grid grid-cols-[8rem_1fr] items-center gap-2"
            >
              <Label
                className="text-xs font-normal text-muted-foreground"
                htmlFor={`service-words-${severity.key}`}
              >
                {t(severity.label)}
              </Label>
              <Input
                id={`service-words-${severity.key}`}
                className="font-mono"
                placeholder={t("scrape.words-placeholder", {
                  example: severity.example,
                })}
                value={options[severity.key] ?? ""}
                onChange={(event) =>
                  setOption(severity.key, event.target.value)
                }
                {...fieldProps}
              />
            </div>
          ))}
          <span className="text-xs text-muted-foreground">
            {t("scrape.words-hint")}
          </span>
        </OptionGroup>
        {credentials}
      </div>
    );
  }

  if (adapter === WATCHDOG_ADAPTER) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t("watchdog.warning")}</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="service-watchdog-baseline">{t("watchdog.baseline")}</Label>
          <Textarea
            id="service-watchdog-baseline"
            className="font-mono"
            rows={3}
            value={options["baseline"] ?? ""}
            onChange={(event) => setOption("baseline", event.target.value)}
            {...fieldProps}
          />
          <span className="text-xs text-muted-foreground">
            {t("watchdog.baseline-hint")}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="service-watchdog-selector">{t("scrape.selector")}</Label>
          <Input
            id="service-watchdog-selector"
            className="font-mono"
            value={options["selector"] ?? ""}
            onChange={(event) => setOption("selector", event.target.value)}
            {...fieldProps}
          />
          <span className="text-xs text-muted-foreground">
            {t("watchdog.selector-hint")}
          </span>
        </div>
        {credentials}
      </div>
    );
  }

  if (adapter === JSON_ADAPTER) {
    // Roadmap 11.1. The long tail as a form: one path per field and a table of
    // status words, which is the whole difference between a provider costing
    // configuration and a provider costing an adapter.
    const pathField = (key: string, label: string, hint?: string) => (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`service-json-${key}`}>{t(label)}</Label>
        <Input
          id={`service-json-${key}`}
          className="font-mono"
          value={options[key] ?? ""}
          onChange={(event) => setOption(key, event.target.value)}
          {...fieldProps}
        />
        {hint !== undefined && (
          <span className="text-xs text-muted-foreground">{t(hint)}</span>
        )}
      </div>
    );

    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t("jsonmap.warning")}</p>
        <OptionGroup title={t("jsonmap.group.status")}>
          {pathField("path", "jsonmap.path", "jsonmap.path-hint")}
          {pathField(
            "statusPath",
            "jsonmap.status-path",
            "jsonmap.status-path-hint",
          )}
          {pathField(
            "statusMap",
            "jsonmap.status-map",
            "jsonmap.status-map-hint",
          )}
        </OptionGroup>
        <OptionGroup title={t("jsonmap.group.incidents")}>
          {pathField("incidentsPath", "jsonmap.incidents-path")}
          {pathField("incidentName", "jsonmap.incident-name")}
          {pathField("incidentId", "jsonmap.incident-id")}
          {pathField("incidentStatus", "jsonmap.incident-status")}
          {pathField("incidentImpact", "jsonmap.incident-impact")}
          {pathField("incidentUpdatedAt", "jsonmap.incident-updated")}
          <span className="text-xs text-muted-foreground">
            {t("jsonmap.incidents-hint")}
          </span>
        </OptionGroup>
        {credentials}
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
          <span className="text-xs text-muted-foreground">
            {t("probe.path-hint")}
          </span>

          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="service-probe-header-name">
                {t("probe.header-name")}
              </Label>
              <Input
                id="service-probe-header-name"
                className="font-mono"
                value={header.name}
                onChange={(event) =>
                  setHeader({ ...header, name: event.target.value })
                }
                {...fieldProps}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="service-probe-header-value">
                {t("probe.header-value")}
              </Label>
              <Input
                id="service-probe-header-value"
                className="font-mono"
                placeholder={t("probe.header-value-placeholder")}
                value={header.value}
                onChange={(event) =>
                  setHeader({ ...header, value: event.target.value })
                }
                {...fieldProps}
              />
            </div>
          </div>
          <span className="text-xs text-muted-foreground">
            {t("probe.header-hint")}
          </span>
        </OptionGroup>

        <OptionGroup title={t("probe.group.healthy")}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="service-probe-status">
              {t("probe.expect-status")}
            </Label>
            <Input
              id="service-probe-status"
              className="font-mono"
              placeholder={t("probe.expect-status-placeholder")}
              value={options["expectStatus"] ?? ""}
              onChange={(event) =>
                setOption("expectStatus", event.target.value)
              }
              {...fieldProps}
            />
            <span className="text-xs text-muted-foreground">
              {t("probe.expect-status-hint")}
            </span>
          </div>

          {/* Only a GET downloads a body to match against, so the two body
              fields are not offered against a HEAD the adapter would reject
              the moment it polled. */}
          {method === "GET" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="service-probe-expect-body">
                  {t("probe.expect-body")}
                </Label>
                <Input
                  id="service-probe-expect-body"
                  className="font-mono"
                  value={options["expectBody"] ?? ""}
                  onChange={(event) =>
                    setOption("expectBody", event.target.value)
                  }
                  {...fieldProps}
                />
                <span className="text-xs text-muted-foreground">
                  {t("probe.expect-body-hint")}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="service-probe-absent-body">
                  {t("probe.absent-body")}
                </Label>
                <Input
                  id="service-probe-absent-body"
                  className="font-mono"
                  value={options["absentBody"] ?? ""}
                  onChange={(event) =>
                    setOption("absentBody", event.target.value)
                  }
                  {...fieldProps}
                />
                <span className="text-xs text-muted-foreground">
                  {t("probe.absent-body-hint")}
                </span>
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
              <span className="text-xs text-muted-foreground">
                {t("probe.slow-ms-hint")}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="service-probe-tls">
                {t("probe.tls-warn-days")}
              </Label>
              <Input
                id="service-probe-tls"
                type="number"
                min={1}
                value={options["tlsWarnDays"] ?? ""}
                onChange={(event) =>
                  setOption("tlsWarnDays", event.target.value)
                }
                {...fieldProps}
              />
              <span className="text-xs text-muted-foreground">
                {t("probe.tls-warn-days-hint")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Stored only when switched off: following is the default, and an
                option repeating the default is noise in the exported config. */}
            <Switch
              id="service-probe-redirects"
              checked={(options["followRedirects"] ?? "yes") !== "no"}
              onCheckedChange={(next) =>
                setOption("followRedirects", next ? "" : "no")
              }
            />
            <Label htmlFor="service-probe-redirects">
              {t("probe.follow-redirects")}
            </Label>
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
            <span className="text-xs text-muted-foreground">
              {t("tcp.port-hint")}
            </span>
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
            <span className="text-xs text-muted-foreground">
              {t("tcp.slow-ms-hint")}
            </span>
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
          <span className="text-xs text-muted-foreground">
            {t("dns.expect-value-hint")}
          </span>
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
            <span className="text-xs text-muted-foreground">
              {t("dns.resolver-hint")}
            </span>
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
            <span className="text-xs text-muted-foreground">
              {t("dns.slow-ms-hint")}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (adapter === IMAP_ADAPTER) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t("imap.warning")}</p>
        <OptionGroup title={t("imap.login")}>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="service-imap-user">{t("imap.user")}</Label>
              <Input
                id="service-imap-user"
                className="font-mono"
                placeholder={t("imap.user-placeholder")}
                value={options["user"] ?? ""}
                onChange={(event) => setOption("user", event.target.value)}
                {...fieldProps}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="service-imap-password-env">{t("imap.password-env")}</Label>
              <Input
                id="service-imap-password-env"
                className="font-mono"
                placeholder={t("imap.password-env-placeholder")}
                value={options["passwordEnv"] ?? ""}
                onChange={(event) => setOption("passwordEnv", event.target.value)}
                {...fieldProps}
              />
            </div>
          </div>
          <span className="text-xs text-muted-foreground">
            {t("imap.credentials-hint")}
          </span>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="service-imap-port">{t("tcp.port")}</Label>
              <Input
                id="service-imap-port"
                type="number"
                min={1}
                max={65535}
                placeholder={t("imap.port-placeholder")}
                value={options["port"] ?? ""}
                onChange={(event) => setOption("port", event.target.value)}
                {...fieldProps}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="service-imap-mailbox">{t("imap.mailbox")}</Label>
              <Input
                id="service-imap-mailbox"
                className="font-mono"
                placeholder={t("imap.mailbox-placeholder")}
                value={options["mailbox"] ?? ""}
                onChange={(event) => setOption("mailbox", event.target.value)}
                {...fieldProps}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="service-imap-tls" className="font-normal">
              {t("imap.tls")}
            </Label>
            <Switch
              id="service-imap-tls"
              checked={!["no", "false", "0", "off"].includes((options["tls"] ?? "").toLowerCase())}
              onCheckedChange={(checked) => setOption("tls", checked ? "" : "no")}
            />
          </div>
        </OptionGroup>
        <OptionGroup title={t("imap.which-mail")}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="service-imap-from">{t("imap.from")}</Label>
            <Input
              id="service-imap-from"
              className="font-mono"
              placeholder={t("imap.from-placeholder")}
              value={options["from"] ?? ""}
              onChange={(event) => setOption("from", event.target.value)}
              {...fieldProps}
            />
            <span className="text-xs text-muted-foreground">
              {t("imap.from-hint")}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="service-imap-subject">{t("imap.subject")}</Label>
            <Input
              id="service-imap-subject"
              className="font-mono"
              placeholder={t("imap.subject-placeholder")}
              value={options["subject"] ?? ""}
              onChange={(event) => setOption("subject", event.target.value)}
              {...fieldProps}
            />
            <span className="text-xs text-muted-foreground">
              {t("imap.subject-hint")}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="service-imap-window">{t("imap.window-hours")}</Label>
            <Input
              id="service-imap-window"
              type="number"
              min={1}
              placeholder={t("imap.window-hours-placeholder")}
              value={options["windowHours"] ?? ""}
              onChange={(event) => setOption("windowHours", event.target.value)}
              {...fieldProps}
            />
            <span className="text-xs text-muted-foreground">
              {t("imap.window-hours-hint")}
            </span>
          </div>
        </OptionGroup>
      </div>
    );
  }

  if (AUTH_ADAPTERS.has(adapter)) return credentials;

  return null;
}

/**
 * Credentials for a source that answers only to somebody it knows — roadmap
 * 1.5. Every field that would hold a secret holds a variable's *name* instead,
 * and the header reuses the probe's pair: the same `header.<Name>` option, read
 * the same way, on a page adapter.
 */
function AuthOptions({
  options,
  setOption,
  header,
  setHeader,
  fieldProps,
}: {
  options: Record<string, string>;
  setOption: (key: string, value: string) => void;
  header: { name: string; value: string };
  setHeader: (next: { name: string; value: string }) => void;
  fieldProps: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  const field = (key: string, label: string, placeholder?: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`service-auth-${key}`}>{t(label)}</Label>
      <Input
        id={`service-auth-${key}`}
        className="font-mono"
        placeholder={placeholder === undefined ? undefined : t(placeholder)}
        value={options[key] ?? ""}
        onChange={(event) => setOption(key, event.target.value)}
        {...fieldProps}
      />
    </div>
  );

  return (
    <OptionGroup title={t("auth.group")}>
      <span className="text-xs text-muted-foreground">{t("auth.hint")}</span>
      {field("tokenEnv", "auth.token-env", "auth.token-env-placeholder")}
      <div className="grid grid-cols-2 gap-3">
        {field(
          "oauthTokenUrl",
          "auth.oauth-token-url",
          "auth.oauth-token-url-placeholder",
        )}
        {field("oauthClientId", "auth.oauth-client-id")}
        {field(
          "oauthClientSecretEnv",
          "auth.oauth-secret-env",
          "auth.oauth-secret-env-placeholder",
        )}
        {field("oauthScope", "auth.oauth-scope", "auth.oauth-scope-placeholder")}
      </div>
      <span className="text-xs text-muted-foreground">
        {t("auth.oauth-hint")}
      </span>
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="service-auth-header-name">
            {t("probe.header-name")}
          </Label>
          <Input
            id="service-auth-header-name"
            className="font-mono"
            value={header.name}
            onChange={(event) =>
              setHeader({ ...header, name: event.target.value })
            }
            {...fieldProps}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="service-auth-header-value">
            {t("probe.header-value")}
          </Label>
          <Input
            id="service-auth-header-value"
            className="font-mono"
            placeholder={t("probe.header-value-placeholder")}
            value={header.value}
            onChange={(event) =>
              setHeader({ ...header, value: event.target.value })
            }
            {...fieldProps}
          />
        </div>
      </div>
      <span className="text-xs text-muted-foreground">
        {t("probe.header-hint")}
      </span>
    </OptionGroup>
  );
}

/** A titled run of fields, so ten inputs read as three questions. */
function OptionGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      {children}
    </div>
  );
}
