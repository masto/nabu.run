// A fake NABU for driving the adaptor's protocol machine in tests.

import { vi } from 'vitest';
import { interpret } from 'robot3';

import protocolMachine from '../src/machines/adaptor/protocol';

export const concat = arrays => {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let i = 0;
  for (const a of arrays) { out.set(a, i); i += a.length; }
  return out;
};

// A port whose far end is us, playing the NABU.
export const fakeNabu = () => {
  let toAdaptor;
  const received = [];
  let notify = () => { };
  const port = {
    readable: new ReadableStream({ start: c => { toAdaptor = c; } }),
    writable: new WritableStream({
      write: chunk => {
        received.push(...new Uint8Array(chunk.buffer ?? chunk, chunk.byteOffset ?? 0, chunk.byteLength));
        notify();
      }
    }),
  };

  const take = async n => {
    const deadline = Date.now() + 2000;
    while (received.length < n) {
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${n} bytes, have [${received}]`);
      }
      await new Promise(r => { notify = r; setTimeout(r, 50); });
    }
    return received.splice(0, n);
  };

  return {
    port,
    send: bytes => toAdaptor.enqueue(new Uint8Array(bytes)),
    take,
    // Read an escaped packet up to the 0x10 0xe1 terminator.
    async takePacket() {
      const out = [];
      for (;;) {
        const [b] = await take(1);
        if (b !== 0x10) { out.push(b); continue; }
        const [next] = await take(1);
        if (next === 0x10) out.push(0x10);
        else if (next === 0xe1) return new Uint8Array(out);
        else throw new Error(`bad escape 0x10 0x${next.toString(16)}`);
      }
    },
  };
};

export const pakChannel = { baseUrl: 'https://example.test/', imageDir: 'cycle', imageName: null };

export const startAdaptor = (files, channel = pakChannel) => {
  // Files are keyed by their path in the channel's directory.
  const prefix = `${channel.baseUrl}${channel.imageDir}/`;
  vi.stubGlobal('fetch', vi.fn(async url => {
    const data = url.startsWith(prefix) && files[url.slice(prefix.length)];
    if (!data) return { ok: false, status: 404 };
    return {
      ok: true,
      arrayBuffer: async () =>
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    };
  }));
  const nabu = fakeNabu();
  interpret(protocolMachine, () => { }, {
    port: nabu.port,
    portInfo: 'test',
    getChannel: () => channel,
  });
  return nabu;
};
