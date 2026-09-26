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

// Decides where the NABU's files live for each NHACP request: in the local
// folder, if the user has chosen one and the current channel can use it,
// otherwise in memory. Implements the storage interface described in
// nhacp-storage.js.
//
// Each channel gets its own subfolder, named after the channel. The first
// time, the channel's files are copied into it; after that it's left alone.

import * as NABU from './constants';
import { MemoryStorage, NhacpError } from './nhacp-storage';
import { FolderStorage, copyChannel } from './folder-storage';

const findEntry = async (dir, name) => {
  for await (const [entryName, handle] of dir.entries()) {
    if (entryName.toLowerCase() === name.toLowerCase()) return handle;
  }
  return null;
};

export class StorageManager {
  #getChannel;
  #copies;
  #memory;
  #root = null;
  #folders = new Map(); // channel id -> Promise<FolderStorage>
  #ready = new Set(); // FolderStorages that have finished preparing
  #listeners = new Set();

  // getChannel: the current channel ({ id, storage, baseUrl, imageDir })
  // copies: remembers each channel's copy, { get(id), set(id, 'copying' | 'done') }
  constructor({ getChannel, copies, memory = new MemoryStorage() }) {
    this.#getChannel = getChannel;
    this.#copies = copies;
    this.#memory = memory;
  }

  get root() {
    return this.#root;
  }

  // Use this folder (a FileSystemDirectoryHandle), or memory if null.
  setRoot(root) {
    if (root === this.#root) return;
    const old = [...this.#folders.values()];
    this.#root = root;
    this.#folders.clear();
    this.#ready.clear();
    // Don't lose anything that was on its way to the old folder.
    for (const folder of old) folder.then(f => f.flush()).catch(() => { });
  }

  // Events: { type: 'progress', channel, progress: { done, total } | null }
  //         { type: 'error', error }  (error.code is EACCES if permission was lost)
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event) {
    for (const listener of this.#listeners) listener(event);
  }

  // Whether this channel's files go in the folder at the moment.
  usesFolder(channel = this.#getChannel()) {
    return Boolean(this.#root && channel?.storage === 'folder' && channel.id);
  }

  // The FolderStorage for a channel, copying its files in first if needed.
  folderFor(channel) {
    const root = this.#root;
    if (!this.#folders.has(channel.id)) {
      const pending = this.#prepare(root, channel);
      this.#folders.set(channel.id, pending);
      pending.then(folder => {
        if (this.#folders.get(channel.id) === pending) this.#ready.add(folder);
      }, e => {
        if (this.#folders.get(channel.id) === pending) this.#folders.delete(channel.id);
        this.#emit({ type: 'progress', channel: channel.id, progress: null });
        this.#emit({ type: 'error', error: e });
      });
    }
    return this.#folders.get(channel.id);
  }

  async #prepare(root, channel) {
    const sourceUrl = `${channel.baseUrl}${channel.imageDir}`;
    const copied = await this.#copies.get(channel.id);
    let dir = await findEntry(root, channel.id);
    if (dir && dir.kind !== 'directory') {
      throw new Error(`"${channel.id}" in the folder isn't a folder`);
    }

    // A new subfolder, or one we didn't finish copying into. One that was
    // already there otherwise is the user's, and isn't touched.
    if (!dir || copied === 'copying') {
      dir ??= await root.getDirectoryHandle(channel.id, { create: true });
      await this.#copies.set(channel.id, 'copying');
      // Progress comes after every file; pass it on a few times a second,
      // which is plenty for a progress display and cheap to render.
      let last = 0;
      await copyChannel(sourceUrl, dir, progress => {
        const now = Date.now();
        if (now - last < 100 && progress.done < progress.total) return;
        last = now;
        this.#emit({ type: 'progress', channel: channel.id, progress });
      }, {
        // The boot image is always served from the channel itself, so a
        // copy in the folder would only mislead.
        skip: channel.imageName ? [channel.imageName] : [],
      });
      await this.#copies.set(channel.id, 'done');
      this.#emit({ type: 'progress', channel: channel.id, progress: null });
    }

    const folder = new FolderStorage(dir, sourceUrl);
    folder.onError = error => this.#emit({ type: 'error', error });
    return folder;
  }

  // The storage for `url`.
  async #pick(url) {
    const channel = this.#getChannel();
    if (!this.usesFolder(channel)) return this.#memory;
    let folder;
    try {
      folder = await this.folderFor(channel);
    }
    catch (e) {
      throw e instanceof NhacpError ? e :
        new NhacpError(NABU.NHACP_ERROR_EIO, `preparing the folder: ${e.message}`);
    }
    return folder.contains(url) ? folder : this.#memory;
  }

  async #run(url, operation) {
    const storage = await this.#pick(url);
    try {
      return await operation(storage);
    }
    catch (e) {
      if (e.code === NABU.NHACP_ERROR_EACCES && storage !== this.#memory) {
        this.#emit({ type: 'error', error: e });
      }
      throw e;
    }
  }

  openFile(url, options) {
    return this.#run(url, s => s.openFile(url, options));
  }

  openDirectory(url) {
    return this.#run(url, s => s.openDirectory(url));
  }

  list(url) {
    return this.#run(url, s => s.list(url));
  }

  remove(url, options) {
    return this.#run(url, s => s.remove(url, options));
  }

  async rename(fromUrl, toUrl) {
    const to = await this.#pick(toUrl);
    return this.#run(fromUrl, from => {
      if (from !== to) {
        throw new NhacpError(NABU.NHACP_ERROR_ENOTSUP, 'can\'t rename between storages');
      }
      return from.rename(fromUrl, toUrl);
    });
  }

  mkdir(url) {
    return this.#run(url, s => s.mkdir(url));
  }

  // Whether anything hasn't been written to the folder yet.
  get dirty() {
    return [...this.#ready].some(folder => folder.dirty);
  }

  // Write out everything that's changed in the folder.
  async flush() {
    const folders = await Promise.allSettled([...this.#folders.values()]);
    await Promise.all(folders.filter(f => f.status === 'fulfilled').map(f => f.value.flush()));
  }
}
