import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** Local stand-in for a provider. Never a live endpoint. */
export async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (baseUrl: string, server: Server) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`, server);
  } finally {
    // A test that deliberately leaves a request unanswered still holds a live
    // socket; without this, `close` waits for it forever and hangs the run.
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * A base url nothing is listening on: the server is opened only to claim a free
 * port, then closed before the url is handed over. Lets a test exercise the
 * connection-refused path without guessing at a port.
 */
export async function withDeadServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  let baseUrl = "";
  await withServer(
    () => {
      /* never reached: the server is closed before `run` uses the url */
    },
    async (url) => {
      baseUrl = url;
    },
  );
  await run(baseUrl);
}
