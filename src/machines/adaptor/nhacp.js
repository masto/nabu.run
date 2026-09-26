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

// Handlers for the NHACP protocol, version 0.1.
// Spec: https://github.com/NHACP-IF/NHACP-specification

import { invoke, transition } from 'robot3';
import { baseName, bytesToString } from './util';

import { resetOnError, getBytes } from './common';
import { MemoryStorage, NhacpError } from './nhacp-storage';
import * as NABU from './constants';

const ADAPTER_ID = 'nabu.run';

const errorNames = {
  [NABU.NHACP_ERROR_UNDEFINED]: 'undefined error',
  [NABU.NHACP_ERROR_ENOTSUP]: 'operation not supported',
  [NABU.NHACP_ERROR_EPERM]: 'operation not permitted',
  [NABU.NHACP_ERROR_ENOENT]: 'no such file',
  [NABU.NHACP_ERROR_EIO]: 'input/output error',
  [NABU.NHACP_ERROR_EBADF]: 'bad file descriptor',
  [NABU.NHACP_ERROR_ENOMEM]: 'out of memory',
  [NABU.NHACP_ERROR_EACCES]: 'access denied',
  [NABU.NHACP_ERROR_EBUSY]: 'file is busy',
  [NABU.NHACP_ERROR_EEXIST]: 'file exists',
  [NABU.NHACP_ERROR_EISDIR]: 'file is a directory',
  [NABU.NHACP_ERROR_EINVAL]: 'invalid argument',
  [NABU.NHACP_ERROR_ENFILE]: 'too many open files',
  [NABU.NHACP_ERROR_EFBIG]: 'file too large',
  [NABU.NHACP_ERROR_ENOSPC]: 'out of space',
  [NABU.NHACP_ERROR_ESEEK]: 'seek on non-seekable file',
  [NABU.NHACP_ERROR_ENOTDIR]: 'not a directory',
  [NABU.NHACP_ERROR_ENOTEMPTY]: 'directory not empty',
  [NABU.NHACP_ERROR_ESRCH]: 'no such session',
  [NABU.NHACP_ERROR_ENSESS]: 'too many sessions',
  [NABU.NHACP_ERROR_EAGAIN]: 'try again later',
  [NABU.NHACP_ERROR_EROFS]: 'write-protected',
};

const fail = (code, message) => { throw new NhacpError(code, message); };

// Reads the fields of a request. Running out of bytes is EINVAL; extra
// bytes at the end are allowed.
class Request {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }

  #take(n) {
    if (this.pos + n > this.bytes.length) fail(NABU.NHACP_ERROR_EINVAL, 'request too short');
    const pos = this.pos;
    this.pos += n;
    return pos;
  }

  u8() { return this.view.getUint8(this.#take(1)); }
  u16() { return this.view.getUint16(this.#take(2), true); }
  u32() { return this.view.getUint32(this.#take(4), true); }
  s32() { return this.view.getInt32(this.#take(4), true); }
  data(n) { const pos = this.#take(n); return this.bytes.subarray(pos, pos + n); }

  // A STRING, which the client may terminate early with a 0 byte.
  string() {
    const bytes = this.data(this.u8());
    const end = bytes.indexOf(0);
    return bytesToString(end === -1 ? bytes : bytes.subarray(0, end));
  }
}

// Builds a response frame: length (u16), type, fields.
class Response {
  #parts = [];

  constructor(type) { this.u8(type); }

  u8(v) { this.#parts.push(Uint8Array.of(v)); return this; }
  u16(v) { return this.#le(v, 2); }
  u32(v) { return this.#le(v, 4); }
  data(bytes) { this.#parts.push(bytes); return this; }
  string(s) {
    const bytes = new TextEncoder().encode(s).subarray(0, 255);
    return this.u8(bytes.length).data(bytes);
  }

  #le(v, n) {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (v >>> (8 * i)) & 0xff;
    this.#parts.push(bytes);
    return this;
  }

  frame() {
    const length = this.#parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(2 + length);
    out[0] = length & 0xff;
    out[1] = length >> 8;
    let i = 2;
    for (const p of this.#parts) { out.set(p, i); i += p.length; }
    return out;
  }
}

const ok = () => new Response(NABU.NHACP_RESPONSE_OK);

const errorResponse = (code, message = '') =>
  new Response(NABU.NHACP_RESPONSE_ERROR).u16(code).string(message);

const dataBuffer = bytes =>
  new Response(NABU.NHACP_RESPONSE_DATA_BUFFER).u16(bytes.length).data(bytes);

const pad = (n, width) => String(n).padStart(width, '0');

// DATE-TIME: YYYYMMDD then HHMMSS, local time.
const dateTime = (response, d) => response.data(new TextEncoder().encode(
  pad(d.getFullYear(), 4) + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2) +
  pad(d.getHours(), 2) + pad(d.getMinutes(), 2) + pad(d.getSeconds(), 2)));

const fileAttrs = (response, handle) => {
  dateTime(response, handle.file.mtime);
  const writable = handle.access !== NABU.NHACP_O_RDONLY;
  return response
    .u16(NABU.NHACP_ATTR_RD | (writable ? NABU.NHACP_ATTR_WR : 0))
    .u32(handle.file.size);
};

// File names are relative to the current channel's directory, unless
// they're full URLs, which go through the proxy.
const resolveUrl = (ctx, name) => {
  if (!name.match(/^https?:/)) {
    const channel = ctx.getChannel();
    return `${channel.baseUrl}${channel.imageDir}/${name}`;
  }

  // Now we have to do some double backflip escaping so these filenames
  // make it through to the cloud server.
  const url = new URL(name);
  url.pathname = encodeURIComponent(url.pathname);
  return ctx.rnProxyUrl + url;
};

const newSession = () => ({ handles: [], lastError: null });

const getHandle = (session, fd) =>
  session.handles[fd] ?? fail(NABU.NHACP_ERROR_EBADF, `fdesc ${fd} is not open`);

const writableHandle = (session, fd) => {
  const handle = getHandle(session, fd);
  if (handle.access === NABU.NHACP_O_RDONLY) {
    fail(NABU.NHACP_ERROR_EBADF, `fdesc ${fd} is not open for writing`);
  }
  return handle;
};

const checkLength = length => {
  if (length > NABU.NHACP_MAX_DATA) {
    fail(NABU.NHACP_ERROR_EINVAL, `length ${length} exceeds ${NABU.NHACP_MAX_DATA}`);
  }
};

const status = (ctx, name, message) => {
  ctx.log(message);
  ctx.progress = { fileName: name, message };
};

// HELLO is handled separately because it creates sessions.
const hello = (ctx, sessionId, req) => {
  const magic = bytesToString(req.data(3));
  // Not an NHACP HELLO at all; the spec says to ignore it.
  if (magic !== 'ACP') return null;

  const version = req.u16();
  const options = req.u16();
  if (version === 0) fail(NABU.NHACP_ERROR_EINVAL, 'NHACP 0.0 is not supported');
  if (version > NABU.NHACP_VERSION) fail(NABU.NHACP_ERROR_ENOTSUP, `version ${version}`);
  // No options (i.e. CRC8) are supported.
  if (options) fail(NABU.NHACP_ERROR_ENOTSUP, `options ${options}`);

  const sessions = ctx.nhacp.sessions;
  let id;
  if (sessionId === NABU.NHACP_SESSION_SYSTEM) {
    // The system session means the client rebooted; start over.
    sessions.clear();
    id = NABU.NHACP_SESSION_SYSTEM;
  }
  else if (sessionId === NABU.NHACP_SESSION_CREATE) {
    id = 1;
    while (sessions.has(id)) id++;
    if (id > 254) fail(NABU.NHACP_ERROR_ENSESS, 'no free sessions');
  }
  else {
    fail(NABU.NHACP_ERROR_EINVAL, `bad session ${sessionId} in HELLO`);
  }
  sessions.set(id, newSession());
  ctx.log(`NHACP session ${id} started`);

  return new Response(NABU.NHACP_RESPONSE_SESSION_STARTED)
    .u8(id).u16(NABU.NHACP_VERSION).string(ADAPTER_ID);
};

// Handlers for everything else, by request type. Each returns a Response,
// or null for requests that don't get one.
const handlers = {
  [NABU.NHACP_REQUEST_STORAGE_OPEN]: async (ctx, session, req) => {
    const reqFd = req.u8();
    const flags = req.u16();
    const name = req.string();

    const access = flags & NABU.NHACP_O_ACCMODE;
    if (access > NABU.NHACP_O_RDWP) fail(NABU.NHACP_ERROR_EINVAL, `bad access mode ${access}`);
    if (flags & NABU.NHACP_O_DIRECTORY) fail(NABU.NHACP_ERROR_ENOTSUP, 'directories are not supported');

    let fd = reqFd;
    if (fd === 0xff) {
      fd = session.handles.findIndex(h => h === undefined);
      if (fd === -1) fd = session.handles.length;
      if (fd >= 0xff) fail(NABU.NHACP_ERROR_ENFILE, 'no free file descriptors');
    }
    else if (session.handles[fd]) {
      fail(NABU.NHACP_ERROR_EBUSY, `fdesc ${fd} is in use`);
    }

    status(ctx, name, `Open {${fd}} = ${baseName(name)} (${flags})`);
    ctx.storage ??= new MemoryStorage();
    const { file } = await ctx.storage.open(resolveUrl(ctx, name), {
      create: Boolean(flags & NABU.NHACP_O_CREAT),
      exclusive: Boolean(flags & NABU.NHACP_O_EXCL),
    });
    if (flags & NABU.NHACP_O_TRUNC && access !== NABU.NHACP_O_RDONLY) file.setSize(0);

    session.handles[fd] = { name, file, access, cursor: 0 };
    return new Response(NABU.NHACP_RESPONSE_STORAGE_LOADED).u8(fd).u32(file.size);
  },

  [NABU.NHACP_REQUEST_STORAGE_GET]: (ctx, session, req) => {
    const fd = req.u8();
    const offset = req.u32();
    const length = req.u16();
    checkLength(length);
    return dataBuffer(getHandle(session, fd).file.read(offset, length));
  },

  [NABU.NHACP_REQUEST_STORAGE_PUT]: (ctx, session, req) => {
    const fd = req.u8();
    const offset = req.u32();
    const length = req.u16();
    checkLength(length);
    writableHandle(session, fd).file.write(offset, req.data(length));
    return ok();
  },

  [NABU.NHACP_REQUEST_GET_DATE_TIME]: () =>
    dateTime(new Response(NABU.NHACP_RESPONSE_DATE_TIME), new Date()),

  [NABU.NHACP_REQUEST_FILE_CLOSE]: (ctx, session, req) => {
    const fd = req.u8();
    const handle = session.handles[fd];
    // Closing something that isn't open is ignored.
    if (handle) {
      delete session.handles[fd];
      status(ctx, handle.name, `Close {${fd}} ${baseName(handle.name)}`);
    }
    return null;
  },

  [NABU.NHACP_REQUEST_GET_ERROR_DETAILS]: (ctx, session, req) => {
    const code = req.u16();
    const maxLength = req.u8();
    const last = session.lastError;
    session.lastError = null;
    const message = last?.code === code ? last.message : errorNames[code] ?? 'unknown error';
    return errorResponse(code, message.slice(0, maxLength));
  },

  [NABU.NHACP_REQUEST_STORAGE_GET_BLOCK]: (ctx, session, req) => {
    const fd = req.u8();
    const block = req.u32();
    const blockLength = req.u16();
    checkLength(blockLength);
    const { name, file } = getHandle(session, fd);
    const offset = block * blockLength;
    ctx.log(`read ${baseName(name)} block ${block} (${blockLength})`);

    // Past end-of-file is empty; a partial block is zero-padded.
    if (offset >= file.size) return dataBuffer(new Uint8Array(0));
    const data = new Uint8Array(blockLength);
    data.set(file.read(offset, blockLength));
    return dataBuffer(data);
  },

  [NABU.NHACP_REQUEST_STORAGE_PUT_BLOCK]: (ctx, session, req) => {
    const fd = req.u8();
    const block = req.u32();
    const blockLength = req.u16();
    checkLength(blockLength);
    const { name, file } = writableHandle(session, fd);
    ctx.log(`write ${baseName(name)} block ${block} (${blockLength})`);
    file.write(block * blockLength, req.data(blockLength));
    return ok();
  },

  [NABU.NHACP_REQUEST_FILE_READ]: (ctx, session, req) => {
    const fd = req.u8();
    req.u16(); // flags; none are defined
    const length = req.u16();
    checkLength(length);
    const handle = getHandle(session, fd);
    const data = handle.file.read(handle.cursor, length);
    handle.cursor += data.length;
    return dataBuffer(data);
  },

  [NABU.NHACP_REQUEST_FILE_WRITE]: (ctx, session, req) => {
    const fd = req.u8();
    req.u16(); // flags; none are defined
    const length = req.u16();
    checkLength(length);
    const handle = writableHandle(session, fd);
    handle.file.write(handle.cursor, req.data(length));
    handle.cursor += length;
    return ok();
  },

  [NABU.NHACP_REQUEST_FILE_SEEK]: (ctx, session, req) => {
    const fd = req.u8();
    const offset = req.s32();
    const whence = req.u8();
    const handle = getHandle(session, fd);
    const origin = {
      [NABU.NHACP_SEEK_SET]: 0,
      [NABU.NHACP_SEEK_CUR]: handle.cursor,
      [NABU.NHACP_SEEK_END]: handle.file.size,
    }[whence] ?? fail(NABU.NHACP_ERROR_EINVAL, `bad whence ${whence}`);
    const position = origin + offset;
    if (position < 0 || position > 0xffffffff) fail(NABU.NHACP_ERROR_EINVAL, `bad offset ${position}`);
    handle.cursor = position;
    return new Response(NABU.NHACP_RESPONSE_UINT32_VALUE).u32(position);
  },

  [NABU.NHACP_REQUEST_FILE_GET_INFO]: (ctx, session, req) => {
    const handle = getHandle(session, req.u8());
    // The name is omitted for FILE-GET-INFO.
    return fileAttrs(new Response(NABU.NHACP_RESPONSE_FILE_INFO), handle).string('');
  },

  [NABU.NHACP_REQUEST_FILE_SET_SIZE]: (ctx, session, req) => {
    const fd = req.u8();
    const size = req.u32();
    writableHandle(session, fd).file.setSize(size);
    return ok();
  },

  [NABU.NHACP_REQUEST_GOODBYE]: (ctx, session, req, sessionId) => {
    if (sessionId === NABU.NHACP_SESSION_SYSTEM) {
      ctx.nhacp.sessions.clear();
    }
    else {
      ctx.nhacp.sessions.delete(sessionId);
    }
    ctx.log(`NHACP session ${sessionId} ended`);
    return null;
  },
};

// Requests that never get a response, even on error.
const noResponse = new Set([NABU.NHACP_REQUEST_FILE_CLOSE, NABU.NHACP_REQUEST_GOODBYE]);

const handleMessage = async (ctx, sessionId, type, req) => {
  ctx.nhacp.sessions ??= new Map();
  const session = ctx.nhacp.sessions.get(sessionId);
  try {
    if (type === NABU.NHACP_REQUEST_HELLO) return hello(ctx, sessionId, req);
    if (!session) {
      if (noResponse.has(type)) return null;
      fail(NABU.NHACP_ERROR_ESRCH, `no session ${sessionId}`);
    }
    const handler = handlers[type] ??
      fail(NABU.NHACP_ERROR_ENOTSUP, `unsupported request type ${type}`);
    return await handler(ctx, session, req, sessionId);
  }
  catch (e) {
    if (!(e instanceof NhacpError)) throw e;
    ctx.log(`NHACP error ${e.code}: ${e.message}`);
    if (noResponse.has(type)) return null;
    if (session) session.lastError = e;
    // The message is only sent in response to GET-ERROR-DETAILS.
    return errorResponse(e.code);
  }
};

// These are merged into the state machine in protocol.js.
export const nhacpStates = {
  handleNhacpRequest: invoke(
    async ctx => {
      // The 0x8f has been consumed. What follows is
      // session-id(1) length(2) type(1) contents, with length counting
      // the type and contents.
      const [sessionId, lengthLo, lengthHi] = await getBytes(ctx, 3);
      const length = lengthLo | lengthHi << 8;
      if (length < 1 || length > NABU.NHACP_MAX_MESSAGE) {
        throw new Error(`bad NHACP message length ${length}`);
      }
      const message = new Uint8Array(await getBytes(ctx, length));
      const type = message[0];
      ctx.log(`NHACP session=${sessionId} type=${type} length=${length}`);

      const response = await handleMessage(ctx, sessionId, type, new Request(message.subarray(1)));
      if (response) await ctx.writer.write(response.frame());
    },
    transition('done', 'idle'),
    resetOnError
  ),
};
