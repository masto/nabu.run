// @vitest-environment node

// Drives the NABU protocol machine through a fake port, the way a NABU
// would, and checks the packets that come back.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { concat, startAdaptor } from './fake-nabu';

const ACK = [0x10, 0x06];

// CRC-16/CCITT-FALSE, bit by bit, deliberately independent of the crc
// package the adaptor uses.
const crc16 = bytes => {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
    crc &= 0xffff;
  }
  return crc;
};

// Build a .pak the way the NABU Network framed it: each packet is a
// little-endian length, a 16-byte header, up to 991 bytes, and a CRC.
const makePak = (imageId, data) => {
  const packets = [];
  const count = Math.ceil(data.length / 991);
  for (let segment = 0; segment < count; segment++) {
    const offset = segment * 991;
    const payload = data.subarray(offset, offset + 991);
    const isLast = segment === count - 1;
    const pkt = new Uint8Array(16 + payload.length + 2);
    const dv = new DataView(pkt.buffer);
    pkt.set([imageId >> 16, imageId >> 8, imageId].map(b => b & 0xff), 0);
    dv.setUint8(3, segment);
    dv.setUint8(4, 0x01);
    dv.setUint32(5, 0x7fffffff);
    pkt.set([0x7f, 0x80], 9);
    dv.setUint8(11, (segment === 0 ? 0xa1 : 0x20) | (isLast ? 0x10 : 0));
    dv.setUint16(12, segment);
    dv.setUint16(14, offset);
    pkt.set(payload, 16);
    dv.setUint16(pkt.length - 2, crc16(pkt.subarray(0, pkt.length - 2)) ^ 0xffff);
    packets.push(new Uint8Array([pkt.length & 0xff, pkt.length >> 8]), pkt);
  }
  return concat(packets);
};

// Split a .pak back into its packets (without the length prefixes).
const pakPackets = pak => {
  const packets = [];
  for (let off = 0; off + 2 <= pak.length;) {
    const len = pak[off] | pak[off + 1] << 8;
    if (len < 18 || len > 1009 || off + 2 + len > pak.length) break;
    packets.push(pak.subarray(off + 2, off + 2 + len));
    off += 2 + len;
  }
  return packets;
};

const requestSegment = async (nabu, imageId, segment) => {
  nabu.send([0x84]);
  expect(await nabu.take(2)).toEqual(ACK);
  nabu.send([segment, imageId & 0xff, (imageId >> 8) & 0xff, (imageId >> 16) & 0xff]);
  const status = await nabu.take(2);
  if (status[1] !== 0x91) return { status };
  nabu.send(ACK);
  return { status, packet: await nabu.takePacket() };
};

afterEach(() => vi.unstubAllGlobals());

// Reassemble a raw image from the data of each segment's packet.
const requestRawImage = async (nabu, imageId) => {
  const chunks = [];
  for (let segment = 0; ; segment++) {
    const { status, packet } = await requestSegment(nabu, imageId, segment);
    expect(status).toEqual([0xe4, 0x91]);
    chunks.push(packet.subarray(16, -2));
    if (packet[11] & 0x10) return concat(chunks);
  }
};

describe('packet requests', () => {
  // Include 0x10 bytes so escaping gets exercised.
  const data = Uint8Array.from({ length: 2500 }, (_, i) => (i * 7) & 0xff);
  const pak = makePak(0x00012f, data);

  it('serves every segment of a pak exactly as framed', async () => {
    const nabu = startAdaptor({ '00012f.pak': pak });
    const expected = pakPackets(pak);
    expect(expected).toHaveLength(3);

    for (const [segment, packet] of expected.entries()) {
      const res = await requestSegment(nabu, 0x00012f, segment);
      expect(res.status).toEqual([0xe4, 0x91]);
      expect(res.packet).toEqual(packet);
    }
  });

  it('rejects time requests', async () => {
    const nabu = startAdaptor({});
    const res = await requestSegment(nabu, 0x7fffff, 0);
    expect(res.status).toEqual([0xe4, 0x90]);
  });

  it('rejects paks it cannot fetch', async () => {
    const nabu = startAdaptor({});
    const res = await requestSegment(nabu, 0x000042, 0);
    expect(res.status).toEqual([0xe4, 0x90]);
  });
});

describe('raw .nabu files', () => {
  const image = (seed, length) =>
    Uint8Array.from({ length }, (_, i) => (i * seed + 3) & 0xff);

  it('serves a file per image with imageType nabu', async () => {
    const files = {
      '000001.nabu': image(5, 300),
      '000002.nabu': image(7, 2500),
      '000004.nabu': image(11, 991),
    };
    const nabu = startAdaptor(files,
      { baseUrl: 'https://example.test/', imageDir: 'Lady Bug', imageName: null, imageType: 'nabu' });

    for (const [name, data] of Object.entries(files)) {
      expect(await requestRawImage(nabu, parseInt(name, 16))).toEqual(data);
    }
  });

  it('serves the one imageName file for any image', async () => {
    const data = image(13, 1200);
    const nabu = startAdaptor({ 'game.nabu': data },
      { baseUrl: 'https://example.test/', imageDir: 'titles', imageName: 'game.nabu' });

    expect(await requestRawImage(nabu, 0x000001)).toEqual(data);
    expect(await requestRawImage(nabu, 0x000002)).toEqual(data);
  });
});

// If NABU_CYCLES_DIR points at a directory of cycle paks (laid out as
// <cycle>/<pak id>.pak, e.g. cycle-2/000001.pak), replay real paks and
// compare the adaptor's packets byte for byte against the originals.
const cyclesDir = process.env.NABU_CYCLES_DIR;

// A sample by default; NABU_ALL_PAKS=1 replays every pak in the directory.
const realPaks = () => {
  if (!process.env.NABU_ALL_PAKS) {
    return [['cycle-1', '000001.pak'], ['cycle-2', '000001.pak'], ['cycle-2', '0001bc.pak']]
      .filter(([cycle, name]) => existsSync(resolve(cyclesDir, cycle, name)));
  }
  return readdirSync(cyclesDir).flatMap(cycle =>
    readdirSync(resolve(cyclesDir, cycle)).map(name => [cycle, name]));
};

const haveCycles = cyclesDir && existsSync(cyclesDir);

describe.skipIf(!haveCycles)('real cycle paks', () => {
  for (const [cycle, name] of haveCycles ? realPaks() : []) {
    const pakId = parseInt(name, 16);

    it(`${cycle}/${name}`, async () => {
      const pak = new Uint8Array(readFileSync(resolve(cyclesDir, cycle, name)));
      const nabu = startAdaptor({ [name]: pak });

      // A few files in the cycles aren't paks at all (e.g. 000002 is a
      // text note), and 7fffff is the time, which we don't serve.
      const expected = pakPackets(pak);
      if (!expected.length || pakId === 0x7fffff) return;
      // Header and data must match the original exactly. The CRC is
      // checked on its own: some paks (e.g. the DJ cycle's patched menu)
      // have stale stored CRCs, and the adaptor sends a correct one.
      for (const [segment, packet] of expected.entries()) {
        const res = await requestSegment(nabu, pakId, segment);
        const body = res.packet.subarray(0, -2);
        expect(body).toEqual(packet.subarray(0, -2));
        expect(res.packet[res.packet.length - 2] << 8 | res.packet[res.packet.length - 1])
          .toBe(crc16(body) ^ 0xffff);
      }
    });
  }
});
