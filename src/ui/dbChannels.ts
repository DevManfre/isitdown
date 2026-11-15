/**
 * The `channels` table: stored rows, edits, and the secret-free shape the API
 * hands back.
 */

import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { CHANNEL_MESSAGE_KEYS } from "../core/configSource.interface.ts";
import { isOptionalSetting } from "../notifiers/settings.ts";
import { templateProblems } from "../notifiers/template.ts";
import { ENV_SUFFIX } from "./dbSettings.ts";

const channelRowSchema = z.object({
  id: z.string(),
  enabled: z.number(),
  config: z.string(),
});

export interface StoredChannel {
  id: string;
  enabled: boolean;
  config: Record<string, string>;
}

export interface DescribedField {
  name: string;
  envVar: string;
  isSet: boolean;
  /** The channel works without it — the dashboard must not read it as missing. */
  optional: boolean;
}

export interface DescribedChannel {
  id: string;
  enabled: boolean;
  fields: DescribedField[];
  /**
   * The language this channel writes in (roadmap 3.20), empty for the
   * installation's own. Unlike a credential this *is* handed back: it is a
   * preference, not a secret, and a field the dashboard could set but never
   * read would show an empty box over a configured channel.
   */
  locale: string;
  /** This channel's message template (roadmap 3.15), empty for the default rendering. */
  template: string;
}

export function listChannels(db: DatabaseSync): StoredChannel[] {
  return db
    .prepare("SELECT id, enabled, config FROM channels ORDER BY id")
    .all()
    .map((row) => channelRowSchema.parse(row))
    .map((row) => ({
      id: row.id,
      enabled: row.enabled === 1,
      config: z.record(z.string()).parse(JSON.parse(row.config)),
    }));
}

export interface ChannelPatch {
  enabled?: boolean | undefined;
  /** Only `*Env` keys are accepted: the database stores references, not secrets. */
  fields?: Record<string, string> | undefined;
  /**
   * The channel's own locale (roadmap 3.20); `""` clears it back to the
   * installation's. Its own field rather than one of `fields` above, which is
   * deliberately closed to anything but an environment-variable reference — a
   * locale is neither a credential nor a reference to one.
   */
  locale?: string | undefined;
  /** The channel's own message template (roadmap 3.15); `""` clears it. */
  template?: string | undefined;
}

export function updateChannel(
  db: DatabaseSync,
  id: string,
  patch: ChannelPatch,
): boolean {
  const current = listChannels(db).find((channel) => channel.id === id);
  if (current === undefined) return false;

  let config = current.config;
  if (patch.fields !== undefined) {
    for (const [key, value] of Object.entries(patch.fields)) {
      if (!key.endsWith(ENV_SUFFIX)) {
        throw new Error(
          `channel ${id}: only environment variable references may be stored, so "${key}" must be named "${key}${ENV_SUFFIX}" and hold a variable name`,
        );
      }
      // A blank reference is not "unconfigured", it is a hole: emptying one
      // *Env field first and then pointing a second field at the variable the
      // first used to name is how a same-value alias sneaks past the
      // collision check below in two separate, individually-legal-looking
      // requests. There is no legitimate reason to store an empty variable
      // name, so refuse it outright.
      if (value === "") {
        throw new Error(
          `channel ${id}: "${key}" must name an environment variable, so it cannot be blank`,
        );
      }
    }
    config = { ...config, ...patch.fields };

    // Two different *Env fields must never end up naming the same variable, and
    // this has to hold across every channel, not only the one being patched —
    // otherwise a field on one channel (say webpush's "public" key) can be
    // aliased onto a variable another channel already uses for a real secret
    // (say Telegram's bot token). A name stored here decides which environment
    // variable's *value* a route later hands back (see GET /config/push), and
    // this dashboard has no authentication in front of this PATCH, so that
    // alias is a live credential-disclosure path, not just a config mistake.
    // Check every channel's merged config (existing fields plus this patch),
    // not just the patch, so a one-field patch that collides with an
    // already-stored field — in this channel or another — is caught too.
    //
    // Scoped to patch.fields !== undefined: an enabled-only toggle touches no
    // *Env field at all, so it cannot introduce a collision, and running this
    // scan unconditionally meant a database that already had two *Env fields
    // sharing a variable name (from before this guard existed, or a direct
    // edit) locked the operator out of toggling *any* channel with a 400 about
    // a field they never touched.
    const merged = listChannels(db).map((channel) =>
      channel.id === id ? { ...channel, config } : channel,
    );
    const byVariable = new Map<string, string>();
    for (const channel of merged) {
      for (const [key, value] of Object.entries(channel.config)) {
        if (!key.endsWith(ENV_SUFFIX) || value === "") continue;
        const identity = `${channel.id}.${key}`;
        const collidingIdentity = byVariable.get(value);
        if (collidingIdentity !== undefined) {
          throw new Error(
            `channel ${id}: patching would leave "${identity}" and "${collidingIdentity}" both referencing "${value}" — two different secrets cannot share one environment variable`,
          );
        }
        byVariable.set(value, identity);
      }
    }
  }

  // The two fields that say how a message reads rather than where it goes. An
  // empty string removes the key outright instead of storing a blank one: a
  // stored `""` and an absent key would both have to mean "the default", and
  // one of the two spellings would eventually be read as a real value.
  for (const key of CHANNEL_MESSAGE_KEYS) {
    const value = patch[key];
    if (value === undefined) continue;
    if (key === "template" && value !== "") {
      const problems = templateProblems(value);
      if (problems.length > 0)
        throw new Error(`channel ${id}: template — ${problems.join("; ")}`);
    }
    const { [key]: _dropped, ...rest } = config;
    config = value === "" ? rest : { ...rest, [key]: value };
  }

  db.prepare("UPDATE channels SET enabled = ?, config = ? WHERE id = ?").run(
    (patch.enabled ?? current.enabled) ? 1 : 0,
    JSON.stringify(config),
    id,
  );
  return true;
}

/** The only channel shape the API returns: names and whether they resolve. */
export function describeChannels(
  db: DatabaseSync,
  env: NodeJS.ProcessEnv,
): DescribedChannel[] {
  return listChannels(db).map((channel) => ({
    id: channel.id,
    enabled: channel.enabled,
    locale: channel.config["locale"] ?? "",
    template: channel.config["template"] ?? "",
    fields: Object.entries(channel.config)
      .filter(([key]) => key.endsWith(ENV_SUFFIX))
      .map(([key, envVar]) => ({
        name: key.slice(0, -ENV_SUFFIX.length),
        envVar,
        isSet: (env[envVar] ?? "") !== "",
        optional: isOptionalSetting(
          channel.id,
          key.slice(0, -ENV_SUFFIX.length),
        ),
      })),
  }));
}
