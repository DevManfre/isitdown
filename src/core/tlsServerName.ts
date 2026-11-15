import { isIP } from "node:net";

/**
 * The SNI name to send for `host`, or undefined to send none.
 *
 * RFC 6066 allows only a DNS hostname in Server Name Indication, never an IP
 * literal. Node warned about one for years (DEP0123); Node 26 throws instead,
 * so passing the host through unchecked turns a probe, a mail server or a
 * broker configured by IP into an immediate failure. A URL's hostname keeps
 * an IPv6 literal in brackets, so those count as IPs too.
 */
export function tlsServerName(host: string): string | undefined {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return isIP(bare) === 0 ? host : undefined;
}
