// @vitest-environment node

// NHACP requests sent through the protocol machine, checked against the
// NHACP 0.1 spec: https://github.com/NHACP-IF/NHACP-specification

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startAdaptor } from './fake-nabu';
import * as NABU from '../src/machines/adaptor/constants';

const channel = { baseUrl: 'https://example.test/', imageDir: 'cpm', imageName: null };

// Little-endian field encoders.
const u16 = v => [v & 0xff, v >> 8];
const u32 = v => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24];
const str = s => [s.length, ...new TextEncoder().encode(s)];

// Send a request and read back the response frame.
const request = async (nabu, session, type, ...fields) => {
  const body = [type, ...fields.flat()];
  nabu.send([0x8f, session, ...u16(body.length), ...body]);
  const [lo, hi] = await nabu.take(2);
  const frame = await nabu.take(lo | hi << 8);
  const view = new DataView(Uint8Array.from(frame).buffer);
  return {
    type: frame[0],
    bytes: frame.slice(1),
    u8: i => view.getUint8(1 + i),
    u16: i => view.getUint16(1 + i, true),
    u32: i => view.getUint32(1 + i, true),
  };
};

// Send a request that has no response.
const send = (nabu, session, type, ...fields) => {
  const body = [type, ...fields.flat()];
  nabu.send([0x8f, session, ...u16(body.length), ...body]);
};

const expectError = (res, code) => {
  expect(res.type).toBe(NABU.NHACP_RESPONSE_ERROR);
  expect(res.u16(0)).toBe(code);
  // Only GET-ERROR-DETAILS includes the message.
  expect(res.u8(2)).toBe(0);
};

const hello = (nabu, session = 0, version = 1, options = 0) =>
  request(nabu, session, NABU.NHACP_REQUEST_HELLO, ...new TextEncoder().encode('ACP'), u16(version), u16(options));

const open = (nabu, name, flags = 0, fd = 0xff) =>
  request(nabu, 0, NABU.NHACP_REQUEST_STORAGE_OPEN, fd, u16(flags), str(name));

const getBlock = (nabu, fd, block, length) =>
  request(nabu, 0, NABU.NHACP_REQUEST_STORAGE_GET_BLOCK, fd, u32(block), u16(length));

const putBlock = (nabu, fd, block, data) =>
  request(nabu, 0, NABU.NHACP_REQUEST_STORAGE_PUT_BLOCK, fd, u32(block), u16(data.length), [...data]);

const dataOf = res => {
  expect(res.type).toBe(NABU.NHACP_RESPONSE_DATA_BUFFER);
  return res.bytes.slice(2, 2 + res.u16(0));
};

const fill = (length, value) => new Array(length).fill(value);

let nabu;
const files = {
  'DISK.IMG': Uint8Array.from({ length: 1000 }, (_, i) => i & 0xff),
  'HELLO.TXT': new TextEncoder().encode('Hello, NABU!'),
};

beforeEach(async () => {
  nabu = startAdaptor(files, channel);
});

afterEach(() => vi.unstubAllGlobals());

describe('sessions', () => {
  it('starts the system session', async () => {
    const res = await hello(nabu);
    expect(res.type).toBe(NABU.NHACP_RESPONSE_SESSION_STARTED);
    expect(res.u8(0)).toBe(0);
    expect(res.u16(1)).toBe(NABU.NHACP_VERSION);
    expect(new TextDecoder().decode(Uint8Array.from(res.bytes.slice(4, 4 + res.u8(3))))).toBe('nabu.run');
  });

  it('creates application sessions', async () => {
    await hello(nabu);
    expect((await hello(nabu, 0xff)).u8(0)).toBe(1);
    expect((await hello(nabu, 0xff)).u8(0)).toBe(2);
  });

  it('rejects NHACP 0.0, newer versions, and options', async () => {
    expectError(await hello(nabu, 0, 0), NABU.NHACP_ERROR_EINVAL);
    expectError(await hello(nabu, 0, 2), NABU.NHACP_ERROR_ENOTSUP);
    expectError(await hello(nabu, 0, 1, 1), NABU.NHACP_ERROR_ENOTSUP);
    expectError(await hello(nabu, 5), NABU.NHACP_ERROR_EINVAL);
  });

  it('rejects requests for unknown sessions', async () => {
    expectError(await open(nabu, 'HELLO.TXT'), NABU.NHACP_ERROR_ESRCH);
  });

  it('closes everything when the system session restarts', async () => {
    await hello(nabu);
    expect((await open(nabu, 'HELLO.TXT', 0, 3)).type).toBe(NABU.NHACP_RESPONSE_STORAGE_LOADED);
    await hello(nabu);
    expect((await open(nabu, 'HELLO.TXT', 0, 3)).type).toBe(NABU.NHACP_RESPONSE_STORAGE_LOADED);
  });

  it('ends sessions with GOODBYE', async () => {
    await hello(nabu);
    send(nabu, 0, NABU.NHACP_REQUEST_GOODBYE);
    expectError(await open(nabu, 'HELLO.TXT'), NABU.NHACP_ERROR_ESRCH);
  });
});

describe('storage', () => {
  beforeEach(() => hello(nabu));

  it('opens a file and reports its size', async () => {
    const res = await open(nabu, 'DISK.IMG', NABU.NHACP_O_RDWR);
    expect(res.type).toBe(NABU.NHACP_RESPONSE_STORAGE_LOADED);
    expect(res.u8(0)).toBe(0);
    expect(res.u32(1)).toBe(1000);
    expect(fetch).toHaveBeenCalledWith('https://example.test/cpm/DISK.IMG');
  });

  it('assigns free descriptors and refuses busy ones', async () => {
    expect((await open(nabu, 'HELLO.TXT')).u8(0)).toBe(0);
    expect((await open(nabu, 'HELLO.TXT')).u8(0)).toBe(1);
    expectError(await open(nabu, 'HELLO.TXT', 0, 1), NABU.NHACP_ERROR_EBUSY);
    send(nabu, 0, NABU.NHACP_REQUEST_FILE_CLOSE, 0);
    expect((await open(nabu, 'HELLO.TXT')).u8(0)).toBe(0);
  });

  it('handles missing files and O_CREAT/O_EXCL', async () => {
    expectError(await open(nabu, 'NEW.TXT'), NABU.NHACP_ERROR_ENOENT);
    const res = await open(nabu, 'NEW.TXT', NABU.NHACP_O_RDWR | NABU.NHACP_O_CREAT);
    expect(res.type).toBe(NABU.NHACP_RESPONSE_STORAGE_LOADED);
    expect(res.u32(1)).toBe(0);
    expectError(await open(nabu, 'HELLO.TXT', NABU.NHACP_O_RDWR | NABU.NHACP_O_CREAT | NABU.NHACP_O_EXCL),
      NABU.NHACP_ERROR_EEXIST);
  });

  it('reads blocks, zero-padding the last and empty past the end', async () => {
    await open(nabu, 'DISK.IMG');
    expect(dataOf(await getBlock(nabu, 0, 1, 128))).toEqual([...files['DISK.IMG'].slice(128, 256)]);
    expect(dataOf(await getBlock(nabu, 0, 7, 128))).toEqual([...files['DISK.IMG'].slice(896), ...fill(24, 0)]);
    expect(dataOf(await getBlock(nabu, 0, 8, 128))).toEqual([]);
  });

  it('writes blocks, growing and zero-filling the file', async () => {
    await open(nabu, 'DISK.IMG', NABU.NHACP_O_RDWR);
    expect((await putBlock(nabu, 0, 2, fill(128, 0xaa))).type).toBe(NABU.NHACP_RESPONSE_OK);
    expect((await putBlock(nabu, 0, 9, fill(128, 0xbb))).type).toBe(NABU.NHACP_RESPONSE_OK);

    expect(dataOf(await getBlock(nabu, 0, 2, 128))).toEqual(fill(128, 0xaa));
    expect(dataOf(await getBlock(nabu, 0, 8, 128))).toEqual(fill(128, 0));
    expect(dataOf(await getBlock(nabu, 0, 9, 128))).toEqual(fill(128, 0xbb));
  });

  it('keeps writes across close, reopen and a NABU restart', async () => {
    await open(nabu, 'DISK.IMG', NABU.NHACP_O_RDWR);
    await putBlock(nabu, 0, 0, fill(128, 0x55));
    send(nabu, 0, NABU.NHACP_REQUEST_FILE_CLOSE, 0);
    await hello(nabu);

    expect((await open(nabu, 'DISK.IMG')).u32(1)).toBe(1000);
    expect(dataOf(await getBlock(nabu, 0, 0, 128))).toEqual(fill(128, 0x55));
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/DISK.IMG'))).toHaveLength(1);
  });

  it('refuses writes to read-only descriptors', async () => {
    await open(nabu, 'DISK.IMG');
    expectError(await putBlock(nabu, 0, 0, fill(128, 1)), NABU.NHACP_ERROR_EBADF);
  });

  it('refuses bad descriptors and oversized requests', async () => {
    expectError(await getBlock(nabu, 7, 0, 128), NABU.NHACP_ERROR_EBADF);
    await open(nabu, 'DISK.IMG');
    expectError(await getBlock(nabu, 0, 0, 8193), NABU.NHACP_ERROR_EINVAL);
  });

  it('reads and writes at byte offsets', async () => {
    await open(nabu, 'HELLO.TXT', NABU.NHACP_O_RDWR);
    const put = await request(nabu, 0, NABU.NHACP_REQUEST_STORAGE_PUT, 0, u32(7), u16(4), [...new TextEncoder().encode('Joe!')]);
    expect(put.type).toBe(NABU.NHACP_RESPONSE_OK);
    const get = await request(nabu, 0, NABU.NHACP_REQUEST_STORAGE_GET, 0, u32(0), u16(100));
    expect(new TextDecoder().decode(Uint8Array.from(dataOf(get)))).toBe('Hello, Joe!!');
  });
});

describe('sequential files', () => {
  beforeEach(async () => {
    await hello(nabu);
    await open(nabu, 'NEW.TXT', NABU.NHACP_O_RDWR | NABU.NHACP_O_CREAT);
  });

  const write = text => request(nabu, 0, NABU.NHACP_REQUEST_FILE_WRITE, 0, u16(0), u16(text.length), [...new TextEncoder().encode(text)]);
  const read = length => request(nabu, 0, NABU.NHACP_REQUEST_FILE_READ, 0, u16(0), u16(length));
  const seek = (offset, whence) => request(nabu, 0, NABU.NHACP_REQUEST_FILE_SEEK, 0, u32(offset >>> 0), whence);
  const text = res => new TextDecoder().decode(Uint8Array.from(dataOf(res)));

  it('writes, seeks and reads with the cursor', async () => {
    await write('abcdef');
    const pos = await seek(-4, NABU.NHACP_SEEK_END);
    expect(pos.type).toBe(NABU.NHACP_RESPONSE_UINT32_VALUE);
    expect(pos.u32(0)).toBe(2);
    expect(text(await read(3))).toBe('cde');
    expect(text(await read(3))).toBe('f');
    expect(text(await read(3))).toBe('');
    expectError(await seek(-1, NABU.NHACP_SEEK_SET), NABU.NHACP_ERROR_EINVAL);
  });

  it('sets the size and reports file info', async () => {
    await write('abcdef');
    expect((await request(nabu, 0, NABU.NHACP_REQUEST_FILE_SET_SIZE, 0, u32(3))).type).toBe(NABU.NHACP_RESPONSE_OK);

    const info = await request(nabu, 0, NABU.NHACP_REQUEST_FILE_GET_INFO, 0);
    expect(info.type).toBe(NABU.NHACP_RESPONSE_FILE_INFO);
    expect(new TextDecoder().decode(Uint8Array.from(info.bytes.slice(0, 14)))).toMatch(/^\d{14}$/);
    expect(info.u16(14)).toBe(NABU.NHACP_ATTR_RD | NABU.NHACP_ATTR_WR);
    expect(info.u32(16)).toBe(3);
    expect(info.u8(20)).toBe(0); // no name
  });
});

describe('everything else', () => {
  beforeEach(() => hello(nabu));

  it('reports the date and time', async () => {
    const res = await request(nabu, 0, NABU.NHACP_REQUEST_GET_DATE_TIME);
    expect(res.type).toBe(NABU.NHACP_RESPONSE_DATE_TIME);
    expect(new TextDecoder().decode(Uint8Array.from(res.bytes))).toMatch(/^\d{14}$/);
  });

  it('gives details for the last error', async () => {
    expectError(await open(nabu, 'NOPE.TXT'), NABU.NHACP_ERROR_ENOENT);
    const res = await request(nabu, 0, NABU.NHACP_REQUEST_GET_ERROR_DETAILS, u16(NABU.NHACP_ERROR_ENOENT), 64);
    expect(res.type).toBe(NABU.NHACP_RESPONSE_ERROR);
    const message = new TextDecoder().decode(Uint8Array.from(res.bytes.slice(3, 3 + res.u8(2))));
    expect(message).toMatch(/NOPE\.TXT/);

    // The details are only kept once; after that it's a generic message.
    const again = await request(nabu, 0, NABU.NHACP_REQUEST_GET_ERROR_DETAILS, u16(NABU.NHACP_ERROR_ENOENT), 64);
    expect(new TextDecoder().decode(Uint8Array.from(again.bytes.slice(3, 3 + again.u8(2))))).toBe('no such file');
  });

  it('refuses unknown requests', async () => {
    expectError(await request(nabu, 0, 0x7e), NABU.NHACP_ERROR_ENOTSUP);
  });

  it('refuses truncated requests', async () => {
    expectError(await request(nabu, 0, NABU.NHACP_REQUEST_STORAGE_GET_BLOCK, 0, u16(1)), NABU.NHACP_ERROR_EINVAL);
  });
});

// Add an index.json to each directory, as the catalog's make-index.py does.
const withIndexes = files => {
  const dirs = new Map([['', new Map()]]);
  for (const [path, data] of Object.entries(files)) {
    const parts = path.split('/');
    parts.forEach((name, i) => {
      const dir = parts.slice(0, i).join('/');
      if (!dirs.has(dir)) dirs.set(dir, new Map());
      dirs.get(dir).set(name, i < parts.length - 1 ?
        { name, dir: true } :
        { name, size: data.length, mtime: '2023-02-25T20:24:32Z' });
    });
  }
  const out = { ...files };
  for (const [dir, entries] of dirs) {
    out[dir ? `${dir}/index.json` : 'index.json'] =
      new TextEncoder().encode(JSON.stringify({ entries: [...entries.values()] }));
  }
  return out;
};

describe('directories', () => {
  const nfs = { baseUrl: 'https://example.test/', imageDir: 'nfs', imageName: null };
  const text = s => new TextEncoder().encode(s);
  const tree = withIndexes({
    'A0/asm.com': text('assembler'),
    'A0/CPM22.SYS': text('system'),
    'A0/README.TXT': text('read me'),
    'B1/GAME.COM': text('game'),
  });

  beforeEach(async () => {
    vi.unstubAllGlobals();
    nabu = startAdaptor(tree, nfs);
    await hello(nabu);
  });

  const O_DIR = NABU.NHACP_O_DIRECTORY;
  const O_NEW = NABU.NHACP_O_RDWR | NABU.NHACP_O_CREAT | NABU.NHACP_O_EXCL;

  // Everything in a directory, as { name, dir, size }.
  const listing = async (dir, pattern = '', maxLength = 32) => {
    const opened = await open(nabu, dir, O_DIR, 9);
    expect(opened.type).toBe(NABU.NHACP_RESPONSE_STORAGE_LOADED);
    expect((await request(nabu, 0, NABU.NHACP_REQUEST_LIST_DIR, 9, str(pattern))).type).toBe(NABU.NHACP_RESPONSE_OK);
    const entries = [];
    for (;;) {
      const res = await request(nabu, 0, NABU.NHACP_REQUEST_GET_DIR_ENTRY, 9, maxLength);
      if (res.type === NABU.NHACP_RESPONSE_OK) break;
      expect(res.type).toBe(NABU.NHACP_RESPONSE_FILE_INFO);
      entries.push({
        name: new TextDecoder().decode(Uint8Array.from(res.bytes.slice(21, 21 + res.u8(20)))),
        dir: Boolean(res.u16(14) & NABU.NHACP_ATTR_DIR),
        size: res.u32(16),
      });
    }
    send(nabu, 0, NABU.NHACP_REQUEST_FILE_CLOSE, 9);
    return entries;
  };
  const names = async (...args) => (await listing(...args)).map(e => e.name);

  const readAll = async name => {
    const res = await open(nabu, name, 0, 5);
    expect(res.type).toBe(NABU.NHACP_RESPONSE_STORAGE_LOADED);
    const data = dataOf(await request(nabu, 0, NABU.NHACP_REQUEST_STORAGE_GET, 5, u32(0), u16(1000)));
    send(nabu, 0, NABU.NHACP_REQUEST_FILE_CLOSE, 5);
    return new TextDecoder().decode(Uint8Array.from(data));
  };

  it('lists the top-level directory', async () => {
    expect(await listing('')).toEqual([
      { name: 'A0', dir: true, size: 0 },
      { name: 'B1', dir: true, size: 0 },
    ]);
  });

  it('lists a directory, keeping the case of names', async () => {
    expect(await listing('A0')).toEqual([
      { name: 'asm.com', dir: false, size: 9 },
      { name: 'CPM22.SYS', dir: false, size: 6 },
      { name: 'README.TXT', dir: false, size: 7 },
    ]);
  });

  it('filters with a pattern, ignoring case', async () => {
    expect(await names('A0', '*.COM')).toEqual(['asm.com']);
    expect(await names('A0', '?????.*')).toEqual(['CPM22.SYS']);
    expect(await names('a0', '[ar]*')).toEqual(['asm.com', 'README.TXT']);
  });

  it('truncates names to the requested length', async () => {
    expect(await names('A0', '', 4)).toEqual(['asm.', 'CPM2', 'READ']);
  });

  it('opens files without regard to case', async () => {
    expect(await readAll('A0/ASM.COM')).toBe('assembler');
    expect(await readAll('a0/readme.txt')).toBe('read me');
  });

  it('tells files and directories apart', async () => {
    expectError(await open(nabu, 'A0/asm.com', O_DIR), NABU.NHACP_ERROR_ENOTDIR);
    expectError(await open(nabu, 'A0'), NABU.NHACP_ERROR_EISDIR);
    expectError(await open(nabu, 'C0', O_DIR), NABU.NHACP_ERROR_ENOENT);
    await open(nabu, 'A0/asm.com', 0, 3);
    expectError(await request(nabu, 0, NABU.NHACP_REQUEST_LIST_DIR, 3, str('')), NABU.NHACP_ERROR_ENOTDIR);
  });

  it('creates files, and any directories they need', async () => {
    expect((await open(nabu, 'A0/NEW.TXT', O_NEW, 3)).type).toBe(NABU.NHACP_RESPONSE_STORAGE_LOADED);
    await request(nabu, 0, NABU.NHACP_REQUEST_STORAGE_PUT, 3, u32(0), u16(5), [...text('hello')]);
    expect(await listing('A0')).toContainEqual({ name: 'NEW.TXT', dir: false, size: 5 });

    expect((await open(nabu, 'A3/NOTE.TXT', O_NEW, 4)).type).toBe(NABU.NHACP_RESPONSE_STORAGE_LOADED);
    expect(await names('')).toEqual(['A0', 'A3', 'B1']);
    expect(await names('A3')).toEqual(['NOTE.TXT']);

    expectError(await open(nabu, 'a0/ASM.COM', O_NEW), NABU.NHACP_ERROR_EEXIST);
  });

  it('removes files and empty directories', async () => {
    const remove = (name, flags = 0) => request(nabu, 0, NABU.NHACP_REQUEST_REMOVE, u16(flags), str(name));
    expect((await remove('A0/README.TXT')).type).toBe(NABU.NHACP_RESPONSE_OK);
    expect(await names('A0')).toEqual(['asm.com', 'CPM22.SYS']);
    expectError(await open(nabu, 'A0/README.TXT'), NABU.NHACP_ERROR_ENOENT);
    expectError(await remove('A0/README.TXT'), NABU.NHACP_ERROR_ENOENT);

    expectError(await remove('B1', 1), NABU.NHACP_ERROR_ENOTEMPTY);
    expectError(await remove('B1'), NABU.NHACP_ERROR_EISDIR);
    await remove('B1/GAME.COM');
    expect((await remove('B1', 1)).type).toBe(NABU.NHACP_RESPONSE_OK);
    expect(await names('')).toEqual(['A0']);
  });

  it('renames files, replacing any existing one', async () => {
    const rename = (from, to) => request(nabu, 0, NABU.NHACP_REQUEST_RENAME, str(from), str(to));
    expect((await rename('A0/README.TXT', 'A0/NOTES.TXT')).type).toBe(NABU.NHACP_RESPONSE_OK);
    expect(await names('A0')).toEqual(['asm.com', 'CPM22.SYS', 'NOTES.TXT']);
    expect(await readAll('A0/NOTES.TXT')).toBe('read me');

    await rename('A0/NOTES.TXT', 'A0/ASM.COM');
    expect(await listing('A0')).toEqual([
      { name: 'ASM.COM', dir: false, size: 7 },
      { name: 'CPM22.SYS', dir: false, size: 6 },
    ]);
    expect(await readAll('A0/asm.com')).toBe('read me');

    await rename('B1/GAME.COM', 'E0/GAME.COM');
    expect(await names('E0')).toEqual(['GAME.COM']);
    expectError(await rename('A0/NOPE', 'A0/X'), NABU.NHACP_ERROR_ENOENT);
  });

  it('makes directories', async () => {
    const mkdir = name => request(nabu, 0, NABU.NHACP_REQUEST_MKDIR, str(name));
    expect((await mkdir('F0')).type).toBe(NABU.NHACP_RESPONSE_OK);
    expect(await listing('F0')).toEqual([]);
    expectError(await mkdir('a0'), NABU.NHACP_ERROR_EEXIST);
  });

  it('keeps changes across a NABU restart', async () => {
    await open(nabu, 'A0/NEW.TXT', O_NEW, 3);
    await request(nabu, 0, NABU.NHACP_REQUEST_REMOVE, u16(0), str('A0/asm.com'));
    await hello(nabu);
    expect(await names('A0')).toEqual(['CPM22.SYS', 'NEW.TXT', 'README.TXT']);
  });
});
