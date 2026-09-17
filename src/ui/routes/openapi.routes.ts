import { Router } from "express";
import { stringify } from "yaml";
import { openapiDocument } from "../openapi.ts";

/**
 * The API describing itself — roadmap 4.10. Two representations of one
 * document: JSON for a generated client, YAML for a person reading it.
 *
 * Served from the running instance rather than only committed to the repo, so
 * the spec a client generates against is the one that instance actually
 * implements — and `test/ui/openapi.test.ts` holds it to the route table.
 */
export function openapiRoutes(): Router {
  const router = Router();

  router.get("/openapi.json", (_req, res) => {
    res.json(openapiDocument());
  });

  router.get("/openapi.yaml", (_req, res) => {
    res.type("text/yaml").send(stringify(openapiDocument(), { lineWidth: 0 }));
  });

  return router;
}
