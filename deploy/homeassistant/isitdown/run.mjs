#!/usr/bin/env node
/**
 * The add-on's entry point: turn Home Assistant's `options.json` into the
 * environment the server already reads, then become the server.
 *
 * Written in node rather than as the usual `bashio` shell script because the
 * image has node and nothing else — adding a shell toolchain to read one JSON
 * file would undo the point of building the add-on on top of the published
 * image rather than rebuilding it.
 */

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const OPTIONS_PATH = "/data/options.json";

/** Absent or unreadable is the same as empty: an add-on with no options set. */
function options() {
  try {
    return JSON.parse(readFileSync(OPTIONS_PATH, "utf8"));
  } catch {
    return {};
  }
}

const { log_level: logLevel, ...credentials } = options();

const env = { ...process.env };
if (typeof logLevel === "string" && logLevel !== "") env["LOG_LEVEL"] = logLevel;
// Every other option is named after the variable a channel asks for, so it is
// passed through under its own name. An empty one is dropped rather than set to
// "": the UI edition reads an unset variable as "this channel is not configured
// yet", and an empty string would read as a credential that is simply wrong.
for (const [name, value] of Object.entries(credentials)) {
  if (typeof value === "string" && value.trim() !== "") env[name] = value;
}

// `spawn` with the signals forwarded, rather than `exec`: node has no execve,
// and the Supervisor stops an add-on with SIGTERM, which the server needs in
// order to finish the cycle it is in and close the database cleanly.
const child = spawn("node", ["dist/ui/server.js"], { cwd: "/app", env, stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  process.exit(signal === null ? (code ?? 0) : 128 + (signal === "SIGTERM" ? 15 : 2));
});
