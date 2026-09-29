/**
 * A hand-rolled server-sent-events reader, in place of the `eventsource`
 * package: the CLI's whole pitch (roadmap 17.7) is running with the same
 * zero extra runtime dependencies as the rest of the project, and parsing
 * `event: <type>\ndata: <json>\n\n` frames off a `fetch` response body is a
 * dozen lines, not a library. `test/ui/api.events.test.ts` parses the same
 * shape the same way, on the server side of this exact stream.
 */

export interface SseFrame {
  type: string;
  data: string;
}

/**
 * Reads frames off `response` until the stream ends or `signal` aborts.
 * Comment lines (`: heartbeat`, src/ui/routes/events.routes.ts) carry no
 * `data:` line and never match, so they are silently skipped rather than
 * delivered as empty frames.
 */
export async function readSse(
  response: Response,
  onFrame: (frame: SseFrame) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("response has no body to stream");

  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let split = buffer.indexOf("\n\n");
      while (split !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const type = /^event: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (type !== undefined && data !== undefined) onFrame({ type, data });
        split = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
