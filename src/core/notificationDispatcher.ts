import { systemClock } from "./clock.ts";
import { DELIVERY_DEFAULTS, type DeliveryConfig } from "./delivery.ts";
import type { DispatchContext, Dispatcher, DispatcherDeps, SentRecord } from "./dispatcher.interface.ts";
import { createChannelHealth } from "./dispatchChannelHealth.ts";
import { createEscalations } from "./dispatchEscalation.ts";
import { attempt, chainsOf, createSender, MAX_ATTEMPTS, payloadServiceOf, type Attempt } from "./dispatchSender.ts";
import type { Notifier } from "./notifier.interface.ts";
import { onCallRecipientId } from "./onCall.ts";
import { clearsFloor, explain, inQuietHours, severityOf } from "./routing.ts";
import type { NotificationPayload, StatusChange, StatusChangeKind } from "./types.ts";
import { renderMessage } from "../notifiers/formatting.ts";

const HOUR_MS = 3600_000;

/**
 * Severity as a number, for picking the worst member of a digest. `unknown`
 * ranks below `operational` here — in a batch it is the least informative
 * thing present, and it must never stand in for a batch that also holds a real
 * outage.
 */
const RANK: Record<string, number> = {
  unknown: -1,
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
};

/** The changes a day-of-uptime picture belongs under: a provider's own state, moving. */
const CHART_KINDS: ReadonlySet<StatusChangeKind> = new Set([
  "status_change",
  "component_status_change",
  "incident_opened",
  "incident_updated",
  "incident_resolved",
]);

const rankOf = (status: string): number => RANK[status] ?? -1;

/**
 * The only caller of `Notifier.send` in either edition. Its input is the diff
 * engine's output, which is what keeps "should this notify?" answerable in one
 * place: no route handler and no poller shortcut may send a message.
 */
export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const { logger } = deps;

  // The poller has already moved the notify baseline by the time a dispatch
  // runs, so a throwing lookup would lose the alert for good. Each one falls
  // back to the answer that still delivers.
  async function orElse<T>(what: string, fallback: T, read: () => Promise<T>, context: Record<string, unknown>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      logger.error(`${what} failed; carrying on without it`, {
        ...context,
        error: error instanceof Error ? error.message : String(error),
      });
      return fallback;
    }
  }
  const clock = deps.clock ?? systemClock;
  const now = () => clock.now();
  const { deliver, deliverChain, settleAll } = createSender({
    logger,
    onSent: deps.onSent,
    clock,
    messageRefs: deps.messageRefs,
  });
  const escalations = createEscalations({
    logger,
    sender: { deliver },
    orElse,
    escalation: deps.escalation,
  });
  const channelHealth = createChannelHealth({ logger, sender: { deliver, deliverChain, settleAll } });
  const follows = deps.follows;
  const charts = deps.charts;

  /**
   * When this provider's recent messages went out, newest last. The cap's whole
   * state (roadmap 3.13), and deliberately in memory: a restart is the one
   * moment an operator is watching, and a cap that survived one would swallow
   * the first alerts after it for reasons nothing on screen could explain.
   */
  const recentSends = new Map<string, number[]>();

  /**
   * How many alerts the cap has swallowed for this provider since the last one
   * that got through. Carried into that next message rather than dropped:
   * silence an operator cannot distinguish from a broken channel is the one
   * thing a cap must not produce.
   */
  const suppressedSince = new Map<string, number>();

  /**
   * What is waiting for the next digest window, per channel (roadmap 3.12).
   * Per channel rather than global: the rules decide who covers a change, and
   * two channels covering different providers must not receive each other's
   * batch.
   */
  const digests = new Map<string, { since: number; items: NotificationPayload[]; fallbacks: string[] }>();

  /**
   * Incident updates waiting to see whether a newer one follows (roadmap 3.11),
   * keyed by provider and incident. Holds the latest change only — the whole
   * point is that the earlier ones are never sent — and when the first of the
   * run arrived, so a provider that updates every minute still gets a message
   * out once the window has passed instead of waiting forever. In memory like
   * the digest, for the same reason: a restart drops at most one window of
   * updates, and the next update says where the incident stands anyway.
   */
  const pendingUpdates = new Map<string, { change: StatusChange; since: number }>();
  const updateKey = (change: StatusChange): string => `${change.providerId}\u0000${change.incident?.id ?? ""}`;

  /**
   * The incident a message should be attached to, when the policy says one
   * incident is one message that gets edited (roadmap 3.19).
   *
   * Only the three incident kinds qualify: the opening message is the one that
   * gets edited, an update edits it, and the resolution edits it one last time
   * and lets it go. A status change or a maintenance window is not part of an
   * incident's story, and folding those into the same message would rewrite
   * history an operator had already read.
   */
  function linkOf(
    change: StatusChange,
    delivery: DeliveryConfig,
  ): { incidentId: string; final: boolean } | undefined {
    if (!delivery.updateInPlace) return undefined;
    const incidentId = change.incident?.id;
    if (incidentId === undefined) return undefined;
    if (
      change.kind !== "incident_opened" &&
      change.kind !== "incident_updated" &&
      change.kind !== "incident_resolved"
    ) {
      return undefined;
    }
    return { incidentId, final: change.kind === "incident_resolved" };
  }

  /** Whether this provider has any of its hourly allowance left at `at`. */
  function capAllows(providerId: string, at: number, cap: DeliveryConfig["cap"]): boolean {
    if (!cap.enabled) return true;
    // Pruned on read rather than on a timer: the map is only ever consulted
    // here, and a timer would keep a dispatcher's state alive for providers
    // nothing is polling any more.
    const window = (recentSends.get(providerId) ?? []).filter((sent) => at - sent < HOUR_MS);
    recentSends.set(providerId, window);
    return window.length < cap.maxPerHour;
  }

  /**
   * One message about one provider went out. Counted per change, not per
   * channel: a change routed to three channels is one thing the operator was
   * told, and counting the channels would make the cap depend on how many of
   * them are switched on.
   */
  function countSend(providerId: string, at: number): void {
    recentSends.set(providerId, [...(recentSends.get(providerId) ?? []), at]);
  }

  /** Takes the suppressed tally for a provider and clears it, so it is reported once. */
  function takeSuppressed(providerId: string): number {
    const count = suppressedSince.get(providerId) ?? 0;
    if (count > 0) suppressedSince.delete(providerId);
    return count;
  }

  /**
   * Sends every digest whose window has elapsed, and only those: a batch that
   * is still collecting is the whole point of the feature, so the flush is
   * driven by the clock rather than by a cycle happening to run.
   *
   * The notifier is looked up in the *current* cycle's channels, not captured
   * when the batch started: a channel switched off while a window was open has
   * its batch dropped with a line in the log, which is the same thing a
   * disabled channel does to an immediate send.
   */
  function flushDue(
    ctx: DispatchContext,
    delivery: DeliveryConfig,
    at: number,
    force: boolean,
  ): Attempt[] {
    const byChannelId = new Map(ctx.notifiers.map((notifier) => [notifier.id, notifier]));
    const windowMs = delivery.digest.windowMinutes * 60_000;
    const sends: Attempt[] = [];

    for (const [channelId, batch] of [...digests]) {
      if (!force && at - batch.since < windowMs) continue;
      digests.delete(channelId);
      const [worst] = [...batch.items].sort(
        (a, b) => rankOf(severityOf(b.change)) - rankOf(severityOf(a.change)),
      );
      if (worst === undefined) continue;

      const notifier = byChannelId.get(channelId);
      if (notifier === undefined) {
        logger.warn("dropping a digest for a channel that is no longer enabled", {
          channel: channelId,
          changes: batch.items.length,
        });
        continue;
      }
      // The recipient's later channels (roadmap 3.5), as they were when the
      // batch started, minus any switched off since.
      const chain = [
        notifier,
        ...batch.fallbacks.flatMap((id) => {
          const fallback = byChannelId.get(id);
          return fallback === undefined ? [] : [fallback];
        }),
      ];

      const suppressedCount = takeSuppressed(worst.change.providerId);
      // The batch is per channel, so its language is that channel's (roadmap
      // 3.20) — stamped on every member as well as on the payload, because the
      // digest renders one line per item out of each item's own locale. The
      // items were collected before anyone knew which channel would take them.
      const digestFor = (target: Notifier): NotificationPayload => {
        const locale = ctx.channelMessages?.[target.id]?.locale ?? ctx.locale;
        return {
          ...worst,
          locale,
          // Deliberately not templated: a template describes one change and this
          // is a batch of them. See `src/notifiers/template.ts`.
          template: undefined,
          // The most severe member stands in as "the change" so a channel that
          // colours or badges by severity still has one to read; `items` is what
          // the message is actually made of.
          digest: {
            items: batch.items.map((item) => ({ ...item, locale })),
            windowMinutes: delivery.digest.windowMinutes,
          },
          suppressedCount,
        };
      };
      countSend(worst.change.providerId, at);
      sends.push(
        attempt(
          deliverChain(chain, (target) => {
            const payload = digestFor(target);
            return deliver(target, payload, renderMessage(payload));
          }),
          worst.change.providerId,
          notifier.id,
          worst.change.kind,
        ),
      );
    }

    return sends;
  }

  /**
   * Waits for every send of a dispatch, then reads what they say about each
   * channel's health and, where one has now failed often enough, tells the
   * others (roadmap 3.4). Those alerts are counted too, so a second channel
   * failing while it says the first one is broken is told about next time.
   */
  async function finish(attempts: Attempt[], ctx: DispatchContext, delivery: DeliveryConfig, at: number): Promise<SentRecord[]> {
    const records = await settleAll(attempts);
    channelHealth.noteOutcomes(records, delivery.channelHealth.afterFailures);
    const alerts = await channelHealth.alerts(ctx, delivery, at);
    channelHealth.noteOutcomes(alerts);
    return [...records, ...alerts];
  }

  return {
    async sendTest(notifier, service, locale, message): Promise<SentRecord> {
      const payload: NotificationPayload = {
        change: {
          kind: "monitoring_degraded",
          providerId: service.id,
          currentStatus: "unknown",
          failureCount: 0,
          at: new Date(now()).toISOString(),
        },
        service: payloadServiceOf(service),
        locale: message?.locale ?? locale,
        ...(message?.template === undefined ? {} : { template: message.template }),
      };
      // One attempt: the operator is waiting on this answer (see `deliver`).
      return deliver(notifier, payload, renderMessage(payload), 1);
    },

    async dispatch(changes: StatusChange[], ctx: DispatchContext): Promise<SentRecord[]> {
      const delivery = ctx.delivery ?? DELIVERY_DEFAULTS;
      const at = now();

      // Not `changes.length === 0 && return`: a cycle in which nothing changed
      // is exactly when a digest window quietly runs out, and a flush that only
      // happened on a busy cycle would hold a batch until the next change —
      // which is the flood it exists to replace, delayed.
      const attempts: Attempt[] = flushDue(ctx, delivery, at, false);

      // Updates whose window ran out, ahead of this cycle's own changes and
      // through the same loop, so quiet hours, the cap and the digest judge them
      // exactly as they would have judged them on arrival. Everything still
      // waiting is released when the policy has been switched off, rather than
      // stranded in a map nothing reads.
      const windowMs = delivery.coalesce.windowMinutes * 60_000;
      const queue: { change: StatusChange; released: boolean }[] = [];
      for (const [key, entry] of [...pendingUpdates]) {
        if (delivery.coalesce.enabled && at - entry.since < windowMs) continue;
        pendingUpdates.delete(key);
        queue.push({ change: entry.change, released: true });
      }
      for (const change of changes) queue.push({ change, released: false });
      // Before this cycle's own changes are tracked, so a change cannot be
      // escalated in the dispatch that first sent it.
      attempts.push(...(await escalations.due(ctx, delivery, at)));
      if (queue.length === 0) return finish(attempts, ctx, delivery, at);

      const byId = new Map(ctx.services.map((service) => [service.id, service]));

      // Neither varies per change, so both are built once for the whole batch
      // rather than rebuilt on every iteration of the loop below.
      const byChannelId = new Map(ctx.notifiers.map((notifier) => [notifier.id, notifier]));
      const known = new Set(ctx.knownChannelIds);
      const enabledChannelIds = [...byChannelId.keys()];

      for (const { change, released } of queue) {
        const service = byId.get(change.providerId);
        if (service === undefined) {
          // A provider removed between the poll and the dispatch, which the UI
          // edition makes possible. Nothing to link to, so nothing to send.
          logger.warn("skipping a change for an unconfigured provider", {
            providerId: change.providerId,
            kind: change.kind,
          });
          continue;
        }

        const base: NotificationPayload = {
          change,
          service: payloadServiceOf(service),
          locale: ctx.locale,
        };

        // The incident is over, so an update still waiting would be sent after
        // the message that says it no longer matters.
        if (change.kind === "incident_resolved" && change.incident !== undefined) {
          pendingUpdates.delete(updateKey(change));
        }
        // An update waits for a newer one (roadmap 3.11). Held before routing
        // rather than after: nothing is decided about a message that may never
        // be sent, and what is decided at release time uses the hour it is sent.
        if (
          delivery.coalesce.enabled &&
          !released &&
          change.kind === "incident_updated" &&
          change.incident !== undefined
        ) {
          const key = updateKey(change);
          pendingUpdates.set(key, { change, since: pendingUpdates.get(key)?.since ?? at });
          continue;
        }

        // A scheduled report goes to the channel chosen for it and nowhere else
        // (roadmap 3.13): it is not an alert, so the rules, quiet hours, the cap
        // and the digest — all of which exist to decide who to interrupt — have
        // nothing to say about it. Waiting for the morning is the sender's call,
        // made before the change was built.
        if (change.kind === "periodic_report") {
          const target = byChannelId.get(delivery.report.channel);
          if (target === undefined) {
            logger.warn("the report could not be sent because its channel is not enabled", {
              channel: delivery.report.channel,
            });
            continue;
          }
          const message = ctx.channelMessages?.[target.id];
          const payload: NotificationPayload = { ...base, locale: message?.locale ?? base.locale };
          attempts.push(
            attempt(deliver(target, payload, renderMessage(payload)), change.providerId, target.id, change.kind),
          );
          continue;
        }

        // A routine test goes to the one channel it tests, nowhere else
        // (roadmap 3.16), and ignores quiet hours like any test does: its
        // sender already chose the hour, and a test held back until morning
        // proves nothing about tonight. Its failure feeds the same channel
        // health the real alerts do — see `noteOutcomes`.
        if (change.kind === "delivery_test") {
          const target = byChannelId.get(change.channel?.id ?? "");
          if (target === undefined) continue;
          const message = ctx.channelMessages?.[target.id];
          const payload: NotificationPayload = {
            ...base,
            locale: message?.locale ?? base.locale,
          };
          // One attempt, like the test button: a retry schedule would hide
          // exactly the flakiness the test is there to find.
          attempts.push(
            attempt(deliver(target, payload, renderMessage(payload), 1), change.providerId, target.id, change.kind),
          );
          continue;
        }

        // Who covers this change, and whether the hour of the day takes it
        // away from them again (roadmap 3.11). Evaluated together in core's own
        // evaluator, so the dashboard's dry run and this cannot disagree.
        const routed = explain(change, ctx.rules, enabledChannelIds, {
          quietHours: delivery.quietHours,
          at: new Date(at),
          // What lets a rule target "my deploy path" rather than four provider
          // ids (roadmap 2.6). Read off the service the change already resolved
          // to, so the evaluator stays pure and knows nothing about the fleet.
          ...(service.group === undefined ? {} : { providerGroup: service.group }),
          // And "everything tagged critical" (roadmap 5.4), the same way.
          ...(service.tags === undefined ? {} : { providerTags: service.tags }),
        });
        // Followed from the dashboard (roadmap 3.6): every enabled channel
        // hears this incident whatever the rules say about its provider. Its
        // resolution is the last thing followed, so the follow ends with it.
        const incidentId = change.incident?.id;
        const followed =
          follows !== undefined &&
          incidentId !== undefined &&
          (change.kind === "incident_opened" || change.kind === "incident_updated" || change.kind === "incident_resolved") &&
          (await orElse("checking whether an incident is followed", false, () => follows.isFollowed(change.providerId, incidentId), {
            providerId: change.providerId,
            incidentId,
          }));
        if (followed && change.kind === "incident_resolved") {
          await orElse("ending a follow", undefined, () => follows.unfollow(change.providerId, incidentId), {
            providerId: change.providerId,
            incidentId,
          });
        }
        // Quiet hours still hold a followed incident: following one says "tell
        // me every update", not "wake me for every update".
        const held = followed
          ? inQuietHours(delivery.quietHours, new Date(at)) && !clearsFloor(severityOf(change), delivery.quietHours.minSeverity)
          : routed.quieted;
        if (held) {
          logger.info("quiet hours held a change back", {
            providerId: change.providerId,
            kind: change.kind,
            floor: delivery.quietHours.minSeverity,
          });
          continue;
        }
        const routedTargets = followed ? [...new Set([...routed.targets, ...enabledChannelIds])] : routed.targets;
        // Whoever is on call this week also hears it (roadmap 3.15). Added to
        // the rules' targets, never replacing them: a rotation that names a
        // recipient nobody defined loses the extra reader, not the alert.
        const onCallId = delivery.onCall.enabled && clearsFloor(severityOf(change), delivery.onCall.minSeverity)
          ? onCallRecipientId(delivery.onCall, new Date(at))
          : undefined;
        const onCallRecipient = onCallId === undefined ? undefined : ctx.recipients?.find((candidate) => candidate.id === onCallId);
        if (onCallId !== undefined && onCallRecipient === undefined) {
          logger.warn("the on-call rotation names a recipient that does not exist", { recipient: onCallId });
        }
        const targets = onCallRecipient === undefined ? routedTargets : [...new Set([...routedTargets, ...onCallRecipient.channels])];
        if (targets.length === 0) continue;

        // The cap is per provider and per change, so it is asked once here
        // rather than inside the channel loop below (roadmap 3.13).
        if (!capAllows(change.providerId, at, delivery.cap)) {
          suppressedSince.set(change.providerId, (suppressedSince.get(change.providerId) ?? 0) + 1);
          logger.warn("the hourly cap held a change back", {
            providerId: change.providerId,
            kind: change.kind,
            maxPerHour: delivery.cap.maxPerHour,
          });
          continue;
        }

        // Under the floor, so it waits for the batch (roadmap 3.12). It is
        // deliberately not counted against the cap: a digest is one message
        // however many changes went into it, and charging each of them would
        // make the two controls fight.
        //
        // Also here, whether or not the digest is switched on, when the provider
        // is already in the outage this update is about (roadmap 3.14): the
        // alert that mattered went out when it began. Not for a followed
        // incident — following is the operator asking for every update.
        const batched =
          (delivery.knownOutage.enabled &&
            !followed &&
            change.kind === "incident_updated" &&
            change.currentStatus === "major_outage") ||
          (delivery.digest.enabled &&
            !clearsFloor(severityOf(change), delivery.digest.immediateFloor));

        // Taken once for the change, not once per channel: the tally is what
        // the operator was not told about this provider, and reporting it on
        // the first channel and zero on the rest would be a message that
        // disagrees with itself across channels.
        let counted = false;
        let suppressed: number | undefined;
        // Whether any channel was handed this change right now (not batched, not
        // skipped): the escalation clock starts from a message that went out.
        let sentNow = false;
        // The picture is drawn once for the change, not per channel: it is the
        // same twenty-four hours whoever reads it, and drawing it is a read of
        // the history. Only for changes about a provider's state — a report or a
        // channel alert has no provider whose day is worth a picture — and never
        // for a batch, which is about several. A failure to draw it costs the
        // picture, not the alert.
        const chart =
          delivery.attachChart && charts !== undefined && !batched && CHART_KINDS.has(change.kind)
            ? await orElse<NotificationPayload["chart"]>(
                "drawing the uptime chart",
                undefined,
                async () => {
                  const svg = await charts.uptimeBar(change.providerId, service.name);
                  return svg === null ? undefined : { svg, filename: `${change.providerId}-uptime-24h.svg` };
                },
                { providerId: change.providerId },
              )
            : undefined;

        // One chain per recipient the rule reached, one per lone channel
        // (roadmap 3.5): a recipient on Telegram and Discord hears this once.
        for (const chainIds of chainsOf(targets, ctx.recipients)) {
          const chain: Notifier[] = [];
          for (const channelId of chainIds) {
            const notifier = byChannelId.get(channelId);
            if (notifier !== undefined) {
              chain.push(notifier);
              continue;
            }
            // A configured-but-disabled channel is the normal case and says
            // nothing. A channel no registry knows is a broken rule, and a
            // broken routing rule means missing alerts.
            if (!known.has(channelId)) {
              logger.warn("a routing rule names an unknown channel", {
                channelId,
                providerId: change.providerId,
                kind: change.kind,
              });
            }
          }
          const [head, ...fallbacks] = chain;
          if (head === undefined) continue;

          if (batched) {
            const batch = digests.get(head.id) ?? { since: at, items: [], fallbacks: fallbacks.map((notifier) => notifier.id) };
            batch.items.push(base);
            digests.set(head.id, batch);
            continue;
          }

          if (!counted) {
            countSend(change.providerId, at);
            suppressed = takeSuppressed(change.providerId);
            counted = true;
          }
          // The two things the channel itself decides about the message: what
          // language it is written in (roadmap 3.20) and how it is laid out
          // (roadmap 3.15). Applied per channel rather than when `base` was
          // built, because one change routed to three channels can legitimately
          // be three different messages — and a fallback is a fourth.
          const payloadFor = (notifier: Notifier): NotificationPayload => {
            const message = ctx.channelMessages?.[notifier.id];
            return {
              ...base,
              locale: message?.locale ?? base.locale,
              ...(message?.template === undefined ? {} : { template: message.template }),
              ...(ctx.interactiveChannels?.includes(notifier.id) === true ? { interactive: true } : {}),
              suppressedCount: suppressed ?? 0,
              ...(chart === undefined ? {} : { chart }),
            };
          };
          attempts.push(
            attempt(
              deliverChain(chain, (notifier) => {
                const payload = payloadFor(notifier);
                return deliver(notifier, payload, renderMessage(payload), MAX_ATTEMPTS, linkOf(change, delivery));
              }),
              change.providerId,
              chain[0]?.id,
              change.kind,
            ),
          );
          sentNow = true;
        }
        if (sentNow) escalations.track(change, base, delivery, at);
      }

      return finish(attempts, ctx, delivery, at);
    },
  };
}
