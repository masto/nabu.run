// @vitest-environment node

// RetroNET file store and devices through the protocol machine, as the
// Internet Adapter behaves (see docs/cloud-cpm-protocol.md).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startAdaptor, withIndexes } from './fake-nabu';
import { MemoryStorage } from '../src/machines/adaptor/storage';
import * as NABU from '../src/machines/adaptor/constants';

const channel = { baseUrl: 'https://example.test/', imageDir: 'store', imageName: null };
const STORE = 'https://example.test/store';

const u16 = v => [v & 0xff, v >> 8 & 0xff];
const u32 = v => [v & 0xff, v >> 8 & 0xff, v >> 16 & 0xff, v >>> 24];
const str = s => [s.length, ...new TextEncoder().encode(s)];
const text = s => new TextEncoder().encode(s);
const asText = b => new TextDecoder().decode(Uint8Array.from(b));

let nabu, storage;

const send = (...fields) => nabu.send(fields.flat());
const takeU16 = async () => { const [lo, hi] = await nabu.take(2); return lo | hi << 8; };
const takeI32 = async () => new DataView(Uint8Array.from(await nabu.take(4)).buffer).getInt32(0, true);
const takeData = async () => nabu.take(await takeU16());

const open = async (name, flag = 0, fh = 0xff) => {
  send(NABU.MSG_RN_FILE_OPEN, str(name), u16(flag), fh);
  return (await nabu.take(1))[0];
};
const size = async name => {
  send(NABU.MSG_RN_FILE_SIZE, str(name));
  return takeI32();
};
const read = async (fh, offset, length) => {
  send(NABU.MSG_RN_FH_READ, fh, u32(offset), u16(length));
  return asText(await takeData());
};
const whole = async name => {
  const fh = await open(name);
  const data = await read(fh, 0, 1000);
  send(NABU.MSG_RN_FH_CLOSE, fh);
  return data;
};

// Details: size, then the name.
const takeDetails = async () => {
  const d = Uint8Array.from(await nabu.take(83));
  const view = new DataView(d.buffer);
  return {
    size: view.getInt32(0, true),
    name: asText(d.subarray(19, 19 + d[18])),
  };
};

const files = withIndexes({
  'HELLO.TXT': text('Hello, NABU!'),
  'LINES.TXT': text('one\r\ntwo\nthree'),
  'test/directory/testing.txt': text('testing'),
});

beforeEach(() => {
  storage = new MemoryStorage();
  nabu = startAdaptor(files, channel, { storage });
});

afterEach(() => vi.unstubAllGlobals());

describe('opening files', () => {
  it('opens files in the store, assigning handles', async () => {
    expect(await open('HELLO.TXT')).toBe(0);
    expect(await open('hello.txt')).toBe(1);
    expect(await read(0, 7, 100)).toBe('NABU!');
  });

  it('uses the handle asked for, if it is free', async () => {
    expect(await open('HELLO.TXT', 0, 5)).toBe(5);
    expect(await open('HELLO.TXT', 0, 5)).toBe(0);
  });

  it('fails a read-only open of a missing file', async () => {
    expect(await open('NOPE')).toBe(0xff);
    expect(await size('NOPE')).toBe(-1);
  });

  it('creates a missing file opened for writing', async () => {
    expect(await open('NEW.TXT', NABU.RN_OPEN_READWRITE)).toBe(0);
    expect(await size('NEW.TXT')).toBe(0);
  });

  it('understands drive letters, backslashes and subdirectories', async () => {
    expect(await size('z:\\test\\directory\\testing.txt')).toBe(7);
    expect(await whole('test/directory/TESTING.TXT')).toBe('testing');
  });

  it('keeps names inside the store', async () => {
    const fh = await open('..\\..\\escape.txt', NABU.RN_OPEN_READWRITE);
    send(NABU.MSG_RN_FH_APPEND, fh, u16(1), [0x41]);
    send(NABU.MSG_RN_FH_CLOSE, fh);
    expect(await size('escape.txt')).toBe(1);
    expect((await storage.openFile(`${STORE}/escape.txt`)).file.size).toBe(1);
  });

  it('reads web files through the proxy', async () => {
    nabu = startAdaptor({}, channel, { storage, rnProxyUrl: 'https://proxy.test/?' });
    // Instead of startAdaptor's fetch, which serves only the channel.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => text('from the web').buffer,
    })));
    expect(await size('https://cloud.test/dir/file.txt')).toBe(12);
    expect(fetch).toHaveBeenCalledWith('https://proxy.test/?https://cloud.test/%2Fdir%2Ffile.txt');
    const fh = await open('https://cloud.test/dir/file.txt');
    expect(await read(fh, 5, 3)).toBe('the');
    // Fetched once.
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('reading', () => {
  it('reads sequentially from where the last read ended', async () => {
    const fh = await open('HELLO.TXT');
    send(NABU.MSG_RN_FH_READSEQ, fh, u16(5));
    expect(asText(await takeData())).toBe('Hello');
    send(NABU.MSG_RN_FH_READSEQ, fh, u16(100));
    expect(asText(await takeData())).toBe(', NABU!');
    send(NABU.MSG_RN_FH_READSEQ, fh, u16(100));
    expect(await takeData()).toEqual([]);
  });

  it('seeks, clamped to the file', async () => {
    const fh = await open('HELLO.TXT');
    const seek = async (offset, whence) => {
      send(NABU.MSG_RN_FH_SEEK, fh, u32(offset >>> 0), whence);
      return takeI32();
    };
    expect(await seek(7, NABU.RN_SEEK_SET)).toBe(7);
    expect(await seek(2, NABU.RN_SEEK_CUR)).toBe(9);
    expect(await seek(-3, NABU.RN_SEEK_END)).toBe(9);
    expect(await seek(100, NABU.RN_SEEK_CUR)).toBe(12);
    expect(await seek(-100, NABU.RN_SEEK_CUR)).toBe(0);
    send(NABU.MSG_RN_FH_READSEQ, fh, u16(5));
    expect(asText(await takeData())).toBe('Hello');
  });

  it('reads by name without a handle', async () => {
    send(NABU.MSG_RN_FILE_READ, str('HELLO.TXT'), u32(7), u16(4));
    expect(asText(await takeData())).toBe('NABU');
    send(NABU.MSG_RN_FILE_READ, str('NOPE'), u32(0), u16(4));
    expect(await takeData()).toEqual([]);
  });

  it('counts and gets lines', async () => {
    const fh = await open('LINES.TXT');
    send(NABU.MSG_RN_FH_LINE_COUNT, fh);
    expect(await takeU16()).toBe(3);
    const line = async n => {
      send(NABU.MSG_RN_FH_GET_LINE, fh, u16(n));
      return asText(await takeData());
    };
    expect(await line(0)).toBe('one');
    expect(await line(1)).toBe('two');
    expect(await line(2)).toBe('three');
    expect(await line(3)).toBe('');
  });

  it('treats a handle that is not open as an empty file', async () => {
    expect(await read(9, 0, 10)).toBe('');
    send(NABU.MSG_RN_FH_SIZE, 9);
    expect(await takeI32()).toBe(-1);
  });
});

describe('writing', () => {
  const opened = () => open('HELLO.TXT', NABU.RN_OPEN_READWRITE);

  it('appends', async () => {
    const fh = await opened();
    send(NABU.MSG_RN_FH_APPEND, fh, u16(4), [...text(' Hi!')]);
    send(NABU.MSG_RN_FH_SIZE, fh);
    expect(await takeI32()).toBe(16);
    expect(await read(fh, 0, 100)).toBe('Hello, NABU! Hi!');
  });

  it('inserts, deletes ranges, and replaces', async () => {
    const fh = await opened();
    send(NABU.MSG_RN_FH_INSERT, fh, u32(5), u16(4), [...text(' you')]);
    expect(await read(fh, 0, 100)).toBe('Hello you, NABU!');
    send(NABU.MSG_RN_FH_DELETE_RANGE, fh, u32(9), u16(2));
    expect(await read(fh, 0, 100)).toBe('Hello youNABU!');
    send(NABU.MSG_RN_FH_REPLACE, fh, u32(0), u16(5), [...text('Howdy')]);
    expect(await read(fh, 0, 100)).toBe('Howdy youNABU!');
  });

  it('empties files', async () => {
    const fh = await opened();
    send(NABU.MSG_RN_FH_TRUNCATE, fh);
    expect(await read(fh, 0, 100)).toBe('');
  });

  it('replaces by name, creating the file', async () => {
    send(NABU.MSG_RN_FILE_REPLACE, str('HELLO.TXT'), u32(7), u16(4), [...text('nabu')]);
    send(NABU.MSG_RN_FILE_REPLACE, str('NEW.TXT'), u32(0), u16(3), [...text('new')]);
    expect(await whole('HELLO.TXT')).toBe('Hello, nabu!');
    expect(await whole('NEW.TXT')).toBe('new');
  });

  it('keeps changes in the storage', async () => {
    const fh = await opened();
    send(NABU.MSG_RN_FH_APPEND, fh, u16(1), [0x3f]);
    send(NABU.MSG_RN_FH_CLOSE, fh);
    expect(await size('HELLO.TXT')).toBe(13);
    const { file } = await storage.openFile(`${STORE}/HELLO.TXT`);
    expect(asText(file.read(0, 100))).toBe('Hello, NABU!?');
  });
});

describe('managing files', () => {
  it('deletes files, closing them', async () => {
    const fh = await open('HELLO.TXT');
    send(NABU.MSG_RN_FILE_DELETE, str('hello.txt'));
    expect(await size('HELLO.TXT')).toBe(-1);
    send(NABU.MSG_RN_FH_SIZE, fh);
    expect(await takeI32()).toBe(-1);
    // Deleting what isn't there is fine.
    send(NABU.MSG_RN_FILE_DELETE, str('NOPE'));
    expect(await size('LINES.TXT')).toBe(14);
  });

  it('copies, replacing only if asked', async () => {
    send(NABU.MSG_RN_FILE_COPY, str('HELLO.TXT'), str('COPY.TXT'), 0);
    expect(await whole('COPY.TXT')).toBe('Hello, NABU!');
    send(NABU.MSG_RN_FILE_COPY, str('LINES.TXT'), str('COPY.TXT'), 0);
    expect(await whole('COPY.TXT')).toBe('Hello, NABU!');
    send(NABU.MSG_RN_FILE_COPY, str('LINES.TXT'), str('COPY.TXT'), NABU.RN_COPY_REPLACE);
    expect(await whole('COPY.TXT')).toBe('one\r\ntwo\nthree');
  });

  it('moves, replacing only if asked', async () => {
    send(NABU.MSG_RN_FILE_MOVE, str('HELLO.TXT'), str('LINES.TXT'), 0);
    expect(await size('HELLO.TXT')).toBe(12);
    send(NABU.MSG_RN_FILE_MOVE, str('HELLO.TXT'), str('MOVED.TXT'), 0);
    expect(await size('HELLO.TXT')).toBe(-1);
    expect(await whole('MOVED.TXT')).toBe('Hello, NABU!');
  });

  it('lists directories with wildcards', async () => {
    const list = async (path, pattern, flags) => {
      send(NABU.MSG_RN_FILE_LIST, str(path), str(pattern), flags);
      const count = await takeU16();
      const items = [];
      for (let i = 0; i < count; i++) {
        send(NABU.MSG_RN_FILE_LIST_ITEM, u16(i));
        items.push(await takeDetails());
      }
      return items;
    };
    const both = NABU.RN_LIST_FILES | NABU.RN_LIST_DIRECTORIES;
    expect((await list('', '*', both)).map(i => [i.name, i.size])).toEqual(
      [['HELLO.TXT', 12], ['LINES.TXT', 14], ['test', -1]]);
    expect((await list('', '*.TXT', NABU.RN_LIST_FILES)).map(i => i.name)).toEqual(['HELLO.TXT', 'LINES.TXT']);
    expect((await list('', 'h?llo.*', both)).map(i => i.name)).toEqual(['HELLO.TXT']);
    expect((await list('', '*', NABU.RN_LIST_DIRECTORIES)).map(i => i.name)).toEqual(['test']);
    expect((await list('test\\directory', '*', both)).map(i => i.name)).toEqual(['testing.txt']);
    expect(await list('nowhere', '*', both)).toEqual([]);
  });

  it('gives details by name and by handle', async () => {
    send(NABU.MSG_RN_FILE_DETAILS, str('HELLO.TXT'));
    expect(await takeDetails()).toMatchObject({ size: 12, name: 'HELLO.TXT' });
    send(NABU.MSG_RN_FILE_DETAILS, str('test'));
    expect((await takeDetails()).size).toBe(-1);
    send(NABU.MSG_RN_FILE_DETAILS, str('NOPE'));
    expect((await takeDetails()).size).toBe(-2);
    const fh = await open('z:\\test\\directory\\testing.txt');
    send(NABU.MSG_RN_FH_DETAILS, fh);
    expect(await takeDetails()).toMatchObject({ size: 7, name: 'testing.txt' });
  });
});

describe('devices', () => {
  it('prints to LST.TXT', async () => {
    for (const c of text('Hi\r\n')) send(NABU.MSG_RN_PRINTER, c);
    expect(await whole('LST.TXT')).toBe('Hi\r\n');
  });

  it('refuses TCP connections', async () => {
    send(NABU.MSG_RN_TCP_OPEN, str('example.com'), u16(23), 0xff);
    expect(await nabu.take(1)).toEqual([0xff]);
    send(NABU.MSG_RN_TCP_READ, 0, u16(10));
    expect(await takeI32()).toBe(-1);
    send(NABU.MSG_RN_TCP_WRITE, 0, u16(2), [1, 2]);
    expect(await takeI32()).toBe(-1);
  });

  it('has nothing from the TCP server', async () => {
    send(NABU.MSG_RN_SERVER_READ, 1);
    expect(await nabu.take(1)).toEqual([0]);
    send(NABU.MSG_RN_SERVER_WRITE, 1, 0x41);
    send(NABU.MSG_RN_SERVER_CLIENTS);
    expect(await nabu.take(1)).toEqual([0]);
  });

  it('takes log messages from the NABU', async () => {
    send(NABU.MSG_RN_IA_CONTROL, NABU.RN_IA_LOG, str('CCP not found'));
    expect(await size('HELLO.TXT')).toBe(12);
  });
});
