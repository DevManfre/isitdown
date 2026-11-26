#!/usr/bin/env node
/**
 * Writes the generic webhook's JSON Schema (roadmap 7.11) from its zod
 * definition in `src/notifiers/webhookEvent.ts`. Run after changing that file;
 * `test/notifiers/webhookEvent.test.ts` fails while the committed file and the
 * generated one differ.
 *
 *   node tools/webhook-schema.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WEBHOOK_SCHEMA_PATH, webhookJsonSchema } from "../src/notifiers/webhookEvent.ts";

const target = join(fileURLToPath(new URL("..", import.meta.url)), WEBHOOK_SCHEMA_PATH);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(webhookJsonSchema(), null, 2)}\n`);
console.log(`wrote ${WEBHOOK_SCHEMA_PATH}`);
