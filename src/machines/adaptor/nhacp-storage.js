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

// Storage for files the NABU opens over NHACP.

import * as NABU from './constants';

// Errors that are reported to the NABU as an NHACP ERROR response.
export class NhacpError extends Error {
  constructor(code, message) {
    super(message ?? `NHACP error code ${code}`);
    this.name = 'NhacpError';
    this.code = code;
  }
}

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

// Files are fetched over HTTP the first time they're opened and then kept
// in memory, where the NABU can change them. Changes last until the page
// is reloaded; fetching them again isn't possible, so they're never
// thrown away.
export class MemoryStorage {
  #files = new Map(); // url -> Promise<MemoryFile>

  // Returns { file, created }. Throws ENOENT if the file doesn't exist and
  // `create` isn't set, or EEXIST if it does and `exclusive` is.
  async open(url, { create = false, exclusive = false } = {}) {
    let pending = this.#files.get(url);
    if (!pending) {
      pending = fetchFile(url);
      this.#files.set(url, pending);
      // Don't remember failures; the file may be created or appear later.
      pending.catch(() => {
        if (this.#files.get(url) === pending) this.#files.delete(url);
      });
    }

    let file;
    try {
      file = await pending;
    }
    catch (e) {
      if (!(create && e instanceof NhacpError && e.code === NABU.NHACP_ERROR_ENOENT)) throw e;
      file = new MemoryFile();
      this.#files.set(url, Promise.resolve(file));
      return { file, created: true };
    }

    if (create && exclusive) {
      throw new NhacpError(NABU.NHACP_ERROR_EEXIST, `${url} already exists`);
    }
    return { file, created: false };
  }
}

const fetchFile = async url => {
  let response;
  try {
    response = await fetch(url);
  }
  catch (e) {
    throw new NhacpError(NABU.NHACP_ERROR_EIO, `fetch ${url}: ${e.message}`);
  }
  if (response.status === 404) {
    throw new NhacpError(NABU.NHACP_ERROR_ENOENT, `${url} not found`);
  }
  if (!response.ok) {
    throw new NhacpError(NABU.NHACP_ERROR_EIO, `fetch ${url}: ${response.status}`);
  }

  const lastModified = response.headers?.get?.('Last-Modified');
  const mtime = lastModified ? new Date(lastModified) : new Date();
  return new MemoryFile(new Uint8Array(await response.arrayBuffer()), mtime);
};
