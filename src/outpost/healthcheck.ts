/** Liveness for the outpost container: its own health route answers. */
const port = Number(process.env["PORT"] ?? 8080);

try {
  const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(4_000) });
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  process.stderr.write(`unhealthy: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
