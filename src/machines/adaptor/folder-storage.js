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

// NHACP storage in a folder on the user's computer, through the File System
// Access API. Implements the interface described in nhacp-storage.js.

import * as NABU from './constants';
import { MemoryFile, NhacpError } from './nhacp-storage';

const fail = (code, message) => { throw new NhacpError(code, message); };

// File System Access errors as NHACP errors.
const nhacpError = (e, what) => {
  if (e instanceof NhacpError) return e;
  const code = {
    NotFoundError: NABU.NHACP_ERROR_ENOENT,
    TypeMismatchError: NABU.NHACP_ERROR_ENOTDIR,
    NotAllowedError: NABU.NHACP_ERROR_EACCES,
    SecurityError: NABU.NHACP_ERROR_EACCES,
    InvalidModificationError: NABU.NHACP_ERROR_ENOTEMPTY,
    NoModificationAllowedError: NABU.NHACP_ERROR_EBUSY,
    QuotaExceededError: NABU.NHACP_ERROR_ENOSPC,
  }[e?.name] ?? NABU.NHACP_ERROR_EIO;
  const error = new NhacpError(code, `${what}: ${e?.name ?? 'Error'}: ${e?.message ?? e}`);
  error.cause = e;
  return error;
};

// How long to wait after the last change before writing a file back.
// Writing into a file on disk rewrites all of it, so a burst of small
// writes (CP/M writes 128 bytes at a time) is gathered up first.
export const FLUSH_DELAY = 250;

// A file in the folder, held in memory while it's in use and written back
// shortly after it changes, when it's closed, or when flush() is called.
export class FolderFile extends MemoryFile {
  #timer = null;
  #flushing = Promise.resolve();

  constructor(handle, bytes, mtime) {
    super(bytes, mtime);
    this.handle = handle;
    this.dirty = false;
    this.onError = null;
  }

  write(offset, bytes) {
    super.write(offset, bytes);
    this.#changed();
  }

  setSize(size) {
    super.setSize(size);
    this.#changed();
  }

  #changed() {
    this.dirty = true;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.flush().catch(e => this.onError?.(e));
    }, FLUSH_DELAY);
  }

  flush() {
    clearTimeout(this.#timer);
    this.#timer = null;
    // One write at a time, and always the latest contents.
    this.#flushing = this.#flushing.catch(() => { }).then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      try {
        const writable = await this.handle.createWritable();
        await writable.write(this.data.slice(0, this.size));
        await writable.close();
        // It's what we wrote, so there's no need to read it back.
        this.loadedAt = (await this.handle.getFile()).lastModified;
      }
      catch (e) {
        this.dirty = true;
        throw nhacpError(e, `write ${this.handle.name}`);
      }
    });
    return this.#flushing;
  }

  close() {
    return this.flush();
  }

  // Forget unwritten changes, for a file that's been removed.
  discard() {
    clearTimeout(this.#timer);
    this.dirty = false;
  }
}

const trimSlash = url => url.replace(/\/+$/, '');
const lower = s => s.toLowerCase();

// An entry in `dir` whose name matches without regard to case.
const findEntry = async (dir, name) => {
  for await (const [entryName, handle] of dir.entries()) {
    if (lower(entryName) === lower(name)) return handle;
  }
  return null;
};

export class FolderStorage {
  #root;
  #rootUrl;
  #files = new Map(); // lowercased path -> FolderFile

  // `root` is the channel's folder, standing in for `rootUrl`.
  constructor(root, rootUrl) {
    this.#root = root;
    this.#rootUrl = trimSlash(rootUrl);
    this.onError = null;
  }

  // Whether `url` is somewhere in this folder.
  contains(url) {
    const u = trimSlash(url);
    return u === this.#rootUrl || u.startsWith(`${this.#rootUrl}/`);
  }

  async openFile(url, { create = false, exclusive = false } = {}) {
    const parts = this.#parts(url);
    if (!parts.length) fail(NABU.NHACP_ERROR_EISDIR, `${url} is a directory`);
    const name = parts.pop();
    try {
      const dir = await this.#dir(parts, create);
      if (!dir) fail(NABU.NHACP_ERROR_ENOENT, `${url} not found`);

      const existing = await findEntry(dir, name);
      if (existing?.kind === 'directory') fail(NABU.NHACP_ERROR_EISDIR, `${url} is a directory`);
      if (existing && create && exclusive) fail(NABU.NHACP_ERROR_EEXIST, `${url} already exists`);
      if (!existing && !create) fail(NABU.NHACP_ERROR_ENOENT, `${url} not found`);

      const handle = existing ?? await dir.getFileHandle(name, { create: true });
      const file = await this.#load([...parts, handle.name], handle);
      return { file, created: !existing };
    }
    catch (e) {
      throw nhacpError(e, `open ${url}`);
    }
  }

  async openDirectory(url) {
    try {
      const dir = await this.#dir(this.#parts(url), false);
      if (!dir) fail(NABU.NHACP_ERROR_ENOENT, `${url} not found`);
    }
    catch (e) {
      throw nhacpError(e, `open ${url}`);
    }
  }

  async list(url) {
    const parts = this.#parts(url);
    try {
      const dir = await this.#dir(parts, false);
      if (!dir) fail(NABU.NHACP_ERROR_ENOENT, `${url} not found`);
      const entries = [];
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') {
          entries.push({ name, dir: true, size: 0, mtime: new Date() });
          continue;
        }
        // Prefer what's in memory, which may not be written yet.
        const open = this.#files.get(lower([...parts, name].join('/')));
        if (open) {
          entries.push({ name, dir: false, size: open.size, mtime: open.mtime });
        }
        else {
          const file = await handle.getFile();
          entries.push({ name, dir: false, size: file.size, mtime: new Date(file.lastModified) });
        }
      }
      return entries.sort((a, b) => lower(a.name).localeCompare(lower(b.name)));
    }
    catch (e) {
      throw nhacpError(e, `list ${url}`);
    }
  }

  async remove(url, { directory = false } = {}) {
    const parts = this.#parts(url);
    if (!parts.length) fail(NABU.NHACP_ERROR_EACCES, 'can\'t remove the top-level directory');
    const name = parts.pop();
    try {
      const dir = await this.#dir(parts, false);
      const entry = dir && await findEntry(dir, name);
      if (!entry) fail(NABU.NHACP_ERROR_ENOENT, `${url} not found`);
      if (directory && entry.kind !== 'directory') fail(NABU.NHACP_ERROR_ENOTDIR, `${url} is not a directory`);
      if (!directory && entry.kind === 'directory') fail(NABU.NHACP_ERROR_EISDIR, `${url} is a directory`);

      const key = lower([...parts, entry.name].join('/'));
      this.#files.get(key)?.discard();
      this.#files.delete(key);
      await dir.removeEntry(entry.name);
    }
    catch (e) {
      throw nhacpError(e, `remove ${url}`);
    }
  }

  async rename(fromUrl, toUrl) {
    const fromParts = this.#parts(fromUrl);
    const toParts = this.#parts(toUrl);
    if (!fromParts.length || !toParts.length) fail(NABU.NHACP_ERROR_EINVAL, 'bad name');
    const fromName = fromParts.pop();
    const toName = toParts.pop();
    try {
      const fromDir = await this.#dir(fromParts, false);
      const entry = fromDir && await findEntry(fromDir, fromName);
      if (!entry) fail(NABU.NHACP_ERROR_ENOENT, `${fromUrl} not found`);
      if (entry.kind === 'directory') fail(NABU.NHACP_ERROR_ENOTSUP, 'renaming directories is not supported');

      const toDir = await this.#dir(toParts, true);
      const fromKey = lower([...fromParts, entry.name].join('/'));
      const toKey = lower([...toParts, toName].join('/'));

      // Renaming onto another file replaces it; onto a directory, no.
      if (fromKey !== toKey) {
        const existing = await findEntry(toDir, toName);
        if (existing?.kind === 'directory') fail(NABU.NHACP_ERROR_EISDIR, `${toUrl} is a directory`);
        if (existing) {
          this.#files.get(toKey)?.discard();
          this.#files.delete(toKey);
          await toDir.removeEntry(existing.name);
        }
      }

      // Write out any changes first, so they go with it.
      const open = this.#files.get(fromKey);
      await open?.flush();
      await entry.move(toDir, toName);
      if (open) {
        this.#files.delete(fromKey);
        this.#files.set(toKey, open);
      }
    }
    catch (e) {
      throw nhacpError(e, `rename ${fromUrl}`);
    }
  }

  async mkdir(url) {
    const parts = this.#parts(url);
    if (!parts.length) fail(NABU.NHACP_ERROR_EEXIST, `${url} already exists`);
    const name = parts.pop();
    try {
      const dir = await this.#dir(parts, true);
      if (await findEntry(dir, name)) fail(NABU.NHACP_ERROR_EEXIST, `${url} already exists`);
      await dir.getDirectoryHandle(name, { create: true });
    }
    catch (e) {
      throw nhacpError(e, `mkdir ${url}`);
    }
  }

  // Write out everything that's changed.
  async flush() {
    await Promise.all([...this.#files.values()].map(f => f.flush()));
  }

  get dirty() {
    return [...this.#files.values()].some(f => f.dirty);
  }

  // The path of `url` under the root, as a list of names.
  #parts(url) {
    if (!this.contains(url)) fail(NABU.NHACP_ERROR_ENOENT, `${url} is outside the folder`);
    const rest = trimSlash(url).slice(this.#rootUrl.length);
    return rest.split('/').filter(p => p);
  }

  // The directory at `parts`, created if asked, or null if it isn't there.
  async #dir(parts, create) {
    let dir = this.#root;
    for (const name of parts) {
      const entry = await findEntry(dir, name);
      if (entry?.kind === 'file') fail(NABU.NHACP_ERROR_ENOTDIR, `${name} is not a directory`);
      if (entry) dir = entry;
      else if (create) dir = await dir.getDirectoryHandle(name, { create: true });
      else return null;
    }
    return dir;
  }

  // The FolderFile for a file, reusing the one in memory unless the file
  // was changed outside nabu.run since it was read.
  async #load(parts, handle) {
    const key = lower(parts.join('/'));
    const disk = await handle.getFile();
    const open = this.#files.get(key);
    if (open && (open.dirty || disk.lastModified <= open.loadedAt)) return open;

    const file = new FolderFile(handle, new Uint8Array(await disk.arrayBuffer()), new Date(disk.lastModified));
    file.loadedAt = disk.lastModified;
    file.onError = e => this.onError?.(e);
    this.#files.set(key, file);
    return file;
  }
}

// Copy a channel's files into `dir`, following the index.json in each of
// its directories (see make-index.py in the catalog). Files that are
// already there are left alone, so an interrupted copy can be resumed.
// `onProgress` gets { done, total } in bytes. `skip` lists top-level files
// not to copy.
export async function copyChannel(sourceUrl, dir, onProgress = () => { }, { skip = [] } = {}) {
  const skipped = new Set(skip.map(name => `/${name}`.toLowerCase()));
  const base = trimSlash(sourceUrl);

  // Find everything first, to report progress.
  const files = [];
  const walk = async (path) => {
    const response = await fetch(`${base}${path}/index.json`);
    if (!response.ok) throw new Error(`fetch ${base}${path}/index.json: ${response.status}`);
    const { entries } = JSON.parse(new TextDecoder().decode(await response.arrayBuffer()));
    for (const e of entries) {
      if (e.dir) await walk(`${path}/${e.name}`);
      else if (!skipped.has(`${path}/${e.name}`.toLowerCase())) files.push({ path: `${path}/${e.name}`, size: e.size ?? 0 });
    }
  };
  await walk('');

  const total = files.reduce((n, f) => n + f.size, 0);
  let done = 0;
  onProgress({ done, total });

  const copy = async ({ path, size }) => {
    const parts = path.split('/').filter(p => p);
    const name = parts.pop();
    let target = dir;
    for (const part of parts) target = await target.getDirectoryHandle(part, { create: true });
    if (!await findEntry(target, name)) {
      const response = await fetch(`${base}${path.split('/').map(encodeURIComponent).join('/')}`);
      if (!response.ok) throw new Error(`fetch ${base}${path}: ${response.status}`);
      const data = new Uint8Array(await response.arrayBuffer());
      const handle = await target.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
    }
    done += size;
    onProgress({ done, total });
  };

  // A few at a time.
  const queue = [...files];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) await copy(queue.shift());
  }));
}
