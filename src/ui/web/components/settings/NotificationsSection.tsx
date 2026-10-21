import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { SettingsSection } from "@/components/SettingsSection.tsx";
import {
  ChannelRow,
  ChannelSummary,
  channelRank,
} from "@/components/settings/ChannelRow.tsx";
import { MessagePreviewDialog } from "@/components/settings/MessagePreviewDialog.tsx";
import { RecipientsDialog } from "@/components/settings/RecipientsDialog.tsx";
import { RoutingRulesDialog } from "@/components/settings/RoutingRulesDialog.tsx";
import { SECTION_REELS } from "@/components/settings/reels.ts";
import { SECTION_CASCADE } from "@/components/settings/sectionCascade.ts";
import {
  useSettingsChrome,
  useSettingVisible,
} from "@/components/settings/SettingsChrome.tsx";
import { stagger } from "@/lib/stagger.ts";
import type {
  DescribedChannel,
  QuietHoursPolicy,
  RuntimeConfigResponse,
} from "@/lib/types.ts";

/**
 * A channel row the page's filter can take off the page. `ChannelRow` is shared
 * with nothing else, but it is long enough that giving it a second job — being
 * searchable — belongs out here rather than inside it.
 */
function FilterableChannel({
  channel,
  open,
  onOpenChange,
}: {
  channel: DescribedChannel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const visible = useSettingVisible(
    `${channel.id} ${channel.fields.map((field) => field.name).join(" ")}`,
  );
  if (!visible) return null;
  return (
    <ChannelRow channel={channel} open={open} onOpenChange={onOpenChange} />
  );
}

export function NotificationsSection({
  config,
  quietHours,
}: {
  config: RuntimeConfigResponse;
  quietHours: QuietHoursPolicy;
}) {
  const { t } = useTranslation();
  const { query } = useSettingsChrome();
  const [openChannel, setOpenChannel] = useState<string | undefined>(undefined);
  // Ten channels, seven of them typically never configured. The list leads with
  // what can actually send and keeps the rest behind one row.
  const [showAllChannels, setShowAllChannels] = useState(false);
  // Rank 2 is "its environment variables are not set" — a channel that has
  // never been configured, which is most of the ten on a typical instance.
  const rankedChannels = [...config.channels].sort(
    (a, b) => channelRank(a) - channelRank(b),
  );
  const unsetChannels = rankedChannels.filter(
    (channel) => channelRank(channel) === 2,
  ).length;
  const shownChannels =
    showAllChannels || query.trim() !== ""
      ? rankedChannels
      : rankedChannels.filter((channel) => channelRank(channel) < 2);

  return (
    <SettingsSection
      id="notifications"
      reel={SECTION_REELS.notifications}
      className="lg:col-span-3"
      title={t("settings.section.notifications")}
      note={t("settings.secret-note")}
      delay={stagger(2, SECTION_CASCADE)}
    >
      {config.channels.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {t("empty.no-data")}
        </p>
      ) : (
        <div className="flex flex-col px-4 pt-3">
          <ChannelSummary channels={config.channels} />
          {/* One row open at a time: the panel exists to be scannable, and
          every row expanded is the layout this replaced. Ten channels
          ship, and an instance typically configures two or three — the
          seven that have never been given a variable are a list of
          things that are not set up, so they wait behind one row. A
          typed filter overrides that: nothing is findable while it is
          hidden behind a disclosure. */}
          <div className="divide-y divide-border border-t border-border">
            {shownChannels.map((channel) => (
              <FilterableChannel
                key={channel.id}
                channel={channel}
                open={openChannel === channel.id}
                onOpenChange={(next) =>
                  setOpenChannel(next ? channel.id : undefined)
                }
              />
            ))}
          </div>
          {unsetChannels > 0 && query.trim() === "" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="my-1 self-start px-1 text-xs text-muted-foreground"
              onClick={() => setShowAllChannels((previous) => !previous)}
            >
              {showAllChannels
                ? t("channel.show-configured")
                : t("channel.show-all", { count: unsetChannels })}
            </Button>
          )}
        </div>
      )}
      {/* Roadmap 14.1, beside the routing rules rather than in a section of
      its own: both answer "what will actually happen when something
      breaks" — one for where a message goes, one for what it says. */}
      <SettingRow
        label={t("preview.title")}
        description={t("preview.hint")}
        align="top"
      >
        <MessagePreviewDialog />
      </SettingRow>

      <SettingRow
        label={t("settings.routing")}
        description={t("settings.routing.hint")}
        meta={t("settings.routing.count", {
          count: config.routing.rules.length,
        })}
        align="top"
      >
        <RoutingRulesDialog
          routing={config.routing}
          channels={config.channels}
          services={config.services}
          quietHours={quietHours}
        />
      </SettingRow>

      {/* Roadmap 3.5, under the rules it refines: the rules decide who may
          hear about a change, recipients decide how many times. */}
      <SettingRow
        label={t("settings.recipients")}
        description={t("settings.recipients.hint")}
        meta={t("settings.recipients.count", { count: (config.recipients ?? []).length })}
        align="top"
      >
        <RecipientsDialog recipients={config.recipients ?? []} channels={config.channels} />
      </SettingRow>
    </SettingsSection>
  );
}
