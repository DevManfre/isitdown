import type { Recipient, ServiceDefinition } from "./configSource.interface.ts";
import type { Clock } from "./clock.ts";
import type { DeliveryConfig } from "./delivery.ts";
import type { Logger } from "./logger.ts";
import type { MessageRefStore } from "./messageRefStore.interface.ts";
import type { Notifier } from "./notifier.interface.ts";
import type { RoutingRule } from "./routing.ts";
import type { StatusChange, StatusChangeKind } from "./types.ts";

export interface SentRecord {
  /** The row's id, present only on a record read back from the store (roadmap 5.12). */
  id?: number | undefined;
  providerId: string;
  channel: string;
  kind: StatusChangeKind;
  /** The rendered message, kept so the UI edition can show what was sent. */
  text: string;
  sentAt: string;
  ok: boolean;
  error?: string | undefined;
  /**
   * How many times the channel was asked to take this message before the
   * outcome above. `1` is a send that worked first time or was never retried;
   * anything higher on a failed record is a dead letter — every attempt was
   * spent and the message is gone.
   */
  attempts: number;
}

export interface DispatchContext {
  services: ServiceDefinition[];
  locale: string;
  /**
   * Built fresh by the caller from the configuration of this cycle, so enabling
   * or disabling a channel takes effect without a restart.
   */
  notifiers: Notifier[];
  /**
   * Ordered by position; the dispatcher never reorders. Never empty — both
   * config sources substitute a catch-all.
   */
  rules: RoutingRule[];
  /**
   * Every channel id this edition can build, enabled or not. It separates "the
   * rule names a channel the operator switched off" (expected, silent) from
   * "the rule names a channel nothing knows about" (a typo or a channel since
   * removed, worth saying out loud). Passed in rather than read from the shared
   * registry because the UI edition contributes `webpush` through `extra`, and
   * a static list would warn about it on every send.
   */
  knownChannelIds: string[];
  /**
   * Quiet hours, the digest window and the per-provider cap. Optional so a
   * caller from before the policy existed still compiles into "everything
   * off", which is the behaviour it had.
   */
  delivery?: DeliveryConfig | undefined;
  /**
   * What each channel asked for about the *wording* of its messages, keyed by
   * channel id: the locale it reads in (roadmap 3.20) and the template it
   * renders with (roadmap 3.15).
   *
   * Separate from `notifiers` because a notifier is a transport and this is
   * not: the same Telegram notifier posts an Italian message and an English one
   * depending on nothing but which channel row it was built from. Optional and
   * defaulted to the context locale, so a caller from before it existed behaves
   * exactly as it did.
   */
  channelMessages?: Record<string, ChannelMessageOptions> | undefined;
  /**
   * The channels whose messages can carry Ack and Mute because the edition is
   * listening for the press (roadmap 3.1). Empty or absent — the Light edition,
   * and a UI edition with chatops off — means no message grows a button.
   */
  interactiveChannels?: readonly string[] | undefined;
  /**
   * Channels grouped by the person they reach, preferred first (roadmap 3.5).
   * Absent or empty means every channel a rule names is sent to on its own,
   * which is what every caller from before recipients existed asks for.
   */
  recipients?: readonly Recipient[] | undefined;
}

/** One channel's answer to "in what words?" — see `DispatchContext.channelMessages`. */
export interface ChannelMessageOptions {
  locale?: string | undefined;
  template?: string | undefined;
}

export interface Dispatcher {
  dispatch(changes: StatusChange[], ctx: DispatchContext): Promise<SentRecord[]>;
  /**
   * Delivers one operator-requested test message. It lives here, rather than in a
   * route, so that the dispatcher stays the single gate every outbound
   * notification passes through — the diff engine remains the only thing that
   * decides whether a *status change* notifies, and diagnostics cannot drift into
   * a second sending path.
   */
  sendTest(
    notifier: Notifier,
    service: DispatchContext["services"][number],
    locale: string,
    /**
     * The channel's own locale and template, when it has them. A test that
     * ignored them would show the operator a message the channel will never
     * send, which is the one thing a test must not do.
     */
    message?: ChannelMessageOptions | undefined,
  ): Promise<SentRecord>;
}

export interface DispatcherDeps {
  logger: Logger;
  /** Called once per send, success or failure — never once per attempt. The UI edition persists these. */
  onSent?: ((record: SentRecord) => void | Promise<void>) | undefined;
  /**
   * Injected so a test asserts the backoff schedule, and lets a digest window
   * and an hour of the cap elapse, instead of waiting any of them out. The wall
   * clock when absent.
   */
  clock?: Clock | undefined;
  /**
   * Where the id of the message already sent about an incident is kept, so the
   * next update can edit it (roadmap 3.19). Absent means the feature cannot
   * work at all, which is how a caller opts out of it entirely — an edition
   * with nowhere to keep a reference must not silently send duplicates.
   */
  messageRefs?: MessageRefStore | undefined;
  /**
   * What escalation (roadmap 3.2) needs to know that only the edition can say:
   * whether somebody has taken this provider's trouble in charge, and whether
   * the provider is still in trouble at all. Absent in the Light edition, which
   * has neither an acknowledgement nor a button to give one — and an escalation
   * that was asked for there is refused out loud rather than run blind, because
   * "nobody answered" is not a thing it can know.
   */
  escalation?:
    | {
        isAcked(providerId: string): Promise<boolean>;
        inTrouble(providerId: string): Promise<boolean>;
      }
    | undefined;
  /**
   * Incidents somebody asked to follow from the dashboard (roadmap 3.6): every
   * update of one reaches every enabled channel until it resolves, whatever the
   * routing rules say about its provider. Absent in the Light edition, which has
   * no button to follow anything with.
   */
  follows?:
    | {
        isFollowed(providerId: string, incidentId: string): Promise<boolean>;
        unfollow(providerId: string, incidentId: string): Promise<void>;
      }
    | undefined;
  /**
   * Draws a provider's last 24 hours (roadmap 3.12), or answers null when there
   * is nothing to draw. Absent in Light edition, which keeps no readings to draw
   * it from — `delivery.attachChart` there changes nothing.
   */
  charts?: { uptimeBar(providerId: string, name: string): Promise<string | null> } | undefined;
}
