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

// Handlers for the NHACP protocol
// Docs: https://github.com/thorpej/nabu-figforth/blob/dev/nhacp-draft-0.1/nabu-comms.md

import { state, immediate, transition, invoke, action, reduce, guard } from 'robot3';
import { hex, baseName, bytesToString } from './util';

import { resetOnError, getBytes, decodeType, decodeStruct } from './common';
import * as NABU from './constants';

// Custom errors that are returned to the client instead of resetting
class NhacpError extends Error {
  constructor(code, message) {
    super(message ?? `NHACP Error Code ${code}`);
    this.name = 'NhacpError';
    this.code = code;
  }
}

// See dispatch function in protocol.js for the idea behind this.
const dispatch = (type, nextState) => transition('done', nextState,
  guard(ctx => {
    if (ctx.nhacp.message?.type === type) {
      ctx.log(`-> ${nextState}`);
      return true;
    }
  })
);

const errorHandler = transition('error', 'nhacpError',
  reduce((ctx, ev) => ({ ...ctx, error: ev.error }))
);

const responseFrame = (type, contents) => {
  const length = 1 + contents.length; // TODO: CRC is 1 more
  const response = new Uint8Array(2 + length);
  const dv = new DataView(response.buffer);

  dv.setUint16(0, length, true);
  dv.setUint8(2, type);
  response.set(contents, 3);

  return response;
};

const errorFrame = (code, message) => {
  const messageString = nhacpString(message ?? '');
  const response = new Uint8Array(2 + messageString.length);
  const dv = new DataView(response.buffer);

  dv.setUint16(0, code, true);
  response.set(messageString, 2);

  return responseFrame(NABU.NHACP_RESPONSE_ERROR, response);
};

const getNhacpString = bytes => {
  const length = bytes.shift();
  const string = bytesToString(bytes.slice(0, length));
  return string.replace(/\x00.*$/, '');
};

const nhacpString = string => {
  const bytes = new Uint8Array(string.length + 1);
  const dv = new DataView(bytes.buffer);
  dv.setUint8(0, string.length);
  bytes.set(string, 1);
  return bytes;
};

const rnUrlFor = (ctx, fileName) => {
  // This is a temporary hack for serving files locally during development.
  // Eventually, we want to support the local filesystem API.
  const channel = ctx.getChannel();
  if (!fileName.match(/^http/)) return `${channel.baseUrl}${channel.imageDir}/${fileName}`;

  // Now we have to do some double backflip escaping so these filenames
  // make it through to the cloud server.
  const url = new URL(fileName);
  url.pathname = encodeURIComponent(url.pathname);

  return ctx.rnProxyUrl + url;
}

// Ensure we have downloaded the file.
const fetchFile = async (ctx, url) => {
  ctx.nhacp.files ??= {};

  // Maybe we already have it?
  if (ctx.nhacp.files[url]) return;

  // Nope, so we need to go get it.
  const response = await fetch(rnUrlFor(ctx, url));
  if (!response.ok) {
    throw new NhacpError(
      NABU.NHACP_ERROR_ENOENT,
      `failed to fetch ${url}: ${response.status}`
    );
  }

  const fileData = await response.arrayBuffer();
  const size = fileData.byteLength;
  ctx.nhacp.files[url] = { fileData, size };
};

// These are merged into the state machine in protocol.js.
export const nhacpStates = {
  handleNhacpRequest: invoke(
    async ctx => {
      delete ctx.nhacp.message; // ensure no leftover message state

      // Packet format is not optimal for stream processing, so we read the
      // whole thing and then work on it.

      // packet = 0x8f session-id(1) message:[length(2) type(1) contents <check>]
      // message length does not include itself
      // check is optional
      // note at this point in the code we've already consumed the 0x8f

      // Need to read past the header and into the packet to get the length
      const packet = [NABU.MSG_NHACP_REQUEST, ...await getBytes(ctx, 3)];
      const sessionId = decodeType('u8', packet.slice(1, 2));
      const msgLen = decodeType('u16', packet.slice(2, 4));
      // Now we can grab the remainder of the packet data
      packet.push(...await getBytes(ctx, msgLen));

      // TODO: account for possible CRC
      // Requires checking for a HELLO message, or session state

      // Now we can discard the headers and be left with the message
      const message = { sessionId };
      packet.splice(0, 4); // throw away everything before type
      message.type = decodeType('u8', packet.splice(0, 1));
      message.contents = packet;
      ctx.log(`NHACP session=${message.sessionId} type=${message.type} data=(${message.contents.length} bytes)`);

      // Stash it in the context and process it in the next state
      ctx.nhacp.message = message;
    },
    dispatch(NABU.NHACP_REQUEST_HELLO, 'handleNhacpHello'),
    dispatch(NABU.NHACP_REQUEST_STORAGE_OPEN, 'handleNhacpStorageOpen'),
    dispatch(NABU.NHACP_REQUEST_STORAGE_GET_BLOCK, 'handleNhacpStorageGetBlock'),
    dispatch(NABU.NHACP_REQUEST_FILE_CLOSE, 'handleNhacpFileClose'),
    transition('done', 'reset', action(ctx => {
      ctx.log(`Unhandled NHACP message type ${ctx.nhacp.message?.type}`);
    })),
    resetOnError
  ),

  // Pass NHACP-specific errors to special handling, otherwise reset
  nhacpError: state(
    immediate('handleNhacpError', guard(ctx => ctx.error instanceof NhacpError)),
    immediate('reset', action(ctx => {
      console.log(ctx.error);
    }))
  ),

  handleNhacpError: invoke(
    async ctx => {
      ctx.log(ctx.error);

      return ctx.writer.write(errorFrame(ctx.error.code));
    },
    transition('done', 'idle'),
    resetOnError
  ),

  handleNhacpHello: invoke(
    async ctx => {
      const message = ctx.nhacp.message;
      const hello = {
        magic: bytesToString(message.contents.splice(0, 3)),
        ...decodeStruct(new Map([
          ['version', 'u16'],
          ['options', 'u16']
        ]), message.contents)
      };

      // TODO: Handle options, check version
      if (hello.magic !== 'ACP') {
        throw new Error(`HELLO: Bad magic (${hello.magic})`);
      }

      const adapterId = nhacpString('nabu.run');
      const response = new Uint8Array(3 + adapterId.length);
      const dv = new DataView(response.buffer);

      if (message.sessionId === 0) {
        dv.setUint8(0, 0); // session-id
      }
      else if (message.sessionId == 0xff) {
        // TODO: proper session handling
        dv.setUint8(0, 1); // session-id
      }
      else {
        throw new NhacpError(
          NABU.NHACP_ERROR_ENSESS,
          `Invalid requested session ID ${message.sessionId}`
        );
      }

      dv.setUint16(1, 1, true); // version
      response.set(adapterId, 2); // adapter-id

      return ctx.writer.write(responseFrame(NABU.NHACP_RESPONSE_SESSION_STARTED, response).buffer);
    },
    transition('done', 'idle'),
    errorHandler
  ),

  handleNhacpStorageOpen: invoke(
    async ctx => {
      const message = ctx.nhacp.message;
      const request = {
        ...decodeStruct(new Map([
          ['fd', 'u8'],
          ['flags', 'u16']
        ]), message.contents),
        url: getNhacpString(message.contents.slice(3))
      };

      ctx.nhacp.handles ??= [];
      let fd = request.fd;
      // Asked to assign a handle
      if (fd === 0xff) {
        // Find the next unused handle.
        fd = ctx.nhacp.handles.findIndex(e => e == undefined);
        if (fd === -1) fd = ctx.nhacp.handles.length;
      }
      // Out of handles? Bad news.
      if (fd >= 0xff || ctx.nhacp.handles[fd]) {
        throw new NhacpError(
          NABU.NHACP_ERROR_EBUSY,
          `Unable to assign requested fdesc ${request.fd}`
        );
      }

      const status = `Open {${fd}} = ${baseName(request.url)} (${request.flags})`;
      ctx.log(status);
      ctx.progress = { fileName: request.url, message: status };

      // Get the file
      try {
        await fetchFile(ctx, request.url);
      }
      catch (err) { throw err }

      // All good if we made it this far.
      ctx.nhacp.handles[fd] = { url: request.url, flags: request.flags };
      const file = ctx.nhacp.files[request.url];

      const response = new Uint8Array(5);
      const dv = new DataView(response.buffer);

      dv.setUint8(0, fd); // fdesc
      dv.setUint32(1, file.size, true); // length

      return ctx.writer.write(responseFrame(NABU.NHACP_RESPONSE_STORAGE_LOADED, response).buffer);
    },
    transition('done', 'idle'),
    errorHandler
  ),

  handleNhacpStorageGetBlock: invoke(
    async ctx => {
      const message = ctx.nhacp.message;
      const request = decodeStruct(new Map([
        ['fd', 'u8'],
        ['blockNumber', 'u32'],
        ['blockLength', 'u16']
      ]), message.contents);

      ctx.log(`requested fd ${request.fd}`);

      const fh = ctx.nhacp?.handles?.[request.fd];
      if (fh == undefined) {
        throw new NhacpError(
          NABU.NHACP_ERROR_EBADF,
          `fdesc ${request.fd} is not open`
        );
      }

      const url = fh.url;
      const { fileData, size } = ctx.nhacp.files[url];

      const pos = request.blockNumber * request.blockLength;
      let end = pos + request.blockLength;
      if (end > size) end = size;

      const status = `Read ${baseName(url)} @ ${pos}`;
      ctx.log(`read ${baseName(url)} ${pos}-${end - 1}/${size}`);
      ctx.progress = { fileName: url, message: status };

      const have = pos < size ? request.blockLength : 0;

      const response = new Uint8Array(2 + have);
      const dv = new DataView(response.buffer);

      dv.setUint16(0, have, true); // length
      if (have) {
        response.set(new Uint8Array(fileData.slice(pos, end)), 2); // data
      }

      const r = responseFrame(NABU.NHACP_RESPONSE_DATA_BUFFER, response);
      return ctx.writer.write(r.buffer);
    },
    transition('done', 'idle'),
    errorHandler
  ),

  handleNhacpFileClose: invoke(
    async ctx => {
      const message = ctx.nhacp.message;
      const request = decodeStruct(new Map([
        ['fd', 'u8']
      ]), message.contents);

      try {
        const fh = ctx.nhacp.handles[request.fd];
        const url = fh.url;

        delete ctx.nhacp.files[url];
        delete ctx.nhacp.handles[request.fd];

        const status = `Close {${request.fd}} ${baseName(url)}`;
        ctx.log(status);
        ctx.progress = { fileName: url, message: status };
      }
      catch { }
    },
    transition('done', 'idle'),
    errorHandler
  )
};
