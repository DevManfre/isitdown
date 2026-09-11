const PORT = process.env["PORT"] ?? "3000";

/**
 * Container health: readiness, not liveness (roadmap 6.9). `/health` answers as
 * long as the process is up, which left an instance whose poll cycle had been
 * failing all day reporting healthy; `/ready` answers 503 once the last cycle
 * is more than three intervals old or every provider failed in it. Liveness is
 * still there for an orchestrator that wants the two probes apart.
 */
try {
  const response = await fetch(`http://127.0.0.1:${PORT}/ready`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) {
    // The reason travels with the answer, so `docker inspect`'s health log says
    // which of the three failures this was rather than just a status code.
    const reason = ((await response.json().catch(() => ({}))) as { reason?: string }).reason;
    process.stderr.write(
      `unhealthy: /ready returned HTTP ${response.status}${reason === undefined ? "" : ` (${reason})`}\n`,
    );
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  process.stderr.write(`unhealthy: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
