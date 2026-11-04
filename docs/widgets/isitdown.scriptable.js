// IsItDown — iOS home-screen widget for Scriptable (https://scriptable.app).
// Reads GET /widget (roadmap 4.30). Zero code in the app: copy this file into
// Scriptable, set BASE_URL, add a Scriptable widget and pick this script.
//
// The phone has to reach the instance: same Wi-Fi, a VPN, or a tailnet name.

const BASE_URL = "http://isitdown.local:3000"; // no trailing slash

const LOOK = {
  operational: { colour: "#34d399", label: "All systems operational" },
  degraded: { colour: "#fbbf24", label: "Degraded" },
  partial_outage: { colour: "#fb923c", label: "Partial outage" },
  major_outage: { colour: "#f87171", label: "Major outage" },
  unknown: { colour: "#94a3b8", label: "No data yet" },
};

async function load() {
  try {
    const request = new Request(`${BASE_URL}/widget`);
    request.timeoutInterval = 10;
    return await request.loadJSON();
  } catch {
    return null;
  }
}

function build(data) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#0f172a");
  widget.url = BASE_URL;
  widget.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);

  const title = widget.addText("IsItDown");
  title.font = Font.semiboldSystemFont(12);
  title.textColor = new Color("#94a3b8");
  widget.addSpacer(6);

  if (data === null) {
    const line = widget.addText("Unreachable");
    line.font = Font.boldSystemFont(18);
    line.textColor = new Color(LOOK.major_outage.colour);
    const hint = widget.addText(BASE_URL);
    hint.font = Font.systemFont(10);
    hint.textColor = new Color("#94a3b8");
    return widget;
  }

  const look = LOOK[data.status] ?? LOOK.unknown;
  const headline = widget.addText(look.label);
  headline.font = Font.boldSystemFont(18);
  headline.textColor = new Color(look.colour);
  widget.addSpacer(4);

  const counts = widget.addText(
    `${data.operational}/${data.providers} up · ${data.down} down · ${data.degraded} degraded`,
  );
  counts.font = Font.systemFont(12);
  counts.textColor = Color.white();

  if (data.incidents > 0) {
    const incidents = widget.addText(`${data.incidents} active incident${data.incidents === 1 ? "" : "s"}`);
    incidents.font = Font.systemFont(12);
    incidents.textColor = Color.white();
  }

  widget.addSpacer();
  const polled = widget.addText(
    data.lastPollAt ? `Polled ${new Date(data.lastPollAt).toLocaleTimeString()}` : "Not polled yet",
  );
  polled.font = Font.systemFont(10);
  polled.textColor = new Color("#94a3b8");
  return widget;
}

const widget = build(await load());
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentSmall();
Script.complete();
