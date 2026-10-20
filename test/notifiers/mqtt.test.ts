import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { once } from "node:events";
import { createMqttNotifier } from "../../src/notifiers/mqtt.notifier.ts";
import { ChannelError } from "../../src/notifiers/errors.ts";
import { ALL_KINDS, flood, opened, payloadFor, resolved } from "./contract/fixtures.ts";

/**
 * MQTT (roadmap 3.9) against a broker on the loopback that speaks just enough
 * of MQTT 3.1.1 to answer: CONNACK to a CONNECT, PUBACK to a QoS 1 PUBLISH.
 * It records what it was sent, so the packets themselves are under test — the
 * notifier has no client library to trust instead.
 */

interface Published {
  topic: string;
  retain: boolean;
  qos: number;
  payload: Record<string, unknown>;
}

interface Connected {
  clientId: string;
  username?: string;
  password?: string;
}

function readString(buffer: Buffer, offset: number): [string, number] {
  const length = buffer.readUInt16BE(offset);
  return [buffer.subarray(offset + 2, offset + 2 + length).toString("utf8"), offset + 2 + length];
}

/** Splits a byte stream into packets: type byte, varint length, body. */
function packets(buffer: Buffer): { first: number; body: Buffer }[] {
  const out: { first: number; body: Buffer }[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const first = buffer[offset] as number;
    let length = 0;
    let multiplier = 1;
    let cursor = offset + 1;
    for (;;) {
      const byte = buffer[cursor] as number;
      length += (byte & 0x7f) * multiplier;
      multiplier *= 128;
      cursor += 1;
      if ((byte & 0x80) === 0) break;
    }
    out.push({ first, body: buffer.subarray(cursor, cursor + length) });
    offset = cursor + length;
  }
  return out;
}

async function broker(options: { connack?: number; puback?: boolean } = {}) {
  const published: Published[] = [];
  const connected: Connected[] = [];
  let disconnects = 0;
  const sockets = new Set<Socket>();
  const server = createServer((socket: Socket) => {
    sockets.add(socket);
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const all = packets(buffered);
      buffered = Buffer.alloc(0);
      for (const { first, body } of all) {
        const type = first & 0xf0;
        if (type === 0x10) {
          let [, cursor] = readString(body, 0); // "MQTT"
          const flags = body[cursor + 1] as number;
          cursor += 4;
          const [clientId, afterId] = readString(body, cursor);
          cursor = afterId;
          const entry: Connected = { clientId };
          if (flags & 0x80) [entry.username, cursor] = readString(body, cursor);
          if (flags & 0x40) [entry.password, cursor] = readString(body, cursor);
          connected.push(entry);
          socket.write(Buffer.from([0x20, 0x02, 0x00, options.connack ?? 0]));
        } else if (type === 0x30) {
          const [topic, cursor] = readString(body, 0);
          const id = body.readUInt16BE(cursor);
          published.push({
            topic,
            retain: (first & 0x01) === 1,
            qos: (first >> 1) & 0x03,
            payload: JSON.parse(body.subarray(cursor + 2).toString("utf8")) as Record<string, unknown>,
          });
          if (options.puback !== false) socket.write(Buffer.from([0x40, 0x02, id >> 8, id & 0xff]));
        } else if (type === 0xe0) {
          disconnects += 1;
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `mqtt://127.0.0.1:${(server.address() as AddressInfo).port}`,
    published,
    connected,
    disconnects: () => disconnects,
    /** Drops every open connection, the way a broker that dies mid-publish would. */
    hangUp: () => {
      for (const socket of sockets) socket.destroy();
    },
    close: () => server.close(),
  };
}

test("mqtt: a provider's state is published retained at QoS 1 under the prefix", async () => {
  const fake = await broker();
  try {
    await createMqttNotifier({ brokerUrl: fake.url }).send(opened);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(fake.disconnects(), 1, "the connection is closed with a DISCONNECT");
    const [message] = fake.published;
    assert.equal(message?.topic, "isitdown/github");
    assert.equal(message?.qos, 1);
    assert.equal(message?.retain, true);
    assert.equal(message?.payload.status, "major_outage");
    assert.equal(message?.payload.kind, "incident_opened");
    assert.match(String(message?.payload.detail), /API requests failing/);
    assert.match(fake.connected[0]?.clientId ?? "", /^isitdown-[0-9a-f]{12}$/);
  } finally {
    fake.close();
  }
});

test("mqtt: an event that is not the provider's state is not retained, and a digest has its own topic", async () => {
  const fake = await broker();
  try {
    const notifier = createMqttNotifier({ brokerUrl: fake.url, topic: "home/status/" });
    await notifier.send(payloadFor("maintenance_upcoming"));
    await notifier.send(resolved);
    await notifier.send(flood);
    assert.deepEqual(
      fake.published.map(({ topic, retain }) => [topic, retain]),
      [
        ["home/status/github", false],
        ["home/status/github", true],
        ["home/status/digest", false],
      ],
    );
    assert.equal(fake.published[2]?.payload.kind, "digest");
  } finally {
    fake.close();
  }
});

test("mqtt: every kind of change is delivered, each on a connection of its own", async () => {
  const fake = await broker();
  try {
    const notifier = createMqttNotifier({ brokerUrl: fake.url });
    for (const kind of ALL_KINDS) await notifier.send(payloadFor(kind));
    assert.equal(fake.published.length, ALL_KINDS.length);
    assert.equal(fake.connected.length, ALL_KINDS.length);
  } finally {
    fake.close();
  }
});

test("mqtt: credentials go in the CONNECT packet when set", async () => {
  const fake = await broker();
  try {
    await createMqttNotifier({ brokerUrl: fake.url, username: "isitdown", password: "s3cret" }).send(opened);
    assert.equal(fake.connected[0]?.username, "isitdown");
    assert.equal(fake.connected[0]?.password, "s3cret");
  } finally {
    fake.close();
  }
});

test("mqtt: a refused connection is a ChannelError in the specification's words, without the password", async () => {
  const fake = await broker({ connack: 4 });
  try {
    await assert.rejects(
      createMqttNotifier({ brokerUrl: fake.url, username: "u", password: "s3cret" }).send(opened),
      (error: unknown) => {
        assert.ok(error instanceof ChannelError);
        assert.equal(error.channel, "mqtt");
        assert.equal(error.message, "mqtt notification failed: the broker refused the connection: bad user name or password");
        assert.ok(!error.message.includes("s3cret"));
        return true;
      },
    );
  } finally {
    fake.close();
  }
});

test("mqtt: a broker that closes before acknowledging is a failure, not a delivery", async () => {
  const fake = await broker({ puback: false });
  try {
    const sending = createMqttNotifier({ brokerUrl: fake.url }).send(opened);
    // Wait for the publish to arrive, then hang up without a PUBACK.
    while (fake.published.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    fake.hangUp();
    await assert.rejects(sending, /mqtt notification failed: the broker closed the connection/);
  } finally {
    fake.close();
  }
});

test("mqtt: a broker URL that is not mqtt or mqtts, or a wildcard in the topic, is refused", () => {
  assert.throws(() => createMqttNotifier({ brokerUrl: "http://broker" }), /brokerUrl must be mqtt:\/\/ or mqtts:\/\//);
  assert.throws(() => createMqttNotifier({ brokerUrl: "broker" }), /brokerUrl must be mqtt:\/\//);
  assert.throws(() => createMqttNotifier({ brokerUrl: "mqtt://b", topic: "a/#" }), /topic may not contain \+ or #/);
  assert.throws(() => createMqttNotifier({ brokerUrl: "" }), /brokerUrl is required for the mqtt channel/);
  assert.doesNotThrow(() => createMqttNotifier({ brokerUrl: "mqtts://[::1]" }));
});
