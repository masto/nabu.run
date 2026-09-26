// A small in-memory stand-in for the File System Access API's directory
// and file handles, enough for the folder storage. Names are
// case-sensitive, as on Linux, so case-insensitive matching gets tested.

let clock = 1000;

const notFound = name => new DOMException(`${name} not found`, 'NotFoundError');
const mismatch = name => new DOMException(`${name} is the wrong kind`, 'TypeMismatchError');

class FakeWritable {
  #file;
  #data;

  constructor(file, keep) {
    this.#file = file;
    this.#data = keep ? file.data.slice() : new Uint8Array(0);
  }

  async write(chunk) {
    let position = 0;
    let data = chunk;
    if (chunk?.type === 'write') ({ position = 0, data } = chunk);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    const out = new Uint8Array(Math.max(this.#data.length, position + bytes.length));
    out.set(this.#data);
    out.set(bytes, position);
    this.#data = out;
  }

  async close() {
    this.#file.data = this.#data;
    this.#file.lastModified = ++clock;
    this.#file.writes++;
  }
}

export class FakeFile {
  kind = 'file';

  constructor(name, parent, data = new Uint8Array(0)) {
    this.name = name;
    this.parent = parent;
    this.data = data;
    this.lastModified = ++clock;
    this.writes = 0;
  }

  async getFile() {
    const data = this.data;
    return {
      name: this.name,
      size: data.length,
      lastModified: this.lastModified,
      arrayBuffer: async () => data.slice().buffer,
    };
  }

  async createWritable({ keepExistingData = false } = {}) {
    return new FakeWritable(this, keepExistingData);
  }

  async move(dir, name) {
    if (typeof dir === 'string') throw new DOMException('not allowed', 'NotAllowedError');
    this.parent.children.delete(this.name);
    this.name = name;
    this.parent = dir;
    dir.children.set(name, this);
  }

  async isSameEntry(other) {
    return other === this;
  }

  // Test helper: change the file behind the storage's back.
  touch(text) {
    this.data = new TextEncoder().encode(text);
    this.lastModified = ++clock;
  }

  text() {
    return new TextDecoder().decode(this.data);
  }
}

export class FakeDirectory {
  kind = 'directory';
  children = new Map();

  constructor(name = 'root', parent = null) {
    this.name = name;
    this.parent = parent;
  }

  async getFileHandle(name, { create = false } = {}) {
    const entry = this.children.get(name);
    if (entry?.kind === 'directory') throw mismatch(name);
    if (entry) return entry;
    if (!create) throw notFound(name);
    const file = new FakeFile(name, this);
    this.children.set(name, file);
    return file;
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    const entry = this.children.get(name);
    if (entry?.kind === 'file') throw mismatch(name);
    if (entry) return entry;
    if (!create) throw notFound(name);
    const dir = new FakeDirectory(name, this);
    this.children.set(name, dir);
    return dir;
  }

  async removeEntry(name, { recursive = false } = {}) {
    const entry = this.children.get(name);
    if (!entry) throw notFound(name);
    if (entry.kind === 'directory' && entry.children.size && !recursive) {
      throw new DOMException(`${name} is not empty`, 'InvalidModificationError');
    }
    this.children.delete(name);
  }

  async *entries() {
    for (const entry of [...this.children]) yield entry;
  }

  async *keys() {
    for (const name of [...this.children.keys()]) yield name;
  }

  async *values() {
    for (const entry of [...this.children.values()]) yield entry;
  }

  async isSameEntry(other) {
    return other === this;
  }

  async queryPermission() {
    return 'granted';
  }

  async requestPermission() {
    return 'granted';
  }

  // Test helpers.

  // Add files from { 'A0/ASM.COM': 'contents', ... }.
  add(files) {
    for (const [path, text] of Object.entries(files)) {
      const parts = path.split('/');
      const name = parts.pop();
      let dir = this;
      for (const part of parts) {
        if (!dir.children.has(part)) dir.children.set(part, new FakeDirectory(part, dir));
        dir = dir.children.get(part);
      }
      dir.children.set(name, new FakeFile(name, dir, new TextEncoder().encode(text)));
    }
    return this;
  }

  // The entry at a path, or undefined.
  at(path) {
    let entry = this;
    for (const part of path.split('/').filter(p => p)) {
      entry = entry?.children?.get(part);
    }
    return entry;
  }

  // Every file under this directory, as { path: text }.
  tree(prefix = '') {
    const out = {};
    for (const [name, entry] of this.children) {
      if (entry.kind === 'file') out[prefix + name] = entry.text();
      else Object.assign(out, entry.tree(`${prefix}${name}/`));
    }
    return out;
  }
}
