/**
 * The fleet every screenshot is taken of.
 *
 * A visual baseline is only worth having if the page it captures is identical
 * on every run, so nothing here is relative to now: absolute timestamps, a
 * fixed set of providers, a fixed incident and a fixed delivery log. The
 * scheduler is never started by the harness either, so no poll lands mid-shot
 * and no countdown ticks between two screenshots.
 *
 * The one thing that cannot be pinned is "N months ago" text: the relative
 * labels move as the wall clock does. They are pinned by the harness freezing
 * the browser's clock, not here — see visual-regression.mjs.
 */

/** The instant the fixture is written for. Everything below is relative to it. */
export const NOW = Date.parse("2026-09-01T12:00:00.000Z");

const DAY = 86_400_000;

const providers = [
  { id: "github", name: "GitHub", baseUrl: "https://www.githubstatus.com", status: "operational" },
  { id: "cloudflare", name: "Cloudflare", baseUrl: "https://www.cloudflarestatus.com", status: "degraded" },
  { id: "anthropic", name: "Anthropic", baseUrl: "https://status.anthropic.com", status: "major_outage" },
  { id: "vercel", name: "Vercel", baseUrl: "https://www.vercel-status.com", status: "operational" },
];

const iso = (offsetMs) => new Date(NOW - offsetMs).toISOString();

/**
 * Writes the fixture into an already-migrated database.
 *
 * Written with SQL rather than through the store's own API on purpose: the
 * fixture needs 90 days of samples at exact timestamps, which is a thing the
 * store deliberately cannot express — it stamps its own.
 */
export function seedVisualFixture(db) {
  db.exec("DELETE FROM services");
  db.exec("DELETE FROM provider_state");
  db.exec("DELETE FROM status_samples");
  db.exec("DELETE FROM incidents");
  db.exec("DELETE FROM notifications");

  const insertService = db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, components, scope_to_components, interval_minutes, muted_until, created_at) VALUES (?, ?, 'statuspage', ?, NULL, 1, NULL, 0, NULL, ?, ?)",
  );
  const insertState = db.prepare(
    "INSERT INTO provider_state (provider_id, overall_status, active_incidents, components, maintenances, fetched_at, failure_count, degraded_notified) VALUES (?, ?, ?, '[]', '[]', ?, 0, 0)",
  );
  const insertSample = db.prepare(
    "INSERT INTO status_samples (provider_id, observed_at, overall_status, ok, latency_ms) VALUES (?, ?, ?, ?, ?)",
  );
  const insertIncident = db.prepare(
    "INSERT INTO incidents (provider_id, incident_id, name, impact, status, started_at, updated_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertNotification = db.prepare(
    "INSERT INTO notifications (provider_id, channel, kind, text, sent_at, ok, error, attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );

  for (const provider of providers) {
    insertService.run(
      provider.id,
      provider.name,
      provider.baseUrl,
      // Cloudflare is the muted one, so the mute badge is in the baseline too.
      provider.id === "cloudflare" ? new Date(NOW + 2 * 3600_000).toISOString() : null,
      iso(120 * DAY),
    );

    const incidents =
      provider.status === "major_outage"
        ? JSON.stringify([
            {
              id: "i-visual-1",
              name: "Elevated error rates on the API",
              impact: "major",
              status: "investigating",
              updatedAt: iso(2 * 3600_000),
            },
          ])
        : "[]";
    insertState.run(provider.id, provider.status, incidents, iso(4 * 60_000));

    // Three months of daily samples: enough for every window the history view
    // offers, with one bad stretch so the bars are not a flat green wall.
    for (let day = 89; day >= 0; day -= 1) {
      const bad = provider.id === "anthropic" && day < 2;
      const wobbly = provider.id === "cloudflare" && day % 17 === 0;
      const status = bad ? "major_outage" : wobbly ? "degraded" : "operational";
      for (const hour of [2, 8, 14, 20]) {
        insertSample.run(
          provider.id,
          new Date(NOW - day * DAY + (hour - 12) * 3600_000).toISOString(),
          status,
          status === "operational" ? 1 : 0,
          220 + ((day * 7 + hour) % 90),
        );
      }
    }
  }

  insertIncident.run(
    "anthropic",
    "i-visual-1",
    "Elevated error rates on the API",
    "major",
    "investigating",
    iso(2 * 3600_000),
    iso(2 * 3600_000),
    null,
  );
  insertIncident.run(
    "cloudflare",
    "i-visual-2",
    "Increased latency in EU regions",
    "minor",
    "resolved",
    iso(9 * DAY),
    iso(9 * DAY - 3600_000),
    iso(9 * DAY - 3600_000),
  );

  const log = [
    ["anthropic", "telegram", "incident_opened", "🔴 Anthropic — major outage", iso(2 * 3600_000), 1, null, 1],
    ["cloudflare", "webhook", "status_change", "🟠 Cloudflare — degraded", iso(3 * 3600_000), 1, null, 2],
    ["github", "telegram", "incident_resolved", "🟢 GitHub — operational", iso(2 * DAY), 1, null, 1],
    [
      "anthropic",
      "discord",
      "incident_opened",
      "🔴 Anthropic — major outage",
      iso(2 * 3600_000 - 60_000),
      0,
      "HTTP 401",
      3,
    ],
  ];
  for (const row of log) insertNotification.run(...row);

  db.prepare("UPDATE settings SET value = ? WHERE key = 'mapView'").run("off");
}
