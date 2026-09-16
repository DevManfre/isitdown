import { Router } from "express";
import { listServices } from "../dbConfigSource.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import type { OverallStatus } from "../../core/types.ts";

/**
 * Home Assistant — roadmap 4.12. The same audience that runs this in a
 * homelab already has a dashboard with everything else on it, and "is GitHub
 * down" belongs on that wall next to the door sensors.
 *
 * REST rather than MQTT, deliberately. MQTT discovery is the richer
 * integration, and it would cost a broker at runtime and an MQTT client in
 * `package.json` — this project advertises three runtime dependencies and no
 * message broker, which is a promise rather than an accident. Home Assistant's
 * own `rest` integration scrapes one URL and derives as many binary sensors
 * from it as the template asks for, which is exactly this shape.
 *
 * A pure read of stored state, like the badge and the widget beside it: a Home
 * Assistant polling every thirty seconds costs a SQLite read and never touches
 * a provider.
 */

/**
 * Home Assistant's own words for a binary sensor's two states. `ON` means the
 * problem is present (`device_class: problem`), which is why an operational
 * provider is `OFF`: a wall of green "off" tiles is what a homelab dashboard
 * is meant to look like on a good day.
 */
const stateOf = (status: OverallStatus): "ON" | "OFF" => (status === "operational" ? "OFF" : "ON");

/** A provider id as a Home Assistant object id: lowercase, digits, underscores. */
const slug = (providerId: string): string =>
  providerId.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export function homeassistantRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();
  const db = runtime.db;

  /** What both routes below are built from, so the YAML cannot describe a payload this does not emit. */
  async function fleet(): Promise<{
    generatedAt: string;
    state: "ON" | "OFF";
    providers: number;
    incidents: number;
    entries: {
      key: string;
      id: string;
      name: string;
      state: "ON" | "OFF";
      status: OverallStatus;
      incidents: number;
      fetchedAt: string | null;
      statusUrl: string;
    }[];
  }> {
    const services = listServices(db).filter((service) => service.enabled);
    const entries = await Promise.all(
      services.map(async (service) => {
        const state = await runtime.store.getState(service.id);
        const status = state.last?.overallStatus ?? "unknown";
        return {
          key: slug(service.id),
          id: service.id,
          name: service.name,
          state: stateOf(status),
          status,
          incidents: state.last?.activeIncidents.length ?? 0,
          fetchedAt: state.last?.fetchedAt ?? null,
          statusUrl: service.baseUrl,
        };
      }),
    );

    return {
      generatedAt: new Date().toISOString(),
      // The fleet tile: on when anything at all is not operational, so one
      // sensor can drive an automation without listing every provider.
      state: entries.some((entry) => entry.state === "ON") ? "ON" : "OFF",
      providers: entries.length,
      incidents: entries.reduce((total, entry) => total + entry.incidents, 0),
      entries,
    };
  }

  /**
   * One flat object per provider, keyed by a Home Assistant object id.
   *
   * Keyed rather than an array because a `value_template` reads
   * `value_json.providers.github.state` — an array would make every sensor a
   * search through a list, and a provider added in the middle would silently
   * renumber the ones after it.
   */
  router.get("/homeassistant", async (_req, res) => {
    const snapshot = await fleet();
    const providers: Record<string, unknown> = {};
    for (const entry of snapshot.entries) {
      providers[entry.key] = {
        id: entry.id,
        name: entry.name,
        state: entry.state,
        status: entry.status,
        incidents: entry.incidents,
        fetchedAt: entry.fetchedAt,
        statusUrl: entry.statusUrl,
      };
    }

    res.json({
      generatedAt: snapshot.generatedAt,
      fleet: {
        state: snapshot.state,
        providers: snapshot.providers,
        incidents: snapshot.incidents,
        lastPollAt: runtime.lastCycleAt(),
      },
      providers,
    });
  });

  /**
   * The Home Assistant configuration for the fleet as it stands, ready to paste
   * into `configuration.yaml`.
   *
   * Generated rather than documented as an example because the interesting part
   * is one block per provider: writing eight of them by hand from a table is
   * exactly the kind of transcription that ends with one entity pointing at the
   * wrong key. The same reason `/config/export` writes a `config.yml` instead of
   * the manual describing one.
   */
  router.get("/homeassistant/configuration.yaml", async (req, res) => {
    const snapshot = await fleet();
    // The address Home Assistant has to reach, which is this instance as the
    // requester sees it — not localhost, which inside Home Assistant's own
    // container means Home Assistant.
    const base = `${req.protocol}://${req.get("host") ?? "isitdown:3000"}`;

    const sensors = snapshot.entries.map(
      (entry) => `      - name: "IsItDown ${entry.name}"
        unique_id: isitdown_${entry.key}
        device_class: problem
        value_template: "{{ value_json.providers.${entry.key}.state }}"
        json_attributes_path: "$.providers.${entry.key}"
        json_attributes:
          - status
          - incidents
          - fetchedAt
          - statusUrl`,
    );

    const document = `# IsItDown — Home Assistant configuration (roadmap 4.12).
# Generated ${snapshot.generatedAt} for the ${snapshot.providers} provider(s)
# this instance is watching. Paste into configuration.yaml and reload.
#
# One request feeds every sensor below: Home Assistant fetches the resource
# once per scan_interval and each template reads its own key out of it.
rest:
  - resource: "${base}/homeassistant"
    scan_interval: 60
    binary_sensor:
      - name: "IsItDown fleet"
        unique_id: isitdown_fleet
        device_class: problem
        value_template: "{{ value_json.fleet.state }}"
        json_attributes_path: "$.fleet"
        json_attributes:
          - providers
          - incidents
          - lastPollAt
${sensors.join("\n")}
`;

    res.type("text/yaml").send(document);
  });

  return router;
}
