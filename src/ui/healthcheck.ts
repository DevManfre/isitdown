const PORT = process.env["PORT"] ?? "3000";

/** Container liveness: the server answers, or the container is unhealthy. */
try {
  const response = await fetch(`http://127.0.0.1:${PORT}/health`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) {
    process.stderr.write(`unhealthy: /health returned HTTP ${response.status}\n`);
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  process.stderr.write(`unhealthy: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
