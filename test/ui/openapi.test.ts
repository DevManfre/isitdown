import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime } from "../../src/ui/runtime.ts";
import { openapiDocument } from "../../src/ui/openapi.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

/**
 * Every route the Express app actually registers, read off its own router
 * rather than off the source: a spec checked against a hand-written list would
 * agree with the list and say nothing about the server.
 */
function registeredRoutes(app: unknown): string[] {
  const found: string[] = [];
  const layers =
    (app as { router?: { stack?: unknown[] } }).router?.stack ?? ([] as unknown[]);

  const walk = (stack: unknown[]): void => {
    for (const entry of stack) {
      const layer = entry as {
        route?: { path: string; methods: Record<string, boolean> };
        handle?: { stack?: unknown[] };
      };
      if (layer.route !== undefined) {
        for (const [method, on] of Object.entries(layer.route.methods)) {
          if (!on || method === "_all") continue;
          found.push(`${method.toUpperCase()} ${layer.route.path}`);
        }
        continue;
      }
      if (Array.isArray(layer.handle?.stack)) walk(layer.handle.stack);
    }
  };
  walk(layers);
  return found;
}

/** `/config/services/:id` in Express is `/config/services/{id}` in OpenAPI. */
const asOpenApiPath = (path: string): string =>
  path.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\{providerId\}\.svg/, "{providerId}.svg");

function documentedRoutes(): string[] {
  const document = openapiDocument() as { paths: Record<string, Record<string, unknown>> };
  const found: string[] = [];
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const method of Object.keys(operations)) {
      found.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return found;
}

async function app(): Promise<{ app: unknown; base: string; close: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-openapi-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    app: runtime.app,
    base: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

test("every route the server registers is described in the spec", async () => {
  const instance = await app();
  try {
    const documented = new Set(documentedRoutes());
    const undocumented = registeredRoutes(instance.app)
      .map((route) => {
        const [method, path] = route.split(" ");
        return `${method} ${asOpenApiPath(path ?? "")}`;
      })
      .filter((route) => !documented.has(route))
      .sort();

    assert.deepEqual(undocumented, [], `undocumented routes: ${undocumented.join(", ")}`);
  } finally {
    await instance.close();
  }
});

test("every route the spec describes exists on the server", async () => {
  const instance = await app();
  try {
    const registered = new Set(
      registeredRoutes(instance.app).map((route) => {
        const [method, path] = route.split(" ");
        return `${method} ${asOpenApiPath(path ?? "")}`;
      }),
    );
    const invented = documentedRoutes()
      .filter((route) => !registered.has(route))
      .sort();

    assert.deepEqual(invented, [], `documented but not served: ${invented.join(", ")}`);
  } finally {
    await instance.close();
  }
});

test("the document is served as JSON and as the same document in YAML", async () => {
  const instance = await app();
  try {
    const asJson = (await (await fetch(`${instance.base}/openapi.json`)).json()) as {
      openapi: string;
      info: { title: string };
    };
    assert.equal(asJson.openapi, "3.1.0");
    assert.equal(asJson.info.title, "IsItDown");

    const response = await fetch(`${instance.base}/openapi.yaml`);
    assert.match(response.headers.get("content-type") ?? "", /yaml/);
    assert.deepEqual(parse(await response.text()), asJson);
  } finally {
    await instance.close();
  }
});

test("the token scheme is declared but nothing requires it — most installations have no token", () => {
  // Roadmap 4.15 gave the API a credential, and it is optional by construction:
  // with no `API_TOKEN` set every route is open, so a `security` requirement on
  // a path — or a document-wide one — would tell a generated client to demand a
  // credential the instance it is talking to does not want.
  const document = openapiDocument() as {
    components: { securitySchemes?: Record<string, { type: string; scheme: string }> };
    security?: unknown;
    paths: Record<string, Record<string, { security?: unknown }>>;
  };
  assert.deepEqual(Object.keys(document.components.securitySchemes ?? {}), ["apiToken"]);
  assert.equal(document.components.securitySchemes?.["apiToken"]?.scheme, "bearer");
  assert.equal(document.security, undefined);
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      assert.equal(operation.security, undefined, `${method.toUpperCase()} ${path}`);
    }
  }
});
