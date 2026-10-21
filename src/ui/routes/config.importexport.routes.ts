import { z } from "zod";
import type { Router } from "express";
import { discover } from "../../adapters/discover.ts";
import { IMPORT_TOOLS, importMonitors, type ImportTool } from "../../adapters/import/index.ts";
import { listServices } from "../dbConfigSource.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { exportConfigYaml, importConfigYaml } from "../configFile.ts";
import { issues } from "./config.shared.ts";

const discoverRequestSchema = z.object({
  files: z
    .array(z.object({ path: z.string().min(1).max(255), content: z.string() }))
    .min(1)
    .max(50),
});

export function configImportExportRoutes(runtime: UiRuntimeCore, router: Router): void {
  const db = runtime.db;

  /**
   * Dependency discovery — roadmap 2.3. The files a project already has, pasted
   * or uploaded, mapped onto the catalog in force: the same pure function the
   * `isitdown discover` command runs over a directory. Nothing is added; each
   * proposal carries its evidence and whether the fleet already watches it.
   *
   * Bounded by the app's 64 kB body limit, which a manifest, a compose file or
   * a Terraform module fits in; a lockfile does not, and is not read anyway.
   */
  router.post("/config/discover", (req, res) => {
    const parsed = discoverRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    const taken = new Set(listServices(db).map((service) => service.id));
    const result = discover(parsed.data.files, runtime.catalogFeed.entries());
    res.json({
      ...result,
      providers: result.providers.map((provider) => ({ ...provider, configured: taken.has(provider.entry.id) })),
    });
  });

  /**
   * A neighbour tool's export, read into proposals — roadmap 2.4. The same
   * pure function `isitdown import` runs: nothing is added, and each proposal
   * says whether the fleet already has a provider with its id.
   *
   * The export arrives as a text body (YAML or JSON, up to the text parser's
   * 256 kB — an Uptime Kuma backup outgrows the JSON parser's 64 kB long
   * before it outgrows that), as `{ content }`, or as the export's own JSON
   * posted as it stands. `?from=` names the tool; absent, it is detected.
   */
  router.post("/config/import/neighbour", (req, res) => {
    const from = typeof req.query["from"] === "string" ? req.query["from"] : undefined;
    if (from !== undefined && !(IMPORT_TOOLS as readonly string[]).includes(from)) {
      res.status(400).json({ error: { message: `from must be one of ${IMPORT_TOOLS.join(", ")}` } });
      return;
    }
    const body: unknown = req.body;
    const content =
      typeof body === "string"
        ? body
        : typeof (body as { content?: unknown } | undefined)?.content === "string"
          ? (body as { content: string }).content
          : typeof body === "object" && body !== null && Object.keys(body).length > 0
            ? JSON.stringify(body)
            : "";
    if (content.trim() === "") {
      res.status(400).json({ error: { message: "send the export as the request body, or as { content }" } });
      return;
    }
    let result;
    try {
      result = importMonitors(content, runtime.catalogFeed.entries(), from as ImportTool | undefined);
    } catch (error) {
      res.status(400).json({ error: { message: error instanceof Error ? error.message : String(error) } });
      return;
    }
    const taken = new Set(listServices(db).map((service) => service.id));
    res.json({
      ...result,
      services: result.services.map((proposal) => ({ ...proposal, configured: taken.has(proposal.service.id) })),
    });
  });

  /**
   * The whole configuration as a Light edition `config.yml` (roadmap 4.3), as a
   * download: everything the dashboard configures otherwise lives only inside
   * one SQLite file, which makes a backup a database copy and "run this fleet in
   * Light" a retyping exercise.
   *
   * Credentials leave as `${VAR}` references, never values — the same thing the
   * database stores.
   */
  router.get("/config/export", (_req, res) => {
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader("content-type", "text/yaml; charset=utf-8");
    res.setHeader(
      "content-disposition",
      `attachment; filename="isitdown-config-${day}.yml"`,
    );
    res.send(exportConfigYaml(db, runtime.logger));
  });

  /**
   * The same file, read back (roadmap 4.3). Takes the YAML as a text body, or as
   * `{ yaml }` for a browser that would rather send JSON.
   *
   * Validated through the Light edition's own file schema before anything is
   * written, so a bad file changes nothing. A service the file does not mention
   * is removed the way the dashboard removes one — soft, restorable, history
   * intact — because an import is a configuration statement and must not be a
   * data-loss event.
   */
  router.post("/config/import", (req, res) => {
    const body = req.body;
    const source =
      typeof body === "string"
        ? body
        : typeof (body as { yaml?: unknown } | undefined)?.yaml === "string"
          ? (body as { yaml: string }).yaml
          : null;
    if (source === null || source.trim() === "") {
      res
        .status(400)
        .json({
          error: {
            message: "send the config.yml as the request body, or as { yaml }",
          },
        });
      return;
    }

    let report;
    try {
      report = importConfigYaml(db, source, runtime.logger);
    } catch (error) {
      res
        .status(400)
        .json({
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      return;
    }
    res.json(report);
    // Every provider the import added starts with no history, exactly as if it
    // had been added through the form.
    for (const id of report.added) void runtime.backfill.backfillOne(id);
  });
}
