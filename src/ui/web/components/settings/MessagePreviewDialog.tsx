import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { useMessagePreview } from "@/hooks/queries.ts";

/** The transitions the server will render. Kept in step with `PREVIEW_KINDS`. */
const KINDS = [
  "status_change",
  "incident_opened",
  "incident_resolved",
  "maintenance_started",
  "monitoring_degraded",
  "silent_outage",
] as const;

/**
 * Every configured channel's message, side by side — roadmap 14.1.
 *
 * Settings can already send a test and the routing rules already explain
 * themselves; what was missing was the *rendered text*, before it was real.
 * Which matters because two channels handed the same change in one cycle can
 * say different things: each carries its own locale (3.20) and template (3.15).
 *
 * A channel that builds a structure of its own shows the three parts it
 * assembles from rather than a drawing of its Slack block or Teams card. A
 * mock-up would be believed, and one that drifted would be worse than nothing.
 */
export function MessagePreviewDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>(KINDS[0]);
  // Only while the dialog is open: nothing here is worth a request on a
  // Settings page nobody has asked this question on.
  const { data } = useMessagePreview(kind, open);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {t("preview.open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("preview.title")}</DialogTitle>
          <DialogDescription>{t("preview.hint")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {t("preview.kind")}
          </span>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`preview.kind.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-3">
          {(data?.channels ?? []).map((channel) => (
            <div
              key={channel.channel}
              className="flex flex-col gap-1.5 rounded-md border border-border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-medium">
                  {channel.channel}
                </span>
                <Badge variant="muted">{channel.locale}</Badge>
                {channel.templated && (
                  <Badge variant="muted">{t("preview.templated")}</Badge>
                )}
                {!channel.enabled && (
                  <Badge variant="muted">{t("preview.disabled")}</Badge>
                )}
              </div>
              {channel.text === null ? (
                <>
                  <span className="font-mono text-xs whitespace-pre-wrap">
                    {channel.parts.heading}
                  </span>
                  <span className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                    {channel.parts.detail}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {channel.parts.url}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("preview.structured")}
                  </span>
                </>
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-xs">
                  {channel.text}
                </pre>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
