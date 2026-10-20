/**
 * The address the dashboard listens on. Loopback unless the operator says
 * otherwise: the API token policy (apiToken.ts) leaves every route open when no
 * token is set, which is only safe for an instance only the host can reach.
 * Containers set `BIND_HOST=0.0.0.0` (the published port arrives on the
 * container's own interface); exposure there is decided by the compose `ports`
 * mapping. Named `BIND_HOST`, not `HOST`, because shells commonly set `HOST`
 * and it would silently widen the bind.
 */
export function readBindHost(env: NodeJS.ProcessEnv): string {
  const value = env["BIND_HOST"]?.trim();
  return value === undefined || value === "" ? "127.0.0.1" : value;
}
