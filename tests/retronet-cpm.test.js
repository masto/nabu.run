// @vitest-environment node

// Cloud CP/M's drive commands (RetroNET 0xED) through the protocol
// machine, as the Internet Adapter behaves (see docs/cloud-cpm-protocol.md).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startAdaptor, withIndexes } from './fake-nabu';
import { MemoryStorage } from '../src/machines/adaptor/storage';
import * as NABU from '../src/machines/adaptor/constants';

const channel = { baseUrl: 'https://example.test/', imageDir: 'cloud-cpm', imageName: null };
const STORE = 'https://example.test/cloud-cpm';

const u16 = v => [v & 0xff, v >> 8 & 0xff];
const u32 = v => [v & 0xff, v >> 8 & 0xff, v >> 16 & 0xff, v >>> 24];
const text = s => new TextEncoder().encode(s);
const asText = b => new TextDecoder().decode(Uint8Array.from(b));

// CP/M's 11-character form of a name.
const cpm = name => {
  const [base, ext = ''] = name.split('.');
  return [...text(base.padEnd(8) + ext.padEnd(3))];
};

// 300 bytes: two full records and part of a third.
const long = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff);

const files = withIndexes({
  'CPM/A/0/STAT.COM': long,
  'CPM/A/0/robots.x': text('robots'),
  'CPM/A/0/XDIR.Com': text('xdir'),
  'CPM/A/0/long-name.text': text('invisible'),
  'CPM/A/B/ELEVEN.TXT': text('user 11'),
  'CPM/A/0/BIG.DAT': new Uint8Array(200 * 128),
});

let nabu, storage;

const send = (sub, ...fields) => nabu.send([NABU.MSG_RN_CPM, sub, ...fields.flat()]);
const take = n => nabu.take(n);

const open = async (name, drive = 0, user = 0) => {
  send(NABU.RN_CPM_OPEN, drive, user, cpm(name));
  return take(2);
};
const create = async (name, drive = 0, user = 0) => {
  send(NABU.RN_CPM_CREATE, drive, user, cpm(name));
  return (await take(1))[0];
};
const read = async (fh, record) => {
  send(NABU.RN_CPM_READ, fh, u16(record));
  const [status] = await take(1);
  return status ? status : take(128);
};
const write = (fh, record, data) =>
  send(NABU.RN_CPM_WRITE, fh, u16(record), [...data, ...new Array(128 - data.length).fill(0)]);
const sizeOf = async (name, drive = 0, user = 0) => {
  send(NABU.RN_CPM_SIZE, drive, user, cpm(name));
  const [lo, hi] = await take(2);
  return lo | hi << 8;
};

// Everything a search finds, as [name, records].
const search = async (pattern, drive = 0, user = 0) => {
  send(NABU.RN_CPM_SEARCH_FIRST, drive, user, cpm(pattern));
  const found = [];
  for (;;) {
    const [status] = await take(1);
    if (status) return found;
    const sector = await take(128);
    found.push([asText(sector.slice(1, 12)), sector[15]]);
    send(NABU.RN_CPM_SEARCH_NEXT);
  }
};

const fileText = async path => {
  const { file } = await storage.openFile(`${STORE}/${path}`);
  return asText(file.read(0, file.size));
};

beforeEach(() => {
  storage = new MemoryStorage();
  nabu = startAdaptor(files, channel, { storage });
});

afterEach(() => vi.unstubAllGlobals());

describe('searching', () => {
  it('finds files as CP/M names, with their size in records', async () => {
    expect(await search('????????.???')).toEqual([
      ['BIG     DAT', 0x80],
      ['ROBOTS  X  ', 1],
      ['STAT    COM', 3],
      ['XDIR    COM', 1],
    ]);
  });

  it('matches ? wildcards', async () => {
    expect((await search('????????.COM')).map(f => f[0])).toEqual(['STAT    COM', 'XDIR    COM']);
    expect((await search('ROBOTS.X')).map(f => f[0])).toEqual(['ROBOTS  X  ']);
    expect(await search('NOPE.COM')).toEqual([]);
  });

  it('replies with a directory entry and unused ones', async () => {
    send(NABU.RN_CPM_SEARCH_FIRST, 0, 0, cpm('STAT.COM'));
    expect(await take(1)).toEqual([0]);
    const sector = await take(128);
    expect(sector.slice(0, 32)).toEqual([0, ...cpm('STAT.COM'), 0, 0, 0, 3, ...new Array(16).fill(0)]);
    expect(sector.slice(32)).toEqual(new Array(96).fill(0xe5));
  });

  it('looks in the drive and user area asked for', async () => {
    expect(await search('????????.???', 0, 11)).toEqual([['ELEVEN  TXT', 1]]);
    expect(await search('????????.???', 1, 0)).toEqual([]);
  });

  it('ignores attribute bits in the name', async () => {
    send(NABU.RN_CPM_SEARCH_FIRST, 0, 0, cpm('STAT.COM').map((c, i) => i === 8 ? c | 0x80 : c));
    expect(await take(1)).toEqual([0]);
    await take(128);
  });
});

describe('reading', () => {
  it('opens files, replying with a handle and the size in records', async () => {
    expect(await open('STAT.COM')).toEqual([1, 3]);
    expect(await open('robots.x')).toEqual([2, 1]);
    expect(await open('BIG.DAT')).toEqual([3, 0x80]);
    expect(await open('NOPE.COM')).toEqual([0xff, 0]);
  });

  it('reads records, padding the last one', async () => {
    const [fh] = await open('STAT.COM');
    expect(await read(fh, 1)).toEqual([...long.slice(128, 256)]);
    expect(await read(fh, 2)).toEqual([...long.slice(256), ...new Array(84).fill(0x1a)]);
    expect(await read(fh, 3)).toBe(1);
  });

  it('reads bulk data', async () => {
    const [fh] = await open('STAT.COM');
    send(NABU.RN_CPM_READ_BULK, fh, u32(100), u16(1000));
    const [lo, hi] = await take(2);
    expect(lo | hi << 8).toBe(200);
    expect(await take(200)).toEqual([...long.slice(100)]);
  });

  it('gives the size in records', async () => {
    expect(await sizeOf('BIG.DAT')).toBe(200);
    expect(await sizeOf('STAT.COM')).toBe(3);
    expect(await sizeOf('NOPE.COM')).toBe(0);
  });

  it('closes files, and forgets them all on reset', async () => {
    expect((await open('STAT.COM'))[0]).toBe(1);
    expect((await open('STAT.COM'))[0]).toBe(2);
    send(NABU.RN_CPM_CLOSE, 1);
    expect((await open('STAT.COM'))[0]).toBe(1);
    send(NABU.RN_CPM_RESET);
    expect((await open('STAT.COM'))[0]).toBe(1);
  });
});

describe('writing', () => {
  it('creates, writes and closes files', async () => {
    const fh = await create('NEW.TXT', 0, 1);
    expect(fh).toBe(1);
    write(fh, 0, text('hello'));
    write(fh, 1, text('there'));
    send(NABU.RN_CPM_CLOSE, fh);
    expect(await sizeOf('NEW.TXT', 0, 1)).toBe(2);
    expect((await fileText('CPM/A/1/NEW.TXT')).replace(/\0+/g, ' ')).toBe('hello there ');
  });

  it('fills gaps with zeros', async () => {
    const fh = await create('SPARSE.DAT');
    write(fh, 2, [0x41]);
    send(NABU.RN_CPM_CLOSE, fh);
    expect(await sizeOf('SPARSE.DAT')).toBe(3);
    const [again] = await open('SPARSE.DAT');
    expect(await read(again, 0)).toEqual(new Array(128).fill(0));
  });

  it('empties an existing file when creating it, keeping its name', async () => {
    const fh = await create('ROBOTS.X');
    send(NABU.RN_CPM_CLOSE, fh);
    expect(await sizeOf('ROBOTS.X')).toBe(0);
    expect(await fileText('CPM/A/0/robots.x')).toBe('');
  });

  it('renames', async () => {
    send(NABU.RN_CPM_RENAME, 0, 0, cpm('XDIR.COM'), cpm('LS.COM'));
    expect((await search('????????.COM')).map(f => f[0])).toEqual(['LS      COM', 'STAT    COM']);
  });

  it('deletes, with wildcards', async () => {
    send(NABU.RN_CPM_DELETE, 0, 0, cpm('????????.COM'));
    expect((await search('????????.???')).map(f => f[0])).toEqual(['BIG     DAT', 'ROBOTS  X  ']);
    // Nothing to delete is fine.
    send(NABU.RN_CPM_DELETE, 0, 0, cpm('NOPE.COM'));
    expect(await sizeOf('BIG.DAT')).toBe(200);
  });
});
