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

// Storage for the files and directories the NABU uses, shared by the
// protocols that give it a file system (NHACP and RetroNET).
//
// A storage addresses everything by URL (the channel's directory plus the
// name the NABU asked for) and provides:
//
//   openFile(url, { create, exclusive }) -> { file, created }
//   openDirectory(url)                   -> resolves if it's a directory
//   list(url)                            -> [{ name, dir, size, mtime }]
//   remove(url, { directory })
//   rename(fromUrl, toUrl)
//   mkdir(url)
//
// and files with size, mtime, read(offset, length), write(offset, bytes)
// and setSize(size), any of which may return a promise. Failures are
// StorageErrors, whose code is a POSIX-style name ('ENOENT', 'EEXIST',
// 'EISDIR', 'ENOTDIR', 'ENOTEMPTY', 'EACCES', 'EBUSY', 'ENOSPC', 'EINVAL',
// 'ENOTSUP', 'EIO') that each protocol reports in its own way. Names are
// matched without regard to case, keeping the case they were created with.
//
// MemoryStorage is here; FolderStorage (folder-storage.js) keeps files in a
// local folder, and StorageManager (storage-manager.js) picks between them.

export class StorageError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'StorageError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new StorageError(code, message); };

// A file held in memory. Everything past `size` in the buffer is kept
// zeroed, so growing the file zero-fills it.
export class MemoryFile {
  constructor(bytes = new Uint8Array(0), mtime = new Date()) {
    this.data = bytes;
    this.size = bytes.length;
    this.mtime = mtime;
  }

  // Up to `length` bytes from `offset`; fewer at end-of-file.
  read(offset, length) {
    if (offset >= this.size) return new Uint8Array(0);
    return this.data.slice(offset, Math.min(this.size, offset + length));
  }

  write(offset, bytes) {
    const end = offset + bytes.length;
    this.#reserve(end);
    this.data.set(bytes, offset);
    this.size = Math.max(this.size, end);
    this.mtime = new Date();
  }

  setSize(size) {
    if (size < this.size) {
      this.data.fill(0, size, this.size);
    }
    else {
      this.#reserve(size);
    }
    this.size = size;
    this.mtime = new Date();
  }

  #reserve(length) {
    if (length <= this.data.length) return;
    const data = new Uint8Array(Math.max(length, this.data.length * 2));
    data.set(this.data.subarray(0, this.size));
    this.data = data;
  }
}

const INDEX = 'index.json';

const trimSlash = url => url.replace(/\/+$/, '');
const parentOf = url => url.slice(0, url.lastIndexOf('/'));
const nameOf = url => url.slice(url.lastIndexOf('/') + 1);
const keyOf = url => trimSlash(url).toLowerCase();

// The top of a URL (scheme and host, or something that isn't a URL), above
// which there's nothing to look up.
const isTop = url => {
  try {
    const { pathname } = new URL(url);
    return pathname === '' || pathname === '/';
  }
  catch {
    return true;
  }
};

const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

// Files come from the web server the first time they're opened, and are
// then kept in memory, where the NABU can change them. Changes last until
// the page is reloaded.
//
// Web servers can't list directories, so a directory is described by an
// index.json in it (see make-index.py in the catalog). Where there's no
// index, as in most channel directories, files are simply fetched by the
// name asked for.
export class MemoryStorage {
  // What's changed, by lowercased URL:
  //   { type: 'file', url, file: Promise<MemoryFile> }  opened or created
  //   { type: 'file', url, source, size, mtime }        renamed, not yet opened
  //   { type: 'dir', url }                              created
  //   { type: 'deleted' }                               removed or renamed away
  #changes = new Map();

  // Directory listings from index.json, by lowercased URL:
  // Promise<Map<lowercased name, entry> | null>
  #indexes = new Map();

  async openFile(url, { create = false, exclusive = false } = {}) {
    url = trimSlash(url);
    const node = await this.#lookup(url);
    if (node?.type === 'dir') fail('EISDIR', `${url} is a directory`);

    if (node) {
      // An unindexed file may or may not exist; fetching it finds out.
      let file;
      try {
        file = await this.#load(node);
      }
      catch (e) {
        if (!(node.unindexed && create && e.code === 'ENOENT')) throw e;
      }
      if (file) {
        if (create && exclusive) fail('EEXIST', `${url} already exists`);
        return { file, created: false };
      }
    }
    else if (!create) {
      fail('ENOENT', `${url} not found`);
    }

    // Create it, along with any missing directories on the way.
    await this.#ensureDirectory(parentOf(url));
    const file = new MemoryFile();
    this.#changes.set(keyOf(url), { type: 'file', url, file: Promise.resolve(file) });
    return { file, created: true };
  }

  async openDirectory(url) {
    url = trimSlash(url);
    const node = await this.#lookup(url);
    if (node?.type === 'dir') return;
    if (node && !node.unindexed) fail('ENOTDIR', `${url} is not a directory`);
    fail('ENOENT', `${url} not found`);
  }

  async list(url) {
    url = trimSlash(url);
    await this.openDirectory(url);
    const node = await this.#lookup(url);

    const entries = new Map(await this.#index(node.url) ?? []);
    const key = keyOf(node.url);
    for (const [changeKey, change] of this.#changes) {
      if (parentOf(changeKey) !== key) continue;
      const nameKey = nameOf(changeKey);
      if (change.type === 'deleted') {
        entries.delete(nameKey);
      }
      else if (change.type === 'dir') {
        entries.set(nameKey, { name: nameOf(change.url), dir: true, size: 0, mtime: new Date() });
      }
      else {
        // A file that failed to load was never really there.
        const file = change.file ? await change.file.catch(() => null) : change;
        if (file) entries.set(nameKey, { name: nameOf(change.url), dir: false, size: file.size, mtime: file.mtime });
      }
    }
    return [...entries.values()].sort(byName);
  }

  async remove(url, { directory = false } = {}) {
    url = trimSlash(url);
    const node = await this.#lookup(url);
    if (!node) fail('ENOENT', `${url} not found`);
    if (directory) {
      if (node.type !== 'dir') fail('ENOTDIR', `${url} is not a directory`);
      if ((await this.list(url)).length) fail('ENOTEMPTY', `${url} is not empty`);
    }
    else {
      if (node.type === 'dir') fail('EISDIR', `${url} is a directory`);
      if (node.unindexed) await this.#load(node);
    }
    this.#changes.set(keyOf(url), { type: 'deleted' });
  }

  async rename(fromUrl, toUrl) {
    fromUrl = trimSlash(fromUrl);
    toUrl = trimSlash(toUrl);
    const from = await this.#lookup(fromUrl);
    if (!from) fail('ENOENT', `${fromUrl} not found`);
    if (from.type === 'dir') fail('ENOTSUP', 'renaming directories is not supported');
    if (from.unindexed) await this.#load(from);

    // Renaming onto an existing file replaces it; onto a directory, no.
    if (keyOf(fromUrl) !== keyOf(toUrl)) {
      const to = await this.#lookup(toUrl);
      if (to?.type === 'dir') fail('EISDIR', `${toUrl} is a directory`);
    }
    await this.#ensureDirectory(parentOf(toUrl));

    const change = this.#changes.get(keyOf(from.url));
    const moved = change?.file ?
      { type: 'file', url: toUrl, file: change.file } :
      { type: 'file', url: toUrl, source: change?.source ?? from.url, size: from.size, mtime: from.mtime };
    this.#changes.set(keyOf(from.url), { type: 'deleted' });
    this.#changes.set(keyOf(toUrl), moved);
  }

  async mkdir(url) {
    url = trimSlash(url);
    const node = await this.#lookup(url);
    if (node && !node.unindexed) fail('EEXIST', `${url} already exists`);
    await this.#ensureDirectory(parentOf(url));
    this.#changes.set(keyOf(url), { type: 'dir', url });
  }

  // What's at `url`, or null: { type: 'file' | 'dir', url (as stored) },
  // plus size and mtime when known. `unindexed` means a file that isn't in
  // any listing, so whether it exists isn't known until it's fetched.
  async #lookup(url) {
    const change = this.#changes.get(keyOf(url));
    if (change) return change.type === 'deleted' ? null : change;
    if (isTop(url)) return { type: 'dir', url };

    // Find the parent first, for the real case of its name.
    const parentNode = await this.#lookup(parentOf(url));
    if (!parentNode || (parentNode.type === 'file' && !parentNode.unindexed)) return null;
    const parent = parentNode.url;
    const name = nameOf(url);

    const siblings = parentNode.type === 'dir' ? await this.#index(parent) : null;
    if (siblings) {
      const entry = siblings.get(name.toLowerCase());
      if (!entry) return null;
      return { type: entry.dir ? 'dir' : 'file', url: `${parent}/${entry.name}`, size: entry.size, mtime: entry.mtime };
    }

    // No listing to go by. It's a directory if it has its own index.
    const path = `${parent}/${name}`;
    if (await this.#index(path)) return { type: 'dir', url: path };
    return { type: 'file', url: path, unindexed: true };
  }

  // The MemoryFile for a file, fetched the first time.
  async #load(node) {
    const key = keyOf(node.url);
    let change = this.#changes.get(key);
    if (!change?.file) {
      const pending = fetchFile(change?.source ?? node.url);
      change = { type: 'file', url: node.url, file: pending };
      this.#changes.set(key, change);
      // Don't remember failures; the file may appear or be created later.
      pending.catch(() => {
        if (this.#changes.get(key) === change) this.#changes.delete(key);
      });
    }
    return change.file;
  }

  async #ensureDirectory(url) {
    const node = await this.#lookup(url);
    // An unindexed path might be a plain directory on the web server.
    if (node?.type === 'dir' || node?.unindexed) return;
    if (node) fail('ENOTDIR', `${url} is not a directory`);
    await this.#ensureDirectory(parentOf(url));
    this.#changes.set(keyOf(url), { type: 'dir', url });
  }

  // A directory's index.json, if it has one, fetched once.
  #index(url) {
    const key = keyOf(url);
    if (!this.#indexes.has(key)) this.#indexes.set(key, fetchIndex(url));
    return this.#indexes.get(key);
  }
}

const fetchIndex = async url => {
  let response;
  try {
    response = await fetch(`${url}/${INDEX}`);
  }
  catch {
    return null;
  }
  if (!response.ok) return null;

  let entries;
  try {
    ({ entries } = JSON.parse(new TextDecoder().decode(await response.arrayBuffer())));
  }
  catch {
    return null;
  }
  return new Map(entries.map(e => [e.name.toLowerCase(), {
    name: e.name,
    dir: Boolean(e.dir),
    size: e.size ?? 0,
    mtime: e.mtime ? new Date(e.mtime) : new Date(),
  }]));
};

const fetchFile = async url => {
  let response;
  try {
    response = await fetch(url);
  }
  catch (e) {
    throw new StorageError('EIO', `fetch ${url}: ${e.message}`);
  }
  if (response.status === 404) {
    throw new StorageError('ENOENT', `${url} not found`);
  }
  if (!response.ok) {
    throw new StorageError('EIO', `fetch ${url}: ${response.status}`);
  }

  const lastModified = response.headers?.get?.('Last-Modified');
  const mtime = lastModified ? new Date(lastModified) : new Date();
  return new MemoryFile(new Uint8Array(await response.arrayBuffer()), mtime);
};
