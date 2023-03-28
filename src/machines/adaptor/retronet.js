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

// This is a slightly gnarly state machine that runs the show. Future work
// is to separate the parts that concern managing the serial port from
// the parts that implement the NABU protocol.

import { transition, invoke } from 'robot3';
import { hex } from './util';

import { resetOnError, getBytes } from './common';

const bytesToString = bytes => new TextDecoder().decode(new Uint8Array(bytes));

const rnUrlFor = (ctx, fileName) =>
  fileName.match(/^http/) ? ctx.rnProxyUrl + fileName : fileName;

export const retroNetStates = {
  handleFileSizeMsg: invoke(
    async ctx => {
      const len = (await getBytes(ctx, 1))[0];
      const fileName = bytesToString(await getBytes(ctx, len));

      let size = -1;
      const response = await fetch(rnUrlFor(ctx, fileName));
      if (response.ok) {
        const fileData = await response.arrayBuffer();
        ctx.files ||= {};
        ctx.files[fileName] = { fileData };
        size = fileData.byteLength;
      }

      const reply = new Uint8Array(4);
      new DataView(reply.buffer).setUint32(0, size, true);
      return ctx.writer.write(reply.buffer);
    },
    transition('done', 'idle'),
    resetOnError
  ),

  handleFileOpenMsg: invoke(
    async ctx => {
      const len = (await getBytes(ctx, 1))[0];
      const fileName = bytesToString(await getBytes(ctx, len));
      const fileFlag = new DataView(new Uint8Array(await getBytes(ctx, 2)).buffer).getUint16(0, true);
      let fileHandle = (await getBytes(ctx, 1))[0];

      ctx.log(`open ${fileName} [${fileHandle}] ${fileFlag & 1 ? 'ro' : 'rw'}`);

      ctx.handles ||= [];
      if (fileHandle === 0xff || ctx.handles[fileHandle]) fileHandle = ctx.handles.length;
      if (fileHandle >= 0xff) return ctx.writer.write(new Uint8Array([0xff]).buffer);

      ctx.handles[fileHandle] = { fileName, fileFlag };

      ctx.log(`allocated handle ${hex(fileHandle)}`);

      return ctx.writer.write(new Uint8Array([fileHandle]).buffer);
    },
    transition('done', 'idle'),
    resetOnError
  ),

  handleFhDetailsMsg: invoke(
    async ctx => {
      const fileHandle = (await getBytes(ctx, 1))[0];
      const file = ctx.handles[fileHandle];
      const fileName = file.fileName;

      ctx.files ||= {};

      if (!ctx.files[fileName]) {
        const response = await fetch(rnUrlFor(ctx, fileName));
        if (!response.ok) throw new Error(response.status);
        const fileData = await response.arrayBuffer();
        ctx.files[fileName] = { fileData };
      }

      const fileData = ctx.files[fileName].fileData;

      const reply = new Uint8Array(83);
      const dv = new DataView(reply.buffer);

      dv.setUint32(0, fileData.byteLength, true); // file_size

      dv.setUint16(4, 2023, true); // year
      dv.setUint8(6, 2); // month
      dv.setUint8(7, 3); // day
      dv.setUint8(8, 5); // hour
      dv.setUint8(9, 10); // minute
      dv.setUint8(10, 10); // second

      dv.setUint16(11, 2023, true); // year
      dv.setUint8(13, 2); // month
      dv.setUint8(14, 3); // day
      dv.setUint8(15, 5); // hour
      dv.setUint8(16, 10); // minute
      dv.setUint8(17, 10); // second

      dv.setUint8(18, fileName.length);
      new TextEncoder().encodeInto(fileName, reply.subarray(19, 83));

      ctx.log(`file details: ${hex(reply)}`);

      return ctx.writer.write(reply.buffer);
    },
    transition('done', 'idle'),
    resetOnError
  ),

  handleFhReadseqMsg: invoke(
    async ctx => {
      const fileHandle = (await getBytes(ctx, 1))[0];
      const reqLength = new DataView(new Uint8Array(await getBytes(ctx, 2)).buffer).getUint16(0, true);
      const file = ctx.handles[fileHandle];

      const fileName = file.fileName;
      if (!ctx.files[fileName]) {
        const response = await fetch(rnUrlFor(ctx, fileName));
        if (!response.ok) throw new Error(response.status);
        const fileData = await response.arrayBuffer();
        ctx.files[fileName] = { fileData };
      }

      const fileData = ctx.files[fileName].fileData;

      const pos = ctx.handles[fileHandle]?.pos ?? 0;
      let end = pos + reqLength;
      if (end > fileData.byteLength) end = fileData.byteLength;

      const length = end - pos;

      ctx.handles[fileHandle].pos = end;

      const returnLength = new Uint8Array(2);
      new DataView(returnLength.buffer).setUint16(0, length, true);
      await ctx.writer.write(returnLength.buffer);
      if (length == 0) return;
      return ctx.writer.write(fileData.slice(pos, end));
    },
    transition('done', 'idle'),
    resetOnError
  ),

  handleFhReadMsg: invoke(
    async ctx => {
      const fileHandle = (await getBytes(ctx, 1))[0];
      const reqOffset = new DataView(new Uint8Array(await getBytes(ctx, 4)).buffer).getUint32(0, true);
      const reqLength = new DataView(new Uint8Array(await getBytes(ctx, 2)).buffer).getUint16(0, true);
      const file = ctx.handles[fileHandle];

      ctx.files[file.fileName] ||= { fileData: new ArrayBuffer() };
      const fileData = ctx.files[file.fileName].fileData;

      const pos = reqOffset;
      let end = pos + reqLength;
      if (end > fileData.byteLength) end = fileData.byteLength;

      const length = end - pos;

      ctx.handles[fileHandle].pos = end;

      const returnLength = new Uint8Array(2);
      new DataView(returnLength.buffer).setUint16(0, length, true);
      await ctx.writer.write(returnLength.buffer);
      if (length == 0) return;
      return ctx.writer.write(fileData.slice(pos, end));
    },
    transition('done', 'idle'),
    resetOnError
  ),

  handleFhCloseMsg: invoke(
    async ctx => {
      const fileHandle = (await getBytes(ctx, 1))[0];
      delete ctx.handles[fileHandle];
    },
    transition('done', 'idle'),
    resetOnError
  ),

};
