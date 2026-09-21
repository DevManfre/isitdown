import type { ChatHistory, ChatopsBackend, ChatProvider } from "../core/chatops/backend.interface.ts";
import { handleMessage } from "../core/chatops/execute.ts";
import { isActive } from "../core/maintenance.ts";
import { offsetSegments, resolveZone, shiftDay, zonedDayKey } from "./calendarDays.ts";
import type { MaintenanceWindow } from "../core/types.ts";
import { createTelegramBot, type TelegramBot } from "../notifiers/telegram.bot.ts";
import { updateService } from "./dbConfigSource.ts";
import type { UiRuntimeCore } from "./runtime.ts";

/**
 * Chatops for the UI edition — roadmap 3.18.
 *
 * Only this edition, and the reason is the mute. A mute has to be *written*
 * somewhere the diff engine will read it back, and in the Light edition that
 * somewhere is `config.yml` — a file the operator owns, which this process has
 * no business rewriting behind their back. The UI edition already keeps its
 * configuration in SQLite and already lets the dashboard mute a provider, so a
 * chat command is a second door onto a room that exists rather than a new room.
 *
 * Everything here is the wiring: the reading half comes from the same runtime
 * the dashboard reads, so a `/status` in a chat and the grid on screen cannot
 * disagree, and the writing half is the same `updateService` the dashboard's
 * own mute button calls.
 */

/** A provider whose mute has run out is not muted, whatever the column still says. */
const liveMute = (mutedUntil: string | null | undefined, now: Date): string | null => {
  if (mutedUntil === undefined || mutedUntil === null) return null;
  const until = Date.parse(mutedUntil);
  return Number.isNaN(until) || until <= now.getTime() ? null : mutedUntil;
};

export function createChatopsBackend(runtime: UiRuntimeCore): ChatopsBackend {
  return {
    async listProviders(): Promise<ChatProvider[]> {
      const now = new Date();
      const serverNow = now.toISOString();
      const services = runtime.listAllServices().filter((service) => service.enabled);
      // The same 90 days the dashboard's headline covers, cut into the operator's
      // own calendar days (roadmap 10.7) so a reply in chat and the History view
      // cannot disagree about where a day ends. Built once for the whole fleet:
      // the window is the same for every provider.
      const zone = resolveZone(runtime.timeZone());
      const today = zonedDayKey(now, zone);
      const segments = offsetSegments(shiftDay(today, -89), today, zone);
      return Promise.all(
        services.map(async (service): Promise<ChatProvider> => {
          const state = await runtime.store.getState(service.id);
          const last = state.last;
          const history = await runtime.store.getDailyBuckets(service.id, segments).catch(() => []);
          const totals = history.reduce(
            (sum, bucket) => ({
              ok: sum.ok + bucket.okSamples,
              total: sum.total + bucket.totalSamples,
            }),
            { ok: 0, total: 0 },
          );
          return {
            id: service.id,
            name: service.name,
            status: last?.overallStatus ?? "unknown",
            openIncidents: last?.activeIncidents.length ?? 0,
            uptime90:
              totals.total === 0 ? null : Math.round((totals.ok / totals.total) * 10_000) / 100,
            mutedUntil: liveMute(service.mutedUntil, now),
            underMaintenance: (last?.maintenances ?? []).some((window: MaintenanceWindow) => isActive(window, serverNow)),
          };
        }),
      );
    },

    async history(providerId: string, days: number): Promise<ChatHistory | null> {
      const service = runtime.listAllServices().find((entry) => entry.id === providerId);
      if (service === undefined) return null;
      const config = await runtime.configSource.load();
      // The same history service the History view is drawn from, so a figure
      // read in a chat and the same figure read on screen come from one
      // calculation rather than two that may drift.
      const report = await runtime.history.getProviderHistory(
        providerId,
        days,
        config.polling.intervalMinutes,
      );
      const measured = report.dailySeries.filter((day) => day.uptime !== null);
      const worst = measured.reduce<{ day: string; uptime: number } | null>(
        (lowest, day) =>
          day.uptime !== null && (lowest === null || day.uptime < lowest.uptime)
            ? { day: day.day, uptime: day.uptime }
            : lowest,
        null,
      );
      return {
        providerId,
        name: service.name,
        days,
        uptime:
          report.sampleCount === 0
            ? null
            : days <= 7
              ? report.uptime7
              : days <= 30
                ? report.uptime30
                : report.uptime90,
        measuredDays: measured.length,
        incidents: report.incidentCount,
        worstDay: worst,
      };
    },

    async mute(providerId: string, until: string): Promise<void> {
      if (!updateService(runtime.db, providerId, { mutedUntil: until })) {
        throw new Error(`no provider called ${providerId}`);
      }
    },

    async unmute(providerId: string): Promise<void> {
      if (!updateService(runtime.db, providerId, { mutedUntil: null })) {
        throw new Error(`no provider called ${providerId}`);
      }
    },
  };
}

/**
 * Whether chatops is on, and which chats may command it.
 *
 * Off unless `TELEGRAM_CHATOPS=true`: an inbound command channel is a thing an
 * operator opts into, never something an upgrade switches on for them. The
 * allowlist defaults to the chat the telegram channel already sends to — the
 * one the operator configured and is already reading — and `TELEGRAM_COMMAND_CHAT_IDS`
 * adds others for an installation that alerts one chat and is commanded from
 * another.
 */
export function readChatopsSettings(
  env: NodeJS.ProcessEnv,
  telegramSettings: Record<string, string> | undefined,
): { enabled: boolean; botToken: string; allowedChatIds: string[] } {
  const enabled = (env["TELEGRAM_CHATOPS"] ?? "").trim().toLowerCase() === "true";
  const botToken = (telegramSettings?.["botToken"] ?? env["TELEGRAM_BOT_TOKEN"] ?? "").trim();
  const extra = (env["TELEGRAM_COMMAND_CHAT_IDS"] ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  const configured = (telegramSettings?.["chatId"] ?? "").trim();
  const allowedChatIds = [...new Set([configured, ...extra].filter((id) => id !== ""))];
  return { enabled, botToken, allowedChatIds };
}

/**
 * Builds the bot if the installation asked for one, and returns `null`
 * otherwise. Never throws: a misconfigured chat command must not stop the
 * process that is monitoring things.
 */
export async function createChatops(runtime: UiRuntimeCore): Promise<TelegramBot | null> {
  const config = await runtime.configSource.load();
  const telegram = config.channels.find((channel) => channel.id === "telegram" && channel.enabled);
  const settings = readChatopsSettings(runtime.env, telegram?.settings);
  if (!settings.enabled) return null;
  if (settings.botToken === "" || settings.allowedChatIds.length === 0) {
    runtime.logger.warn(
      "TELEGRAM_CHATOPS is on but there is no bot token or no chat allowed to command it, so nothing is listening",
    );
    return null;
  }

  const backend = createChatopsBackend(runtime);
  // The channel's own locale when it has one, so the chat that reads Italian
  // alerts gets Italian answers (roadmap 3.20's rule, applied to replies).
  const locale = telegram?.locale ?? config.locale;

  return createTelegramBot({
    botToken: settings.botToken,
    allowedChatIds: settings.allowedChatIds,
    logger: runtime.logger,
    onCommand: (text) => handleMessage({ backend, locale, text }),
  });
}
