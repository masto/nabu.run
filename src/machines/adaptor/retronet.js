// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Handlers for RetroNET, DJ Sures' extensions to the NABU protocol: the
// file store, character devices, and enough of the rest to fail politely.
// The Cloud CP/M drive commands are in retronet-cpm.js. See
// docs/cloud-cpm-protocol.md for the spec and how the Internet Adapter (IA)
// actually behaves.
//
// Names given to the file store are either web URLs, fetched through the
// RetroNET proxy and kept in memory, or local names, which are files in the
// IA's "store" folder. Here the store is the channel's directory, in the
// same storage NHACP uses, so it can be a local folder.

import { baseName } from './util';

import { getBytes } from './common';
import { MemoryFile, StorageError, storageOf, EIO, ENOENT } from './storage';
import * as NABU from './constants';

/*
 *  Reading requests and writing replies
 */

export const u8 = async ctx => (await getBytes(ctx, 1))[0];
export const u16 = async ctx => {
  const [lo, hi] = await getBytes(ctx, 2);
  return lo | hi << 8;
};
export const u32 = async ctx =>
  new DataView(new Uint8Array(await getBytes(ctx, 4)).buffer).getUint32(0, true);
const i32 = async ctx => (await u32(ctx)) | 0;
export const bytes = async (ctx, n) => new Uint8Array(await getBytes(ctx, n));
const string = async ctx => new TextDecoder().decode(await bytes(ctx, await u8(ctx)));

export const le16 = n => [n & 0xff, n >> 8 & 0xff];
export const le32 = n => [n & 0xff, n >> 8 & 0xff, n >> 16 & 0xff, n >>> 24 & 0xff];

// Send a reply made of byte arrays and numbers (bytes).
export const reply = (ctx, ...parts) => {
  const flat = parts.flatMap(p => p instanceof Uint8Array ? [...p] : p);
  return ctx.writer.write(new Uint8Array(flat));
};

export const status = (ctx, fileName, message, extra) => {
  ctx.log(message);
  ctx.progress = { fileName, message, ...extra };
};

// Storage failures that the NABU should hear about as "no" rather than
// anything worse. Anything else is a bug or a broken connection.
export const orElse = async (promise, fallback) => {
  try {
    return await promise;
  }
  catch (e) {
    if (!(e instanceof StorageError)) throw e;
    return fallback;
  }
};

/*
 *  Names and files
 */

const isWeb = name => /^(https?|ftp):\/\//i.test(name);

// The channel's directory, which stands in for the IA's store folder.
export const storeUrl = ctx => {
  const channel = ctx.getChannel();
  return `${channel.baseUrl}${channel.imageDir}`;
};

// A local name as a URL in the store. Drive letters and backslashes are
// allowed (z:\test\file.txt), and so are subdirectories.
export const localUrl = (ctx, name) => {
  const parts = name.replace(/^[a-z]:/i, '').split(/[\\/]+/)
    .filter(p => p && p !== '.' && p !== '..');
  return [storeUrl(ctx), ...parts].join('/');
};

// Web files come through the proxy, which needs the path escaped once more
// to arrive intact.
const proxied = (ctx, name) => {
  const url = new URL(name);
  url.pathname = encodeURIComponent(url.pathname);
  return (ctx.rnProxyUrl ?? '') + url;
};

// Web files are fetched once per connection and then kept in memory. The
// NABU can change its copy, but nothing is written back.
const webFile = (ctx, name) => {
  ctx.rnWeb ??= new Map();
  if (!ctx.rnWeb.has(name)) {
    const pending = (async () => {
      let response;
      try {
        response = await fetch(proxied(ctx, name));
      }
      catch (e) {
        throw new StorageError(EIO, `fetch ${name}: ${e.message}`);
      }
      if (!response.ok) {
        throw new StorageError(response.status === 404 ? ENOENT : EIO, `fetch ${name}: ${response.status}`);
      }
      return new MemoryFile(new Uint8Array(await response.arrayBuffer()));
    })();
    ctx.rnWeb.set(name, pending);
    pending.catch(() => ctx.rnWeb.delete(name));
  }
  return ctx.rnWeb.get(name);
};

// The file called `name`. Local files are created if `create` is set.
const openNamed = async (ctx, name, { create = false } = {}) => {
  if (isWeb(name)) return webFile(ctx, name);
  const { file } = await storageOf(ctx).openFile(localUrl(ctx, name), { create });
  return file;
};

const readAll = async file => new Uint8Array(await file.read(0, file.size));

// Put `data` at `offset`, growing the file if needed.
const writeAt = (file, offset, data) => file.write(offset, data);

/*
 *  Handles
 */

const handlesOf = ctx => (ctx.rn.handles ??= []);

// Use the handle asked for if it's free, otherwise the lowest free one.
// 0xff means there are none.
const assignHandle = (ctx, wanted, value) => {
  const handles = handlesOf(ctx);
  let fh = wanted;
  if (fh === 0xff || handles[fh]) {
    fh = handles.findIndex(h => !h);
    if (fh === -1) fh = handles.length;
  }
  if (fh >= 0xff) return 0xff;
  handles[fh] = value;
  return fh;
};

// The open file for handle `fh`. A handle that isn't open acts like an
// empty file, so a confused program gets nothing rather than a hung NABU.
const handleOf = (ctx, fh) => handlesOf(ctx)[fh] ?? {
  name: `(handle ${fh})`,
  file: new MemoryFile(),
  pos: 0,
  closed: true,
};

const closeHandle = async (ctx, fh) => {
  const handle = handlesOf(ctx)[fh];
  delete handlesOf(ctx)[fh];
  await orElse(handle?.file?.close?.());
  return handle;
};

/*
 *  File details: the 83-byte FileDetailsStruct
 */

const SIZE_DIRECTORY = -1;
const SIZE_MISSING = -2;

const dateBytes = date => {
  const d = date ?? new Date();
  return [...le16(d.getFullYear()), d.getMonth() + 1, d.getDate(),
    d.getHours(), d.getMinutes(), d.getSeconds()];
};

const details = ({ name = '', size, mtime }) => {
  const out = new Uint8Array(83);
  out.set(le32(size), 0);
  out.set(dateBytes(mtime), 4);
  out.set(dateBytes(mtime), 11);
  const encoded = new TextEncoder().encode(name).subarray(0, 64);
  out[18] = encoded.length;
  out.set(encoded, 19);
  return out;
};

// Details of a local name: a file, a directory, or missing.
const namedDetails = async (ctx, name) => {
  const shown = baseName(name.replace(/\\/g, '/'));
  if (isWeb(name)) {
    const file = await orElse(webFile(ctx, name), null);
    return { name: shown, size: file ? file.size : SIZE_MISSING, mtime: file?.mtime };
  }
  const url = localUrl(ctx, name);
  const storage = storageOf(ctx);
  if (await orElse(storage.openDirectory(url).then(() => true), false)) {
    return { name: shown, size: SIZE_DIRECTORY };
  }
  const file = await orElse(storage.openFile(url).then(r => r.file), null);
  return { name: shown, size: file ? file.size : SIZE_MISSING, mtime: file?.mtime };
};

// Wildcards: * for any run of characters, ? for any one.
const wildcard = pattern => new RegExp('^' + [...(pattern || '*')].map(c =>
  c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('') + '$', 'i');

/*
 *  Line-oriented reading
 */

const lines = data => {
  const text = [];
  let begin = 0;
  for (;;) {
    const nl = data.indexOf(0x0a, begin);
    if (nl === -1) break;
    text.push(data.subarray(begin, nl > begin && data[nl - 1] === 0x0d ? nl - 1 : nl));
    begin = nl + 1;
  }
  if (begin < data.length) text.push(data.subarray(begin));
  return text;
};

// Handlers by message, which protocol.js makes into states. Each reads the
// rest of its message and sends the reply, if there is one.
export const retroNetHandlers = {
  [NABU.MSG_RN_FILE_OPEN]: async ctx => {
    const name = await string(ctx);
    const flag = await u16(ctx);
    const wanted = await u8(ctx);
    const readWrite = Boolean(flag & NABU.RN_OPEN_READWRITE);

    // A missing local file is created only when opened for writing; the
    // Cloud CP/M loader relies on read-only opens failing.
    const file = await orElse(openNamed(ctx, name, { create: readWrite }), null);
    const fh = file ? assignHandle(ctx, wanted, { name, file, pos: 0 }) : 0xff;
    status(ctx, name, `Open ${baseName(name)} (${readWrite ? 'rw' : 'ro'}) = ${fh}`);
    return reply(ctx, fh);
  },

  [NABU.MSG_RN_FH_CLOSE]: async ctx => {
    const fh = await u8(ctx);
    const handle = await closeHandle(ctx, fh);
    status(ctx, handle?.name, `Close ${fh} ${baseName(handle?.name)}`);
  },

  [NABU.MSG_RN_FILE_SIZE]: async ctx => {
    const name = await string(ctx);
    const file = await orElse(openNamed(ctx, name), null);
    const size = file ? file.size : -1;
    status(ctx, name, `Size ${baseName(name)} = ${size}`);
    return reply(ctx, le32(size));
  },

  [NABU.MSG_RN_FH_SIZE]: async ctx => {
    const handle = handleOf(ctx, await u8(ctx));
    return reply(ctx, le32(handle.closed ? -1 : handle.file.size));
  },

  [NABU.MSG_RN_FH_READ]: async ctx => {
    const fh = await u8(ctx);
    const offset = await u32(ctx);
    const length = await u16(ctx);
    const handle = handleOf(ctx, fh);
    const data = new Uint8Array(await handle.file.read(offset, length));
    handle.pos = offset + data.length;
    status(ctx, handle.name, `Read ${baseName(handle.name)} @ ${offset}`,
      { total: handle.file.size, complete: handle.pos });
    return reply(ctx, le16(data.length), data);
  },

  [NABU.MSG_RN_FH_READSEQ]: async ctx => {
    const fh = await u8(ctx);
    const length = await u16(ctx);
    const handle = handleOf(ctx, fh);
    const data = new Uint8Array(await handle.file.read(handle.pos, length));
    handle.pos += data.length;
    status(ctx, handle.name, `Reading ${baseName(handle.name)}`,
      { total: handle.file.size, complete: handle.pos });
    return reply(ctx, le16(data.length), data);
  },

  [NABU.MSG_RN_FH_SEEK]: async ctx => {
    const fh = await u8(ctx);
    const offset = await i32(ctx);
    const whence = await u8(ctx);
    const handle = handleOf(ctx, fh);
    const base = { [NABU.RN_SEEK_CUR]: handle.pos, [NABU.RN_SEEK_END]: handle.file.size }[whence] ?? 0;
    handle.pos = Math.max(0, Math.min(handle.file.size, base + offset));
    status(ctx, handle.name, `Seek ${baseName(handle.name)} ${offset} (${whence}) = ${handle.pos}`);
    return reply(ctx, le32(handle.pos));
  },

  [NABU.MSG_RN_FH_APPEND]: async ctx => {
    const handle = handleOf(ctx, await u8(ctx));
    const data = await bytes(ctx, await u16(ctx));
    await writeAt(handle.file, handle.file.size, data);
    status(ctx, handle.name, `Append ${data.length} to ${baseName(handle.name)}`);
  },

  [NABU.MSG_RN_FH_INSERT]: async ctx => {
    const handle = handleOf(ctx, await u8(ctx));
    const offset = await u32(ctx);
    const data = await bytes(ctx, await u16(ctx));
    const { file } = handle;
    const at = Math.min(offset, file.size);
    const tail = new Uint8Array(await file.read(at, file.size - at));
    await writeAt(file, at, data);
    await writeAt(file, at + data.length, tail);
    status(ctx, handle.name, `Insert ${data.length} into ${baseName(handle.name)} @ ${offset}`);
  },

  [NABU.MSG_RN_FH_DELETE_RANGE]: async ctx => {
    const handle = handleOf(ctx, await u8(ctx));
    const offset = await u32(ctx);
    const length = await u16(ctx);
    const { file } = handle;
    if (offset < file.size) {
      const end = Math.min(file.size, offset + length);
      const tail = new Uint8Array(await file.read(end, file.size - end));
      await writeAt(file, offset, tail);
      await file.setSize(file.size - (end - offset));
    }
    status(ctx, handle.name, `Delete ${length} from ${baseName(handle.name)} @ ${offset}`);
  },

  [NABU.MSG_RN_FH_REPLACE]: async ctx => {
    const handle = handleOf(ctx, await u8(ctx));
    const offset = await u32(ctx);
    const data = await bytes(ctx, await u16(ctx));
    await writeAt(handle.file, offset, data);
    status(ctx, handle.name, `Write ${data.length} to ${baseName(handle.name)} @ ${offset}`);
  },

  [NABU.MSG_RN_FH_TRUNCATE]: async ctx => {
    const handle = handleOf(ctx, await u8(ctx));
    await handle.file.setSize(0);
    status(ctx, handle.name, `Empty ${baseName(handle.name)}`);
  },

  [NABU.MSG_RN_FILE_READ]: async ctx => {
    const name = await string(ctx);
    const offset = await u32(ctx);
    const length = await u16(ctx);
    const file = await orElse(openNamed(ctx, name), null);
    const data = file ? new Uint8Array(await file.read(offset, length)) : new Uint8Array(0);
    status(ctx, name, `Read ${baseName(name)} @ ${offset}`);
    return reply(ctx, le16(data.length), data);
  },

  [NABU.MSG_RN_FILE_REPLACE]: async ctx => {
    const name = await string(ctx);
    const offset = await u32(ctx);
    const data = await bytes(ctx, await u16(ctx));
    const file = await orElse(openNamed(ctx, name, { create: true }), null);
    if (file) {
      await writeAt(file, offset, data);
      await orElse(file.close?.());
    }
    status(ctx, name, `Write ${data.length} to ${baseName(name)} @ ${offset}`);
  },

  [NABU.MSG_RN_FILE_DELETE]: async ctx => {
    const name = await string(ctx);
    // The IA closes the file if it's open.
    for (const [fh, handle] of handlesOf(ctx).entries()) {
      if (handle?.name.toLowerCase() === name.toLowerCase()) await closeHandle(ctx, fh);
    }
    if (!isWeb(name)) await orElse(storageOf(ctx).remove(localUrl(ctx, name)));
    status(ctx, name, `Delete ${baseName(name)}`);
  },

  [NABU.MSG_RN_FILE_COPY]: async ctx => {
    const from = await string(ctx);
    const to = await string(ctx);
    const replace = Boolean((await u8(ctx)) & NABU.RN_COPY_REPLACE);
    status(ctx, from, `Copy ${baseName(from)} to ${baseName(to)}`);
    if (isWeb(to)) return;
    const source = await orElse(openNamed(ctx, from), null);
    if (!source) return;
    const exists = await orElse(openNamed(ctx, to).then(() => true), false);
    if (exists && !replace) return;
    const target = await orElse(openNamed(ctx, to, { create: true }), null);
    if (!target) return;
    await target.setSize(0);
    await writeAt(target, 0, await readAll(source));
    await orElse(target.close?.());
  },

  [NABU.MSG_RN_FILE_MOVE]: async ctx => {
    const from = await string(ctx);
    const to = await string(ctx);
    const replace = Boolean((await u8(ctx)) & NABU.RN_COPY_REPLACE);
    status(ctx, from, `Move ${baseName(from)} to ${baseName(to)}`);
    if (isWeb(from) || isWeb(to)) return;
    const exists = await orElse(openNamed(ctx, to).then(() => true), false);
    if (exists && !replace) return;
    await orElse(storageOf(ctx).rename(localUrl(ctx, from), localUrl(ctx, to)));
  },

  [NABU.MSG_RN_FILE_LIST]: async ctx => {
    const path = await string(ctx);
    const pattern = wildcard(await string(ctx));
    const flags = await u8(ctx);
    const entries = isWeb(path) ? [] :
      await orElse(storageOf(ctx).list(localUrl(ctx, path)), []);
    ctx.rn.listing = entries.filter(e =>
      (e.dir ? flags & NABU.RN_LIST_DIRECTORIES : flags & NABU.RN_LIST_FILES) &&
      e.name !== 'index.json' && pattern.test(e.name));
    status(ctx, path, `List ${path || '(store)'}: ${ctx.rn.listing.length}`);
    return reply(ctx, le16(ctx.rn.listing.length));
  },

  [NABU.MSG_RN_FILE_LIST_ITEM]: async ctx => {
    const index = await u16(ctx);
    const entry = ctx.rn.listing?.[index];
    return reply(ctx, details(entry ?
      { name: entry.name, size: entry.dir ? SIZE_DIRECTORY : entry.size, mtime: entry.mtime } :
      { size: SIZE_MISSING }));
  },

  [NABU.MSG_RN_FILE_DETAILS]: async ctx => {
    const name = await string(ctx);
    const info = await namedDetails(ctx, name);
    status(ctx, name, `Details ${baseName(name)}: ${info.size}`);
    return reply(ctx, details(info));
  },

  [NABU.MSG_RN_FH_DETAILS]: async ctx => {
    const fh = await u8(ctx);
    const handle = handleOf(ctx, fh);
    const name = baseName(handle.name.replace(/\\/g, '/'));
    return reply(ctx, details(handle.closed ? { size: SIZE_MISSING } :
      { name, size: handle.file.size, mtime: handle.file.mtime }));
  },

  [NABU.MSG_RN_FH_LINE_COUNT]: async ctx => {
    const handle = handleOf(ctx, await u8(ctx));
    const count = lines(await readAll(handle.file)).length;
    status(ctx, handle.name, `Lines in ${baseName(handle.name)}: ${count}`);
    return reply(ctx, le16(count));
  },

  [NABU.MSG_RN_FH_GET_LINE]: async ctx => {
    const handle = handleOf(ctx, await u8(ctx));
    const number = await u16(ctx);
    const line = lines(await readAll(handle.file))[number] ?? new Uint8Array(0);
    status(ctx, handle.name, `Line ${number} of ${baseName(handle.name)}`);
    return reply(ctx, le16(line.length), line);
  },

  // The printer (CP/M's LST:) goes to LST.TXT in the store, like the IA.
  [NABU.MSG_RN_PRINTER]: async ctx => {
    const c = await u8(ctx);
    ctx.rnPrinter ??= openNamed(ctx, 'LST.TXT', { create: true });
    const file = await orElse(ctx.rnPrinter, null);
    if (file) await writeAt(file, file.size, Uint8Array.of(c));
    else delete ctx.rnPrinter;
  },

  // Nowhere to punch to.
  [NABU.MSG_RN_PUNCH]: async ctx => {
    await u8(ctx);
  },

  // TCP isn't available from a web page, so connections always fail.
  [NABU.MSG_RN_TCP_OPEN]: async ctx => {
    const host = await string(ctx);
    const port = await u16(ctx);
    await u8(ctx);
    status(ctx, host, `TCP connection to ${host}:${port} isn't supported`);
    return reply(ctx, 0xff);
  },

  [NABU.MSG_RN_TCP_CLOSE]: async ctx => {
    await u8(ctx);
  },

  [NABU.MSG_RN_TCP_AVAILABLE]: async ctx => {
    await u8(ctx);
    return reply(ctx, le32(-1));
  },

  [NABU.MSG_RN_TCP_READ]: async ctx => {
    await u8(ctx);
    await u16(ctx);
    return reply(ctx, le32(-1));
  },

  [NABU.MSG_RN_TCP_WRITE]: async ctx => {
    await u8(ctx);
    await bytes(ctx, await u16(ctx));
    return reply(ctx, le32(-1));
  },

  // Nor is the IA's TCP server, so nobody's ever connected to it.
  [NABU.MSG_RN_SERVER_CLIENTS]: ctx => reply(ctx, 0),

  [NABU.MSG_RN_SERVER_AVAILABLE]: ctx => reply(ctx, 0),

  [NABU.MSG_RN_SERVER_READ]: async ctx => {
    await u8(ctx);
    return reply(ctx, 0);
  },

  [NABU.MSG_RN_SERVER_WRITE]: async ctx => {
    await bytes(ctx, await u8(ctx));
  },

  // Only the log message is known; other subcommands' replies aren't.
  [NABU.MSG_RN_IA_CONTROL]: async ctx => {
    const sub = await u8(ctx);
    if (sub !== NABU.RN_IA_LOG) throw new Error(`unsupported IA control subcommand ${sub}`);
    const text = await string(ctx);
    status(ctx, null, `NABU says: ${text}`);
  },
};
