import { randomBytes } from "node:crypto";
import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";
import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { ChannelError, REQUEST_TIMEOUT_MS } from "./errors.ts";
import { renderParts } from "./formatting.ts";

const DEFAULT_PORT = { mqtt: 1883, mqtts: 8883 } as const;

const settingsSchema = z.object({
  /** The broker: `mqtt://broker.lan:1883`, or `mqtts://` for TLS. */
  brokerUrl: z
    .string()
    .min(1, "brokerUrl is required for the mqtt channel")
    .transform((value, context) => {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        parsed = new URL("invalid://");
      }
      const scheme = parsed.protocol.replace(/:$/, "");
      if ((scheme !== "mqtt" && scheme !== "mqtts") || parsed.hostname === "") {
        context.addIssue({ code: "custom", message: "brokerUrl must be mqtt:// or mqtts://host[:port] for the mqtt channel" });
        return z.NEVER;
      }
      return {
        tls: scheme === "mqtts",
        host: parsed.hostname.replace(/^\[(.*)\]$/, "$1"),
        port: parsed.port === "" ? DEFAULT_PORT[scheme] : Number(parsed.port),
      };
    }),
  /** The topic prefix; empty means `isitdown`. Messages go to `<prefix>/<provider>`. */
  topic: z
    .string()
    .default("")
    .refine((value) => !/[+#]/.test(value), { message: "topic may not contain + or # for the mqtt channel" }),
  /** Only for a broker with authentication; both or neither. */
  username: z.string().default(""),
  password: z.string().default(""),
});

/**
 * MQTT — roadmap 3.9. For home automation that is not Home Assistant: Node-RED,
 * openHAB, a microcontroller with a status light. One JSON message per change on
 * `<prefix>/<provider>`, digests on `<prefix>/digest`.
 *
 * A change about the provider's own state — its status, an incident — is
 * published *retained*, so a subscriber that connects later still learns where
 * each provider stands; everything else (a component, a maintenance notice,
 * our own monitoring) is an event and is not, or it would overwrite that state.
 *
 * MQTT 3.1.1 spoken directly over a socket rather than through a client
 * library: a connection per message, one QoS 1 publish, wait for the broker's
 * PUBACK, disconnect. That is four packet types, and it keeps the Light image
 * and the single binary free of a dependency for one channel.
 */
export function createMqttNotifier(settings: Record<string, string>): Notifier {
  const { brokerUrl, topic, username, password } = settingsSchema.parse(settings);
  const prefix = (topic === "" ? "isitdown" : topic).replace(/\/+$/, "");

  return {
    id: "mqtt",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);
      const { change } = payload;
      const digest = payload.digest !== undefined;
      const message = {
        provider: payload.service.id,
        providerName: payload.service.name,
        kind: digest ? "digest" : change.kind,
        status: change.currentStatus,
        previous: change.previousStatus ?? null,
        heading,
        detail,
        url,
        at: change.at,
      };
      try {
        await publish(brokerUrl, { username, password }, {
          topic: digest ? `${prefix}/digest` : `${prefix}/${payload.service.id}`,
          payload: Buffer.from(JSON.stringify(message), "utf8"),
          retain: !digest && RETAINED.has(change.kind),
        });
      } catch (error) {
        throw new ChannelError("mqtt", `mqtt notification failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

/** The kinds that say where the provider as a whole stands, and so are retained. */
const RETAINED = new Set(["status_change", "incident_opened", "incident_updated", "incident_resolved"]);

/** CONNACK's refusals, in the words of the MQTT 3.1.1 specification. */
const CONNACK_REFUSAL: Record<number, string> = {
  1: "unacceptable protocol version",
  2: "client identifier rejected",
  3: "server unavailable",
  4: "bad user name or password",
  5: "not authorized",
};

const PACKET = { connect: 0x10, connack: 0x20, publish: 0x30, puback: 0x40, disconnect: 0xe0 } as const;

const PACKET_ID = 1;

interface Broker {
  tls: boolean;
  host: string;
  port: number;
}

/** Connects, publishes once at QoS 1, waits for the PUBACK, disconnects. */
function publish(
  broker: Broker,
  credentials: { username: string; password: string },
  message: { topic: string; payload: Buffer; retain: boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = broker.tls
      ? connectTls({ host: broker.host, port: broker.port, servername: broker.host })
      : connectTcp({ host: broker.host, port: broker.port });
    let buffered = Buffer.alloc(0);
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (error === undefined) {
        socket.end(packet(PACKET.disconnect, Buffer.alloc(0)));
        resolve();
      } else {
        socket.destroy();
        reject(error);
      }
    };

    socket.setTimeout(REQUEST_TIMEOUT_MS);
    socket.once("timeout", () => finish(new Error(`${broker.host}:${broker.port} did not answer in ${REQUEST_TIMEOUT_MS}ms`)));
    socket.once("error", (error) => finish(error));
    socket.once("close", () => finish(new Error("the broker closed the connection")));
    socket.once(broker.tls ? "secureConnect" : "connect", () => socket.write(connectPacket(credentials)));

    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      for (;;) {
        const read = readPacket(buffered);
        if (read === undefined) return;
        buffered = buffered.subarray(read.length);
        if (read.type === PACKET.connack) {
          const code = read.body[1] ?? 255;
          if (code !== 0) return finish(new Error(`the broker refused the connection: ${CONNACK_REFUSAL[code] ?? `code ${code}`}`));
          socket.write(publishPacket(message));
        } else if (read.type === PACKET.puback && read.body.length >= 2 && read.body.readUInt16BE(0) === PACKET_ID) {
          return finish();
        }
      }
    });
  });
}

function connectPacket(credentials: { username: string; password: string }): Buffer {
  const withUser = credentials.username !== "";
  const withPassword = withUser && credentials.password !== "";
  // Clean session, plus the two credential flags when set.
  const flags = 0x02 | (withUser ? 0x80 : 0) | (withPassword ? 0x40 : 0);
  const keepAliveSeconds = 30;
  return packet(
    PACKET.connect,
    Buffer.concat([
      string("MQTT"),
      Buffer.from([4, flags, keepAliveSeconds >> 8, keepAliveSeconds & 0xff]),
      string(`isitdown-${randomBytes(6).toString("hex")}`),
      ...(withUser ? [string(credentials.username)] : []),
      ...(withPassword ? [string(credentials.password)] : []),
    ]),
  );
}

function publishPacket(message: { topic: string; payload: Buffer; retain: boolean }): Buffer {
  // QoS 1 in bits 1–2, retain in bit 0.
  const flags = (1 << 1) | (message.retain ? 1 : 0);
  return packet(
    PACKET.publish | flags,
    Buffer.concat([string(message.topic), Buffer.from([PACKET_ID >> 8, PACKET_ID & 0xff]), message.payload]),
  );
}

/** A UTF-8 string as MQTT frames one: two bytes of length, then the bytes. */
function string(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([Buffer.from([bytes.length >> 8, bytes.length & 0xff]), bytes]);
}

/** A fixed header — type and flags, then the remaining length as a varint — and the body. */
function packet(typeAndFlags: number, body: Buffer): Buffer {
  const length: number[] = [];
  let remaining = body.length;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    length.push(byte);
  } while (remaining > 0);
  return Buffer.concat([Buffer.from([typeAndFlags, ...length]), body]);
}

/** One whole packet off the front of the buffer, or nothing until it has arrived. */
function readPacket(buffer: Buffer): { type: number; body: Buffer; length: number } | undefined {
  if (buffer.length < 2) return undefined;
  let remaining = 0;
  let multiplier = 1;
  let offset = 1;
  for (;;) {
    const byte = buffer[offset];
    if (byte === undefined) return undefined;
    remaining += (byte & 0x7f) * multiplier;
    multiplier *= 128;
    offset += 1;
    if ((byte & 0x80) === 0) break;
  }
  if (buffer.length < offset + remaining) return undefined;
  return {
    type: (buffer[0] ?? 0) & 0xf0,
    body: buffer.subarray(offset, offset + remaining),
    length: offset + remaining,
  };
}
