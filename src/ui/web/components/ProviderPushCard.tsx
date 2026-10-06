import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ChevronRight, Copy, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useProviderPush } from "@/hooks/queries.ts";
import { formatDateTime, formatRelative, hostOf } from "@/lib/format.ts";

/** How long the "copied" confirmation stays before the button reads Copy again. */
const COPIED_MS = 2000;

/** Hosts a provider on the public internet can never reach. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** The guide's steps, in order — each a catalog key, so the list is the copy. */
const STEPS = ["push.guide.open", "push.guide.tab", "push.guide.paste", "push.guide.subscribe"] as const;

const STATE_KEYS = {
  off: "push.state.off",
  waiting: "push.state.waiting",
  working: "push.state.working",
} as const;

/**
 * The address the input shows: the token cut down to its ends, so the card can
 * sit on a shared screen without putting the whole credential on it. The copy
 * button still copies the full address.
 */
function masked(url: string): string {
  const at = url.indexOf("?token=");
  if (at === -1) return url;
  const token = url.slice(at + "?token=".length);
  if (token.length <= 8 || token.startsWith("<")) return url;
  return `${url.slice(0, at)}?token=${token.slice(0, 4)}${"•".repeat(8)}${token.slice(-2)}`;
}

/**
 * Subscribing a provider's own webhook — roadmap 1.2, design
 * `design/claude-design-prototypes/provider-push-subscription`.
 *
 * Push already existed as a route; what was missing was any way to find out it
 * did, what address to give the provider, and whether the provider was using
 * it. Three states, one card: off (how to turn it on), waiting (the address,
 * the guide), working (the last post, guide folded away).
 *
 * "Working" means a real post arrived. Statuspage sends no test event, so
 * there is nothing more honest to verify against, and the card says so rather
 * than offering a test button that could only test us.
 *
 * Absent for a provider the guide does not cover: a URL with no way to use it
 * is the half of the feature that misleads.
 */
export function ProviderPushCard({
  providerId,
  providerName,
  pageUrl,
  pollMinutes,
}: {
  providerId: string;
  providerName: string;
  pageUrl: string;
  pollMinutes: number;
}) {
  const { t, i18n } = useTranslation();
  const { data } = useProviderPush();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const provider = data?.providers.find((entry) => entry.providerId === providerId);
  if (data === undefined || provider === undefined || !provider.eligible) return null;

  const state = !data.enabled ? "off" : provider.received > 0 ? "working" : "waiting";
  const url = provider.url;

  const copy = async (): Promise<void> => {
    if (url === null) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  const guide = (
    <div className="flex flex-col gap-2">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">
        {t("push.guide.title", { host: hostOf(pageUrl) })}
      </span>
      <ol className="flex flex-col gap-2">
        {STEPS.map((step, index) => (
          <li key={step} className="flex items-baseline gap-3 text-sm">
            <span className="w-6 flex-none font-mono text-xs text-primary">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>
              <Trans
                i18nKey={step}
                values={{ host: hostOf(pageUrl) }}
                components={[
                  <a key="page" href={pageUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline" />,
                  <strong key="strong" className="font-semibold" />,
                ]}
              />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );

  return (
    <section
      aria-label={t("push.title")}
      data-testid="provider-push"
      data-state={state}
      className="flex flex-col gap-4 rounded-md border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-widest text-primary">{t("push.title")}</span>
        <span
          className={`flex items-center gap-2 rounded-full px-2.5 py-0.5 font-mono text-xs ${
            state === "working"
              ? "bg-status-operational/15 text-status-operational"
              : state === "waiting"
                ? "bg-status-degraded/15 text-status-degraded"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {state !== "off" && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
          {t(STATE_KEYS[state])}
        </span>
      </div>

      {state === "off" ? (
        <>
          <p className="max-w-3xl text-sm">
            {t("push.off.lead", { provider: providerName, minutes: pollMinutes })}
          </p>
          <p className="max-w-3xl text-sm text-muted-foreground">
            <Trans
              i18nKey="push.off.how"
              components={[<code key="code" className="rounded bg-muted px-1.5 font-mono text-xs text-foreground" />]}
            />
          </p>
        </>
      ) : (
        <>
          {state === "working" && provider.lastReceivedAt !== null && (
            <dl className="flex flex-wrap gap-8">
              <div className="flex flex-col gap-1">
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">{t("push.last")}</dt>
                <dd className="font-mono text-sm">
                  {formatDateTime(i18n.language, provider.lastReceivedAt)} ·{" "}
                  {formatRelative(i18n.language, provider.lastReceivedAt)}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">{t("push.received")}</dt>
                <dd className="font-mono text-sm">{t("push.received-count", { count: provider.received })}</dd>
              </div>
            </dl>
          )}

          {url !== null && (
            <div className="flex flex-col gap-2">
              <label
                htmlFor={`push-url-${providerId}`}
                className={state === "working" ? "sr-only" : "text-xs uppercase tracking-widest text-muted-foreground"}
              >
                {t("push.url")}
              </label>
              <div className="flex gap-2">
                <Input
                  id={`push-url-${providerId}`}
                  readOnly
                  value={masked(url)}
                  className="h-11 min-w-0 flex-1 font-mono text-xs"
                />
                <Button type="button" variant="outline" className="h-11" onClick={() => void copy()}>
                  <Copy className="size-4" aria-hidden="true" />
                  {copied ? t("push.copied") : t("push.copy")}
                </Button>
              </div>
              {state === "waiting" && (
                <span className="text-xs text-muted-foreground">
                  {data.tokenRevealed
                    ? t("push.secret", { provider: providerName })
                    : t("push.token-hidden")}
                </span>
              )}
            </div>
          )}

          {state === "waiting" && LOOPBACK.has(window.location.hostname) && (
            <div
              role="note"
              className="flex items-start gap-3 rounded-md border border-status-degraded/40 bg-status-degraded/10 px-3 py-2.5 text-sm"
            >
              <TriangleAlert className="mt-0.5 size-4 flex-none text-status-degraded" aria-hidden="true" />
              <span>
                <Trans
                  i18nKey="push.loopback"
                  values={{ host: window.location.hostname }}
                  components={[<span key="host" className="font-mono text-xs" />]}
                />
              </span>
            </div>
          )}

          {state === "waiting" ? (
            guide
          ) : (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="link" className="group h-11 px-0">
                  <ChevronRight
                    className="size-4 transition-transform group-data-[state=open]:rotate-90"
                    aria-hidden="true"
                  />
                  {t("push.guide.toggle")}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>{guide}</CollapsibleContent>
            </Collapsible>
          )}

          {state === "waiting" && (
            <span className="border-t border-border pt-3 text-xs text-muted-foreground">
              {t("push.fallback", { minutes: pollMinutes })}
            </span>
          )}
        </>
      )}
    </section>
  );
}
