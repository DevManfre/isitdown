import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { isAbsolute, join, resolve } from "node:path";
import type { Adapter } from "../core/adapter.interface.ts";
import type { Logger } from "../core/logger.ts";
import { adapters, registerAdapter } from "./index.ts";

/**
 * Adapters loaded from a directory at boot — roadmap 1.13.
 *
 * The problem this solves is real: a provider with an unusual status page needs
 * an adapter, an adapter needs a pull request, and somebody who wants to watch
 * one internal service should not have to fork a monitoring tool to do it. A
 * file dropped in a directory is the whole feature.
 *
 * The row also named the cost, and it is not a small one: **a plugin is
 * arbitrary code running with the poller's own privileges**, in the process
 * that holds every channel credential the configuration resolved. There is no
 * sandbox here and there is not going to be one — Node has no boundary worth
 * the name for in-process code, and a fake one would be worse than an honest
 * absence.
 *
 * So the design is entirely about consent:
 *
 * - **Off unless asked for.** No default directory, in the image or anywhere
 *   else. `PLUGINS_DIR` has to be set, which means somebody chose this, rather
 *   than a path existing inside a container being enough.
 * - **Every load is announced.** One log line per plugin, with the file it came
 *   from and the id it claimed, so what is running is visible in `docker logs`
 *   rather than inferable from behaviour.
 * - **A plugin may not impersonate a built-in.** Overriding `statuspage` would
 *   silently change what every existing provider reads, which is the one thing
 *   a plugin must not be able to do quietly.
 *
 * And, separately, it is about not letting a plugin take the service down: a
 * file that will not import, exports nothing usable, or claims a malformed id
 * is logged and skipped. One bad file must not stop a fleet being polled —
 * the provider that needed it simply has no adapter, which the configuration
 * check already reports by name.
 */

/** Ids a plugin may not claim: whatever is already in the registry. */
export interface PluginLoadResult {
  adapters: Adapter[];
  /** One sentence per file that could not be used, in the order they were read. */
  problems: string[];
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** The extensions Node will import as a module from disk. */
const LOADABLE = [".js", ".mjs", ".cjs"];

/**
 * Whether a module's export is an adapter. Structural, because an adapter is an
 * interface rather than a class: a plugin cannot import this codebase's types,
 * so the only thing it can be held to is shape.
 */
function asAdapter(value: unknown): { adapter: Adapter } | { problem: string } {
  if (typeof value !== "object" || value === null) {
    return { problem: "its default export is not an object" };
  }
  const candidate = value as Partial<Adapter>;
  if (typeof candidate.id !== "string" || !SLUG.test(candidate.id)) {
    return {
      problem: `its id ${JSON.stringify(candidate.id)} is not a lowercase slug: letters, digits and dashes`,
    };
  }
  if (typeof candidate.fetchStatus !== "function") {
    return { problem: "it has no fetchStatus method" };
  }
  for (const optional of ["fetchIncidentHistory", "listComponents"] as const) {
    const method = candidate[optional];
    if (method !== undefined && typeof method !== "function") {
      return { problem: `its ${optional} is present but is not a function` };
    }
  }
  return { adapter: candidate as Adapter };
}

/**
 * Reads every loadable file in `dir`, in name order so a fleet's plugins load
 * the same way on every boot.
 *
 * `taken` is the set of ids already registered — the built-ins, and any plugin
 * loaded earlier in this same pass.
 */
export async function loadPluginAdapters(
  dir: string,
  taken: ReadonlySet<string>,
  logger: Logger,
): Promise<PluginLoadResult> {
  const adapters: Adapter[] = [];
  const problems: string[] = [];
  // Absolute, because the import below resolves against this file otherwise and
  // a relative `PLUGINS_DIR` would mean something different in every edition.
  const root = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);

  let entries: string[];
  try {
    entries = (await readdir(root)).filter((name) => LOADABLE.some((ext) => name.endsWith(ext))).sort();
  } catch (error) {
    // A directory that is not there is not a problem worth refusing to start
    // over: an operator who set the variable and has not mounted the volume yet
    // gets a line saying so and a running poller.
    logger.warn("the plugin directory could not be read — no plugin adapters were loaded", {
      dir: root,
      error: error instanceof Error ? error.message : String(error),
    });
    return { adapters, problems };
  }

  const claimed = new Set(taken);
  for (const name of entries) {
    const file = join(root, name);
    let module: { default?: unknown; adapter?: unknown };
    try {
      module = (await import(pathToFileURL(file).href)) as { default?: unknown; adapter?: unknown };
    } catch (error) {
      problems.push(`${name} could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    // `default` first, `adapter` second: a default export is what one file for
    // one adapter looks like, and the named one is for a plugin that also
    // exports helpers of its own.
    const exported = module.default ?? module.adapter;
    const result = asAdapter(exported);
    if ("problem" in result) {
      problems.push(`${name} is not an adapter: ${result.problem}`);
      continue;
    }

    if (claimed.has(result.adapter.id)) {
      // Refused rather than ignored quietly. A plugin taking `statuspage` would
      // change what every existing provider reads, and a plugin that lost a
      // race to another plugin would be a fleet whose behaviour depends on
      // filenames.
      problems.push(
        `${name} claims the adapter id "${result.adapter.id}", which is already taken — rename it`,
      );
      continue;
    }

    claimed.add(result.adapter.id);
    adapters.push(result.adapter);
    // Said out loud, every boot: a plugin runs with this process's privileges,
    // and what is running has to be readable in the logs rather than inferable
    // from behaviour.
    logger.warn("loaded a plugin adapter — it runs with this process's own privileges", {
      adapter: result.adapter.id,
      file,
    });
  }

  for (const problem of problems) logger.error("a plugin adapter was skipped", { problem });
  return { adapters, problems };
}

/**
 * The whole of what an edition's boot has to do: read the directory named by
 * `PLUGINS_DIR`, and put whatever came back into the shared registry.
 *
 * Both editions call this, with the same variable and the same rules, so a
 * plugin written for one works in the other — which is the point of an adapter
 * being edition-agnostic in the first place.
 *
 * Does nothing at all when the variable is unset, which is the default
 * everywhere including the images: running somebody else's code inside the
 * poller is a decision, not a directory that happens to exist.
 */
export async function registerPluginAdapters(
  env: NodeJS.ProcessEnv,
  logger: Logger,
): Promise<PluginLoadResult> {
  const dir = (env["PLUGINS_DIR"] ?? "").trim();
  if (dir === "") return { adapters: [], problems: [] };

  const result = await loadPluginAdapters(dir, new Set(Object.keys(adapters)), logger);
  for (const adapter of result.adapters) {
    try {
      registerAdapter(adapter);
    } catch (error) {
      // Only reachable if the registry changed under us between the collision
      // check and here. Reported rather than thrown for the same reason every
      // other failure in this file is: one plugin must not stop a fleet.
      result.problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}
