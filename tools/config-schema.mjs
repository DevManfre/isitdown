#!/usr/bin/env node
/**
 * Writes the JSON Schema of the Light edition's `config.yml` (roadmap 11.5)
 * from its zod definition in `src/light/config/schema.ts`. Run it after
 * changing that file or a shared schema it reuses;
 * `test/tools/configSchema.test.ts` fails while the committed file and the
 * generated one differ.
 *
 *   node tools/config-schema.mjs
 *
 * The config schemas are zod v3, which has no `z.toJSONSchema`, so the
 * conversion goes through `zod-to-json-schema` — a devDependency, which is
 * why this lives in tools/ and never in src/: the running edition validates
 * with zod and has no use for the JSON form.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { fileConfigSchema } from "../src/light/config/schema.ts";

export const CONFIG_SCHEMA_PATH = "schema/config.schema.json";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Draft-07 rather than 2020-12: it is the draft every editor's YAML support
 * reads fully, and nothing here needs a later one. Inlined (`$refStrategy:
 * "none"`) so a tooltip shows the field itself, not a pointer to a definition;
 * transforms are described by what the file may contain (`effectStrategy:
 * "input"`), which is what an editor checks.
 */
export function configJsonSchema() {
  const schema = zodToJsonSchema(fileConfigSchema, {
    target: "jsonSchema7",
    $refStrategy: "none",
    effectStrategy: "input",
  });
  return {
    $schema: schema.$schema,
    $id: `https://raw.githubusercontent.com/DevManfre/isitdown/main/${CONFIG_SCHEMA_PATH}`,
    title: "IsItDown config.yml",
    description:
      `The Light edition's configuration file. Secrets go in the environment and are referenced as \${VAR}.`,
    ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$schema")),
  };
}

if (process.argv[1]?.endsWith("config-schema.mjs")) {
  writeFileSync(`${ROOT}${CONFIG_SCHEMA_PATH}`, `${JSON.stringify(configJsonSchema(), null, 2)}\n`);
  console.log(`wrote ${CONFIG_SCHEMA_PATH}`);
}
