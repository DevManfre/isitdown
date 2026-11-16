/**
 * Routing rules and recipients: the tables that decide who hears about a
 * change, and the API shape that describes them.
 */

import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  recipientSchema,
  recipientsSchema,
  routingRuleSchema,
  routingRulesSchema,
} from "../core/config.schema.ts";
import type { Recipient } from "../core/configSource.interface.ts";
import type { Logger } from "../core/logger.ts";
import type { RoutingRule } from "../core/routing.ts";
import { rollback } from "./db/open.ts";
import { listChannels } from "./dbChannels.ts";

const routingRowSchema = z.object({
  provider: z.string(),
  classes: z.string(),
  min_severity: z.string(),
  channels: z.string(),
});

/**
 * Rules in evaluation order. A row that cannot be read is dropped and counted
 * rather than served: routing is the one setting where a silent drop changes
 * behaviour in both directions — losing a muting rule resumes notifications,
 * losing a broad rule stops them — so the count reaches the dashboard and the
 * error reaches the log.
 */
export function listRoutingRules(
  db: DatabaseSync,
  logger: Logger,
): { rules: RoutingRule[]; invalid: number } {
  const rules: RoutingRule[] = [];
  let invalid = 0;

  for (const raw of db
    .prepare(
      "SELECT provider, classes, min_severity, channels FROM routing_rules ORDER BY position, id",
    )
    .all()) {
    const row = routingRowSchema.safeParse(raw);
    if (!row.success) {
      invalid += 1;
      logger.error("skipping an unreadable routing rule row", {
        issues: row.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`,
        ),
      });
      continue;
    }

    let parsed;
    try {
      parsed = routingRuleSchema.safeParse({
        provider: row.data.provider,
        classes: JSON.parse(row.data.classes),
        minSeverity: row.data.min_severity,
        channels: JSON.parse(row.data.channels),
      });
    } catch (error) {
      invalid += 1;
      logger.error("skipping a routing rule row with unparseable JSON", {
        provider: row.data.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (!parsed.success) {
      invalid += 1;
      logger.error("skipping an invalid routing rule row", {
        provider: row.data.provider,
        issues: parsed.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`,
        ),
      });
      continue;
    }
    rules.push(parsed.data);
  }

  return { rules, invalid };
}

/**
 * Rewrites the whole list in one transaction. Whole-list rather than per-row so
 * that reordering cannot interleave: two concurrent per-row position updates
 * settle in an order neither writer asked for, and the dashboard holds the full
 * list anyway.
 */
export function replaceRoutingRules(
  db: DatabaseSync,
  rules: RoutingRule[],
): void {
  // Validated before anything is deleted: a rejected write must leave the
  // previous rules in place, not an empty table.
  const validated = routingRulesSchema.parse(rules);

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM routing_rules");
    const insert = db.prepare(
      "INSERT INTO routing_rules (position, provider, classes, min_severity, channels) VALUES (?, ?, ?, ?, ?)",
    );
    validated.forEach((rule, index) => {
      insert.run(
        index,
        rule.provider,
        JSON.stringify(rule.classes),
        rule.minSeverity,
        JSON.stringify(rule.channels),
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    rollback(db);
    throw error;
  }
}

const recipientRowSchema = z.object({ id: z.string(), name: z.string(), channels: z.string() });

/**
 * Recipients in the order the operator wrote them (roadmap 3.5). A row that
 * cannot be read is dropped with an error in the log, like a routing rule's:
 * losing a recipient only means its channels are each sent to on their own
 * again, which is the duplicate the operator already lived with.
 */
export function listRecipients(db: DatabaseSync, logger: Logger): Recipient[] {
  const recipients: Recipient[] = [];
  for (const raw of db.prepare("SELECT id, name, channels FROM recipients ORDER BY position, id").all()) {
    const row = recipientRowSchema.safeParse(raw);
    let channels: unknown;
    try {
      channels = row.success ? JSON.parse(row.data.channels) : undefined;
    } catch {
      channels = undefined;
    }
    const parsed = row.success ? recipientSchema.safeParse({ ...row.data, channels }) : undefined;
    if (parsed === undefined || !parsed.success) {
      logger.error("skipping an unreadable recipient row", { id: row.success ? row.data.id : undefined });
      continue;
    }
    recipients.push(parsed.data);
  }
  return recipients;
}

/**
 * Rewrites every recipient in one transaction, for the reason routing rules
 * are: the dashboard holds the whole list, and per-row writes could interleave.
 * Validated before anything is deleted, channels included — a recipient that
 * names a channel this edition does not have would fall back onto nothing.
 */
export function replaceRecipients(db: DatabaseSync, recipients: Recipient[]): void {
  const validated = recipientsSchema.parse(recipients);
  const known = new Set(listChannels(db).map((channel) => channel.id));
  for (const recipient of validated) {
    const unknown = recipient.channels.find((channel) => !known.has(channel));
    if (unknown !== undefined) {
      throw new Error(`recipient ${recipient.id}: there is no channel called "${unknown}"`);
    }
  }

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM recipients");
    const insert = db.prepare("INSERT INTO recipients (id, position, name, channels) VALUES (?, ?, ?, ?)");
    validated.forEach((recipient, index) => {
      insert.run(recipient.id, index, recipient.name, JSON.stringify(recipient.channels));
    });
    db.exec("COMMIT");
  } catch (error) {
    rollback(db);
    throw error;
  }
}

/** The API shape, mirroring `describeChannels`. */
export function describeRouting(
  db: DatabaseSync,
  logger: Logger,
): { rules: RoutingRule[]; invalidRules: number } {
  const { rules, invalid } = listRoutingRules(db, logger);
  return { rules, invalidRules: invalid };
}
