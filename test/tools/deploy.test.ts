import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, parseAllDocuments } from "yaml";
import { loadConfig } from "../../src/light/config/loadConfig.ts";

/**
 * The Kubernetes manifests and the Helm chart — roadmap 6.5.
 *
 * Nothing here talks to a cluster, and nothing here runs `helm`: this asserts
 * the properties that are wrong in a way a cluster would only tell you about at
 * 3am. Two replicas quietly running two pollers against one volume, a probe
 * pointed at the liveness path so a provider's outage restarts the pod, a
 * `config.yml` in a ConfigMap that the Light edition's own loader rejects, or a
 * template reading a value that `values.yaml` does not declare.
 */

const root = new URL("../../", import.meta.url);
const read = (path: string): Promise<string> => readFile(new URL(path, root), "utf8");

interface Manifest {
  kind: string;
  metadata: { name: string };
  spec?: Record<string, any>;
  data?: Record<string, string>;
  stringData?: Record<string, string>;
}

async function manifests(file: string): Promise<Manifest[]> {
  return parseAllDocuments(await read(`deploy/k8s/${file}`))
    .map((document) => document.toJS() as Manifest | null)
    .filter((document): document is Manifest => document !== null);
}

const kindOf = (documents: Manifest[], kind: string): Manifest | undefined =>
  documents.find((document) => document.kind === kind);

for (const edition of ["ui", "light"] as const) {
  test(`the ${edition} manifests run exactly one pod, and replace rather than roll it`, async () => {
    const deployment = kindOf(await manifests(`${edition}.yaml`), "Deployment");

    assert.equal(deployment?.spec?.["replicas"], 1, "a second replica is a second poller on one volume");
    // A ReadWriteOnce volume cannot be held by the old pod and the new one at
    // once, so a rolling update would stall waiting for itself.
    assert.equal(deployment?.spec?.["strategy"]?.type, "Recreate");
  });

  test(`the ${edition} manifests keep the data volume the state lives in`, async () => {
    const documents = await manifests(`${edition}.yaml`);
    const deployment = kindOf(documents, "Deployment");
    const container = deployment?.spec?.["template"].spec.containers[0];

    assert.ok(kindOf(documents, "PersistentVolumeClaim") !== undefined, "no claim for /app/data");
    assert.deepEqual(
      container.volumeMounts.find((mount: { mountPath: string }) => mount.mountPath === "/app/data")
        ?.mountPath,
      "/app/data",
    );
    assert.match(container.image, new RegExp(`^ghcr\\.io/devmanfre/isitdown:${edition}-`));
  });

  test(`the ${edition} manifests run as a non-root user, as the image does`, async () => {
    const deployment = kindOf(await manifests(`${edition}.yaml`), "Deployment");
    const security = deployment?.spec?.["template"].spec.securityContext;

    assert.equal(security.runAsNonRoot, true);
    assert.equal(security.runAsUser, 1000);
  });
}

test("the UI manifests probe liveness and readiness at the two paths that mean different things", async () => {
  const deployment = kindOf(await manifests("ui.yaml"), "Deployment");
  const container = deployment?.spec?.["template"].spec.containers[0];

  // Roadmap 6.9: a provider being unreachable must never restart the pod, and a
  // pod whose cycles are failing must not be sent traffic.
  assert.equal(container.livenessProbe.httpGet.path, "/health");
  assert.equal(container.readinessProbe.httpGet.path, "/ready");
  assert.equal(kindOf(await manifests("ui.yaml"), "Service")?.spec?.["ports"][0].targetPort, "http");
});

test("the Light manifests have no Service: that edition serves nothing", async () => {
  const documents = await manifests("light.yaml");

  assert.equal(kindOf(documents, "Service"), undefined);
  const container = documents.find((document) => document.kind === "Deployment")?.spec?.["template"].spec
    .containers[0];
  // Its probe is the image's own healthcheck script, since there is no port.
  assert.deepEqual(container.livenessProbe.exec.command, ["node", "dist/light/healthcheck.js"]);
});

test("the config.yml in the Light ConfigMap is one the Light edition's own loader accepts", async () => {
  const configMap = kindOf(await manifests("light.yaml"), "ConfigMap");
  const source = configMap?.data?.["config.yml"];
  assert.ok(source !== undefined, "no config.yml in the ConfigMap");

  // Through the loader itself rather than the schema: a manifest that ships a
  // file the container would refuse to start on is worse than no manifest.
  const dir = await mkdtemp(join(tmpdir(), "isitdown-k8s-"));
  const path = join(dir, "config.yml");
  await writeFile(path, source);
  const config = await loadConfig(path, { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" });

  assert.ok(config.services.length > 0);
});

test("no credential is written as a literal in a ConfigMap", async () => {
  for (const file of ["ui.yaml", "light.yaml"]) {
    for (const document of await manifests(file)) {
      if (document.kind !== "ConfigMap") continue;
      for (const value of Object.values(document.data ?? {})) {
        // A ConfigMap is readable by anything that can read the namespace, so a
        // credential in one belongs in the Secret as a `${VAR}` reference.
        assert.doesNotMatch(value, /botToken:\s*"(?!\$\{)/, `${file} carries a literal token`);
      }
    }
  }
});

test("the chart declares itself, and its appVersion is the floating tag the images publish", async () => {
  const chart = parse(await read("deploy/helm/isitdown/Chart.yaml")) as Record<string, unknown>;

  assert.equal(chart["apiVersion"], "v2");
  assert.equal(chart["name"], "isitdown");
  assert.match(String(chart["version"]), /^\d+\.\d+\.\d+$/);
  // The templates build `<edition>-<appVersion>` when `image.tag` is empty, and
  // the published images are `ui-latest` / `light-latest`.
  assert.equal(chart["appVersion"], "latest");
});

test("the chart's values cover every value its templates read", async () => {
  const values = parse(await read("deploy/helm/isitdown/values.yaml")) as Record<string, unknown>;
  const dir = new URL("deploy/helm/isitdown/templates/", root);
  const files = await readdir(dir);

  const at = (path: string[]): unknown =>
    path.reduce<unknown>(
      (node, key) => (node !== null && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined),
      values,
    );

  for (const file of files) {
    const source = await readFile(new URL(file, dir), "utf8");
    for (const [, path] of source.matchAll(/\.Values\.([A-Za-z0-9_.]+)/g)) {
      const keys = path.replace(/\.$/, "").split(".");
      assert.notEqual(
        at(keys),
        undefined,
        `${file} reads .Values.${path}, which values.yaml does not declare`,
      );
    }
  }
});

test("the chart's default config.yml is one the Light edition's own loader accepts", async () => {
  const values = parse(await read("deploy/helm/isitdown/values.yaml")) as { config: string };

  const dir = await mkdtemp(join(tmpdir(), "isitdown-helm-"));
  const path = join(dir, "config.yml");
  await writeFile(path, values.config);
  const config = await loadConfig(path, { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" });

  assert.ok(config.services.length > 0);
});

test("the chart never renders two of anything that writes the same volume", async () => {
  const deployment = await read("deploy/helm/isitdown/templates/deployment.yaml");
  const values = parse(await read("deploy/helm/isitdown/values.yaml")) as { replicaCount: number };

  assert.equal(values.replicaCount, 1);
  assert.match(deployment, /type: Recreate/);
});
