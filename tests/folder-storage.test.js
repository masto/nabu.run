// @vitest-environment node

// Keeping the NABU's files in a local folder: FolderStorage, copying a
// channel in, and the StorageManager that chooses between folder and memory.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeDirectory } from './fake-fs';
import { startAdaptor } from './fake-nabu';
import { FLUSH_DELAY, FolderStorage, copyChannel } from '../src/machines/adaptor/folder-storage';
import { StorageManager } from '../src/machines/adaptor/storage-manager';
import * as NABU from '../src/machines/adaptor/constants';

const ROOT = 'https://example.test/nfs';
const text = bytes => new TextDecoder().decode(bytes);
const bytes = s => new TextEncoder().encode(s);

const expectCode = async (promise, code) => {
  await expect(promise).rejects.toMatchObject({ code });
};

describe('FolderStorage', () => {
  let dir;
  let storage;

  beforeEach(() => {
    dir = new FakeDirectory().add({
      'A0/asm.com': 'assembler',
      'A0/README.TXT': 'read me',
      'B1/GAME.COM': 'game',
    });
    storage = new FolderStorage(dir, ROOT);
  });

  afterEach(() => vi.useRealTimers());

  it('knows which URLs are its own', () => {
    expect(storage.contains(`${ROOT}/A0/X`)).toBe(true);
    expect(storage.contains(`${ROOT}/`)).toBe(true);
    expect(storage.contains('https://example.test/nfs2/A0')).toBe(false);
  });

  it('opens files without regard to case', async () => {
    const { file, created } = await storage.openFile(`${ROOT}/a0/ASM.COM`);
    expect(created).toBe(false);
    expect(text(file.read(0, 100))).toBe('assembler');
  });

  it('lists directories, sorted, keeping the case of names', async () => {
    expect((await storage.list(`${ROOT}/A0`)).map(e => [e.name, e.dir, e.size])).toEqual([
      ['asm.com', false, 9],
      ['README.TXT', false, 7],
    ]);
    expect((await storage.list(ROOT)).map(e => [e.name, e.dir])).toEqual([['A0', true], ['B1', true]]);
  });

  it('tells files and directories apart', async () => {
    await expectCode(storage.openFile(`${ROOT}/A0`), NABU.NHACP_ERROR_EISDIR);
    await expectCode(storage.openDirectory(`${ROOT}/A0/asm.com`), NABU.NHACP_ERROR_ENOTDIR);
    await expectCode(storage.openDirectory(`${ROOT}/C0`), NABU.NHACP_ERROR_ENOENT);
    await expectCode(storage.openFile(`${ROOT}/A0/NOPE`), NABU.NHACP_ERROR_ENOENT);
  });

  it('writes changes back after a pause', async () => {
    vi.useFakeTimers();
    const { file } = await storage.openFile(`${ROOT}/A0/README.TXT`);
    file.write(0, bytes('READ'));
    file.write(4, bytes('!'));
    expect(dir.at('A0/README.TXT').text()).toBe('read me');

    await vi.advanceTimersByTimeAsync(FLUSH_DELAY);
    expect(dir.at('A0/README.TXT').text()).toBe('READ!me');
    // The burst of writes went out as one.
    expect(dir.at('A0/README.TXT').writes).toBe(1);
  });

  it('writes changes back on close', async () => {
    const { file } = await storage.openFile(`${ROOT}/A0/README.TXT`);
    file.setSize(4);
    await file.close();
    expect(dir.at('A0/README.TXT').text()).toBe('read');
  });

  it('shows unwritten changes in listings', async () => {
    const { file } = await storage.openFile(`${ROOT}/A0/README.TXT`);
    file.write(7, bytes(' please'));
    expect((await storage.list(`${ROOT}/A0`)).find(e => e.name === 'README.TXT').size).toBe(14);
    expect(storage.dirty).toBe(true);
    await storage.flush();
    expect(storage.dirty).toBe(false);
  });

  it('picks up changes made outside nabu.run', async () => {
    await storage.openFile(`${ROOT}/A0/README.TXT`);
    dir.at('A0/README.TXT').touch('changed');
    const { file } = await storage.openFile(`${ROOT}/A0/README.TXT`);
    expect(text(file.read(0, 100))).toBe('changed');
  });

  it('creates files, and any directories they need', async () => {
    const { file, created } = await storage.openFile(`${ROOT}/A5/NEW.TXT`, { create: true, exclusive: true });
    expect(created).toBe(true);
    file.write(0, bytes('new'));
    await file.close();
    expect(dir.at('A5/NEW.TXT').text()).toBe('new');
    await expectCode(storage.openFile(`${ROOT}/a0/ASM.COM`, { create: true, exclusive: true }), NABU.NHACP_ERROR_EEXIST);
  });

  it('removes files and empty directories', async () => {
    await storage.remove(`${ROOT}/a0/readme.txt`);
    expect(dir.at('A0/README.TXT')).toBeUndefined();
    await expectCode(storage.remove(`${ROOT}/A0/README.TXT`), NABU.NHACP_ERROR_ENOENT);
    await expectCode(storage.remove(`${ROOT}/B1`, { directory: true }), NABU.NHACP_ERROR_ENOTEMPTY);
    await expectCode(storage.remove(`${ROOT}/B1`), NABU.NHACP_ERROR_EISDIR);
    await storage.remove(`${ROOT}/B1/GAME.COM`);
    await storage.remove(`${ROOT}/B1`, { directory: true });
    expect(dir.at('B1')).toBeUndefined();
  });

  it('doesn\'t write back a file after removing it', async () => {
    vi.useFakeTimers();
    const { file } = await storage.openFile(`${ROOT}/A0/README.TXT`);
    file.write(0, bytes('x'));
    await storage.remove(`${ROOT}/A0/README.TXT`);
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY * 2);
    expect(dir.at('A0/README.TXT')).toBeUndefined();
  });

  it('renames files, taking unwritten changes along', async () => {
    const { file } = await storage.openFile(`${ROOT}/A0/README.TXT`);
    file.write(0, bytes('READ'));
    await storage.rename(`${ROOT}/A0/README.TXT`, `${ROOT}/A0/NOTES.TXT`);
    expect(dir.at('A0/README.TXT')).toBeUndefined();
    expect(dir.at('A0/NOTES.TXT').text()).toBe('READ me');
  });

  it('renames onto an existing file, and to another directory', async () => {
    await storage.rename(`${ROOT}/A0/README.TXT`, `${ROOT}/A0/ASM.COM`);
    expect(Object.keys(dir.tree())).toEqual(['A0/ASM.COM', 'B1/GAME.COM']);
    expect(dir.at('A0/ASM.COM').text()).toBe('read me');

    await storage.rename(`${ROOT}/B1/GAME.COM`, `${ROOT}/E0/GAME.COM`);
    expect(dir.at('E0/GAME.COM').text()).toBe('game');
  });

  it('makes directories', async () => {
    await storage.mkdir(`${ROOT}/F0`);
    expect(dir.at('F0').kind).toBe('directory');
    await expectCode(storage.mkdir(`${ROOT}/a0`), NABU.NHACP_ERROR_EEXIST);
  });

  it('reports lost permission as EACCES', async () => {
    dir.at('A0').entries = async function* () {
      yield* [];
      throw new DOMException('no', 'NotAllowedError');
    };
    await expectCode(storage.list(`${ROOT}/A0`), NABU.NHACP_ERROR_EACCES);
  });
});

// A channel served over HTTP, with index.json files.
const serve = files => {
  const index = {};
  for (const path of Object.keys(files)) {
    const parts = path.split('/');
    parts.forEach((name, i) => {
      const at = parts.slice(0, i).join('/');
      index[at] ??= new Map();
      index[at].set(name, i < parts.length - 1 ? { name, dir: true } : { name, size: files[path].length });
    });
  }
  const served = { ...files };
  for (const [at, entries] of Object.entries(index)) {
    served[at ? `${at}/index.json` : 'index.json'] = JSON.stringify({ entries: [...entries.values()] });
  }
  const fetch = vi.fn(async url => {
    const path = decodeURIComponent(url.replace(`${ROOT}/`, ''));
    if (!(path in served)) return { ok: false, status: 404 };
    return { ok: true, status: 200, arrayBuffer: async () => bytes(served[path]).buffer };
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

const channelFiles = {
  '000001.nabu': 'boot',
  'A0/CPM22.SYS': 'system',
  'A0/asm.com': 'assembler',
  'B1/Game One.com': 'game',
};

describe('copying a channel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('copies everything in the index', async () => {
    serve(channelFiles);
    const dir = new FakeDirectory();
    const progress = [];
    await copyChannel(ROOT, dir, p => progress.push(p));
    expect(dir.tree()).toEqual(channelFiles);
    expect(progress.at(0)).toEqual({ done: 0, total: 23 });
    expect(progress.at(-1)).toEqual({ done: 23, total: 23 });
  });

  it('skips the files it\'s told to', async () => {
    serve(channelFiles);
    const dir = new FakeDirectory();
    await copyChannel(ROOT, dir, () => { }, { skip: ['000001.NABU'] });
    expect(dir.at('000001.nabu')).toBeUndefined();
    expect(dir.at('A0/CPM22.SYS').text()).toBe('system');
  });

  it('leaves files that are already there alone', async () => {
    serve(channelFiles);
    const dir = new FakeDirectory().add({ 'A0/ASM.COM': 'mine' });
    await copyChannel(ROOT, dir);
    expect(dir.at('A0/ASM.COM').text()).toBe('mine');
    expect(dir.at('A0/asm.com')).toBeUndefined();
    expect(dir.at('A0/CPM22.SYS').text()).toBe('system');
  });
});

describe('StorageManager', () => {
  const nfs = { id: 'ishkur-nfs', storage: 'folder', baseUrl: 'https://example.test/', imageDir: 'nfs', imageName: '000001.nabu' };
  const plain = { id: 'cycle-2', baseUrl: 'https://example.test/', imageDir: 'cycle-2', imageName: null };

  let channel;
  let copies;
  let manager;
  let root;

  beforeEach(() => {
    serve(channelFiles);
    channel = nfs;
    copies = new Map();
    const store = { get: async id => copies.get(id), set: async (id, s) => { copies.set(id, s); } };
    manager = new StorageManager({ getChannel: () => channel, copies: store });
    root = new FakeDirectory('nabu');
  });

  afterEach(() => vi.unstubAllGlobals());

  it('uses memory until there\'s a folder', async () => {
    expect(manager.usesFolder()).toBe(false);
    const { file } = await manager.openFile(`${ROOT}/A0/NEW.TXT`, { create: true });
    file.write(0, bytes('x'));
    expect(root.children.size).toBe(0);
  });

  it('copies the channel into a subfolder the first time, except the boot image', async () => {
    manager.setRoot(root);
    expect(manager.usesFolder()).toBe(true);
    const listing = await manager.list(`${ROOT}/A0`);
    expect(listing.map(e => e.name)).toEqual(['asm.com', 'CPM22.SYS']);
    const withoutBoot = Object.fromEntries(Object.entries(channelFiles).filter(([path]) => path !== '000001.nabu'));
    expect(root.at('ishkur-nfs').tree()).toEqual(withoutBoot);
    expect(copies.get('ishkur-nfs')).toBe('done');
  });

  it('keeps changes in the folder', async () => {
    manager.setRoot(root);
    const { file } = await manager.openFile(`${ROOT}/A0/NEW.TXT`, { create: true, exclusive: true });
    file.write(0, bytes('saved'));
    await manager.flush();
    expect(root.at('ishkur-nfs/A0/NEW.TXT').text()).toBe('saved');
  });

  it('never copies into a subfolder twice', async () => {
    manager.setRoot(root);
    await manager.remove(`${ROOT}/A0/asm.com`);

    // Later, with the same folder: what the user removed stays removed.
    manager.setRoot(null);
    manager.setRoot(root);
    expect((await manager.list(`${ROOT}/A0`)).map(e => e.name)).toEqual(['CPM22.SYS']);
  });

  it('finishes a copy that was interrupted', async () => {
    root.add({ 'ishkur-nfs/A0/CPM22.SYS': 'system' });
    copies.set('ishkur-nfs', 'copying');
    manager.setRoot(root);
    await manager.openDirectory(`${ROOT}/A0`);
    expect(root.at('ishkur-nfs').at('A0/asm.com').text()).toBe('assembler');
    expect(root.at('ishkur-nfs').at('B1/Game One.com').text()).toBe('game');
    expect(copies.get('ishkur-nfs')).toBe('done');
  });

  it('leaves a subfolder that was already there alone', async () => {
    root.add({ 'ishkur-nfs/A0/MINE.COM': 'mine' });
    manager.setRoot(root);
    expect((await manager.list(`${ROOT}/A0`)).map(e => e.name)).toEqual(['MINE.COM']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses memory for channels that can\'t use a folder', async () => {
    manager.setRoot(root);
    channel = plain;
    expect(manager.usesFolder()).toBe(false);
    await expectCode(manager.openDirectory('https://example.test/cycle-2/A0'), NABU.NHACP_ERROR_ENOENT);
    expect(root.children.size).toBe(0);
  });

  it('reports copy progress', async () => {
    const events = [];
    manager.subscribe(e => events.push(e));
    manager.setRoot(root);
    await manager.folderFor(nfs);
    const progress = events.filter(e => e.type === 'progress');
    // Everything but the 4-byte boot image.
    expect(progress.at(0).progress).toEqual({ done: 0, total: 19 });
    expect(progress.at(-1).progress).toBeNull();
  });

  it('reports lost permission', async () => {
    const events = [];
    manager.subscribe(e => events.push(e));
    manager.setRoot(root);
    await manager.folderFor(nfs);
    root.at('ishkur-nfs').entries = async function* () {
      yield* [];
      throw new DOMException('no', 'NotAllowedError');
    };
    await expectCode(manager.list(`${ROOT}/A0`), NABU.NHACP_ERROR_EACCES);
    expect(events.filter(e => e.type === 'error').map(e => e.error.code)).toEqual([NABU.NHACP_ERROR_EACCES]);
  });
});

describe('NHACP with a folder', () => {
  const u16 = v => [v & 0xff, v >> 8];
  const u32 = v => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24];
  const str = s => [s.length, ...bytes(s)];

  const request = async (nabu, type, ...fields) => {
    const body = [type, ...fields.flat()];
    nabu.send([0x8f, 0, ...u16(body.length), ...body]);
    const [lo, hi] = await nabu.take(2);
    return nabu.take(lo | hi << 8);
  };

  afterEach(() => vi.unstubAllGlobals());

  it('saves what the NABU writes into the folder', async () => {
    const root = new FakeDirectory('nabu');
    const copies = new Map();
    const channel = { id: 'ishkur-nfs', storage: 'folder', baseUrl: 'https://example.test/', imageDir: 'nfs', imageName: '000001.nabu' };
    const manager = new StorageManager({
      getChannel: () => channel,
      copies: { get: async id => copies.get(id), set: async (id, s) => { copies.set(id, s); } },
    });
    manager.setRoot(root);

    const nabu = startAdaptor({}, channel, { storage: manager });
    serve(channelFiles); // after startAdaptor, which stubs fetch too

    await request(nabu, NABU.NHACP_REQUEST_HELLO, ...bytes('ACP'), u16(1), u16(0));
    const opened = await request(nabu, NABU.NHACP_REQUEST_STORAGE_OPEN, 3,
      u16(NABU.NHACP_O_RDWR | NABU.NHACP_O_CREAT | NABU.NHACP_O_EXCL), str('A0/HELLO.TXT'));
    expect(opened[0]).toBe(NABU.NHACP_RESPONSE_STORAGE_LOADED);

    const data = [...bytes('hello, folder')];
    await request(nabu, NABU.NHACP_REQUEST_STORAGE_PUT_BLOCK, 3, u32(0), u16(data.length), data);
    nabu.send([0x8f, 0, 2, 0, NABU.NHACP_REQUEST_FILE_CLOSE, 3]);

    await vi.waitFor(() => expect(root.at('ishkur-nfs/A0/HELLO.TXT')?.text()).toBe('hello, folder'));
    expect(root.at('ishkur-nfs/A0/CPM22.SYS').text()).toBe('system');
  });
});
