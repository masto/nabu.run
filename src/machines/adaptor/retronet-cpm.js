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

// Cloud CP/M's drives: the RetroNET 0xED commands, which DJ Sures' Cloud
// CP/M BIOS uses for every BDOS file operation. They're described in
// docs/cloud-cpm-protocol.md.
//
// Each drive and user area is a directory in the store (the channel's
// directory): CPM/<drive letter>/<user in hex>/, e.g. CPM/A/0/STAT.COM.
// Files are read and written in 128-byte records.

import { MemoryFile, storageOf } from './storage';
import {
  u8, u16, u32, bytes, le16, reply, status, orElse, storeUrl
} from './retronet';
import * as NABU from './constants';

const RECORD = 128;
const MAX_RC = 0x80;
const NOT_FOUND = 0xff;
const EOF = 0x01;

const cpmOf = ctx => (ctx.rn.cpm ??= { handles: [], search: [] });

const directoryUrl = (ctx, drive, user) =>
  `${storeUrl(ctx)}/CPM/${String.fromCharCode(65 + drive)}/${user.toString(16).toUpperCase()}`;

const records = size => Math.ceil(size / RECORD);

// CP/M's 11-character names (8 + 3, space-padded, no dot) as strings, with
// the attribute bits (the high bits) cleared.
const fromBytes = b => String.fromCharCode(...b.map(c => c & 0x7f)).toUpperCase();

// The CP/M name for a file on disk, or null if it hasn't got one.
const cpmName = name => {
  const m = name.toUpperCase().match(/^([!-~]{1,8}?)(?:\.([!-~]{0,3}))?$/);
  if (!m || m[1].includes('.')) return null;
  return m[1].padEnd(8) + (m[2] ?? '').padEnd(3);
};

// A name for a new file on disk.
const fileName = cpm => {
  const base = cpm.slice(0, 8).trimEnd();
  const ext = cpm.slice(8).trimEnd();
  return ext ? `${base}.${ext}` : base;
};

const shown = (drive, user, cpm) => `${String.fromCharCode(65 + drive)}${user}:${fileName(cpm)}`;

const matches = (pattern, cpm) => [...pattern].every((c, i) => c === '?' || c === cpm[i]);

// The files in a drive and user area that CP/M can see, as
// { name, size, cpm }. A directory that isn't there is empty.
const filesIn = async (ctx, drive, user) => {
  const entries = await orElse(storageOf(ctx).list(directoryUrl(ctx, drive, user)), []);
  const seen = new Set();
  return entries.flatMap(e => {
    const cpm = !e.dir && e.name !== 'index.json' && cpmName(e.name);
    if (!cpm || seen.has(cpm)) return [];
    seen.add(cpm);
    return [{ name: e.name, size: e.size, cpm }];
  });
};

const findFile = async (ctx, drive, user, cpm) =>
  (await filesIn(ctx, drive, user)).find(f => f.cpm === cpm);

// Handles start at 1.
const assignHandle = (ctx, value) => {
  const { handles } = cpmOf(ctx);
  let fh = 1;
  while (handles[fh]) fh++;
  if (fh >= NOT_FOUND) return NOT_FOUND;
  handles[fh] = value;
  return fh;
};

const handleOf = (ctx, fh) => cpmOf(ctx).handles[fh] ?? { name: `(handle ${fh})`, file: new MemoryFile() };

const closeHandle = async (ctx, fh) => {
  const { handles } = cpmOf(ctx);
  const handle = handles[fh];
  delete handles[fh];
  await orElse(handle?.file.close?.());
  return handle;
};

// A search result: a 32-byte directory entry, then the rest of the
// 128-byte sector as unused (E5) entries.
const directoryEntry = file => {
  const sector = new Uint8Array(RECORD).fill(0xe5);
  sector.fill(0, 0, 32);
  for (let i = 0; i < 11; i++) sector[1 + i] = file.cpm.charCodeAt(i);
  sector[15] = Math.min(records(file.size), MAX_RC);
  return sector;
};

const nextFound = ctx => {
  const file = cpmOf(ctx).search.shift();
  return file ? reply(ctx, 0, directoryEntry(file)) : reply(ctx, NOT_FOUND);
};

const location = async ctx => {
  const drive = await u8(ctx);
  const user = await u8(ctx);
  const cpm = fromBytes(await bytes(ctx, 11));
  return { drive, user, cpm, where: shown(drive, user, cpm) };
};

const subcommands = {
  [NABU.RN_CPM_OPEN]: async ctx => {
    const { drive, user, cpm, where } = await location(ctx);
    const found = await findFile(ctx, drive, user, cpm);
    const url = found && `${directoryUrl(ctx, drive, user)}/${found.name}`;
    const file = url && await orElse(storageOf(ctx).openFile(url).then(r => r.file), null);
    const fh = file ? assignHandle(ctx, { name: where, file }) : NOT_FOUND;
    if (fh === NOT_FOUND) {
      await orElse(file?.close?.());
      status(ctx, where, `CP/M open ${where}: not found`);
      return reply(ctx, NOT_FOUND, 0);
    }
    status(ctx, where, `CP/M open ${where} = ${fh}`);
    return reply(ctx, fh, Math.min(records(file.size), MAX_RC));
  },

  [NABU.RN_CPM_CREATE]: async ctx => {
    const { drive, user, cpm, where } = await location(ctx);
    // Keep the name of a file that's already there, whatever its case.
    const existing = await findFile(ctx, drive, user, cpm);
    const url = `${directoryUrl(ctx, drive, user)}/${existing?.name ?? fileName(cpm)}`;
    const file = await orElse(storageOf(ctx).openFile(url, { create: true }).then(r => r.file), null);
    if (file) await file.setSize(0);
    const fh = file ? assignHandle(ctx, { name: where, file }) : NOT_FOUND;
    status(ctx, where, `CP/M create ${where} = ${fh}`);
    return reply(ctx, fh);
  },

  [NABU.RN_CPM_DELETE]: async ctx => {
    const { drive, user, cpm, where } = await location(ctx);
    const doomed = (await filesIn(ctx, drive, user)).filter(f => matches(cpm, f.cpm));
    for (const f of doomed) {
      await orElse(storageOf(ctx).remove(`${directoryUrl(ctx, drive, user)}/${f.name}`));
    }
    status(ctx, where, `CP/M delete ${where}: ${doomed.length}`);
  },

  [NABU.RN_CPM_RENAME]: async ctx => {
    const { drive, user, cpm, where } = await location(ctx);
    const to = fromBytes(await bytes(ctx, 11));
    const found = await findFile(ctx, drive, user, cpm);
    const dir = directoryUrl(ctx, drive, user);
    if (found) await orElse(storageOf(ctx).rename(`${dir}/${found.name}`, `${dir}/${fileName(to)}`));
    status(ctx, where, `CP/M rename ${where} to ${fileName(to)}`);
  },

  [NABU.RN_CPM_SIZE]: async ctx => {
    const { drive, user, cpm, where } = await location(ctx);
    const found = await findFile(ctx, drive, user, cpm);
    const size = found ? records(found.size) : 0;
    status(ctx, where, `CP/M size ${where} = ${size}`);
    return reply(ctx, le16(size));
  },

  [NABU.RN_CPM_READ]: async ctx => {
    const fh = await u8(ctx);
    const record = await u16(ctx);
    const { name, file } = handleOf(ctx, fh);
    const data = new Uint8Array(await file.read(record * RECORD, RECORD));
    status(ctx, name, `CP/M read ${name} record ${record}`,
      { total: records(file.size), complete: record + 1 });
    if (!data.length) return reply(ctx, EOF);
    // A short last record is padded with CP/M's end-of-file character.
    const sector = new Uint8Array(RECORD).fill(0x1a);
    sector.set(data);
    return reply(ctx, 0, sector);
  },

  [NABU.RN_CPM_WRITE]: async ctx => {
    const fh = await u8(ctx);
    const record = await u16(ctx);
    const data = await bytes(ctx, RECORD);
    const { name, file } = handleOf(ctx, fh);
    await file.write(record * RECORD, data);
    status(ctx, name, `CP/M write ${name} record ${record}`);
  },

  [NABU.RN_CPM_SEARCH_FIRST]: async ctx => {
    const { drive, user, cpm, where } = await location(ctx);
    const found = (await filesIn(ctx, drive, user)).filter(f => matches(cpm, f.cpm));
    cpmOf(ctx).search = found;
    status(ctx, where, `CP/M search ${where}: ${found.length}`);
    return nextFound(ctx);
  },

  [NABU.RN_CPM_SEARCH_NEXT]: ctx => nextFound(ctx),

  // Never seen from the real BIOS, so what it should do isn't known. The
  // BIOS sends a handle and the FCB's record count.
  [NABU.RN_CPM_SET_SIZE]: async ctx => {
    const fh = await u8(ctx);
    const rc = await u8(ctx);
    status(ctx, null, `CP/M subcommand 13 (${fh}, ${rc}) ignored`);
  },

  [NABU.RN_CPM_CLOSE]: async ctx => {
    const fh = await u8(ctx);
    const handle = await closeHandle(ctx, fh);
    status(ctx, handle?.name, `CP/M close ${handle?.name ?? fh}`);
  },

  [NABU.RN_CPM_READ_BULK]: async ctx => {
    const fh = await u8(ctx);
    const offset = await u32(ctx);
    const length = await u16(ctx);
    const { name, file } = handleOf(ctx, fh);
    const data = new Uint8Array(await file.read(offset, length));
    status(ctx, name, `CP/M load ${name}: ${data.length} bytes`);
    return reply(ctx, le16(data.length), data);
  },

  [NABU.RN_CPM_RESET]: async ctx => {
    const { handles } = cpmOf(ctx);
    for (const fh of Object.keys(handles)) await closeHandle(ctx, Number(fh));
    cpmOf(ctx).search = [];
    status(ctx, null, 'CP/M reset');
  },
};

// Handlers by message, which protocol.js makes into states.
export const cloudCpmHandlers = {
  [NABU.MSG_RN_CPM]: async ctx => {
    const sub = await u8(ctx);
    const handler = subcommands[sub];
    if (!handler) throw new Error(`unknown Cloud CP/M subcommand ${sub}`);
    return handler(ctx);
  },
};
