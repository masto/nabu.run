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

// Handlers for the RetroNET protocol

import { transition, invoke } from 'robot3';
import { hex, baseName } from './util';

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
        ctx.rn.files ||= {};
        ctx.rn.files[fileName] = { fileData };
        size = fileData.byteLength;
      }

      ctx.progress = {
        fileName: fileName,
        message: `FileSize ${baseName(fileName)}: ${size}`
      };

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

      const rdwr = fileFlag & 1 ? 'rw' : 'ro';
      ctx.log(`open ${fileName} [${fileHandle}] ${rdwr}`);

      ctx.rn.handles ||= [];
      if (fileHandle === 0xff || ctx.rn.handles[fileHandle]) fileHandle = ctx.rn.handles.length;
      if (fileHandle >= 0xff) return ctx.writer.write(new Uint8Array([0xff]).buffer);

      ctx.rn.handles[fileHandle] = { fileName, fileFlag };

      ctx.log(`allocated handle ${hex(fileHandle)}`);

      ctx.progress = {
        fileName: fileName,
        message: `Open {${fileHandle}} = ${baseName(fileName)} (${rdwr})`
      };

      return ctx.writer.write(new Uint8Array([fileHandle]).buffer);
    },
    transition('done', 'idle'),
    resetOnError
  ),

  handleFhDetailsMsg: invoke(
    async ctx => {
      const fileHandle = (await getBytes(ctx, 1))[0];
      const file = ctx.rn.handles[fileHandle];
      const fileName = file.fileName;

      ctx.rn.files ||= {};

      if (!ctx.rn.files[fileName]) {
        const response = await fetch(rnUrlFor(ctx, fileName));
        if (!response.ok) throw new Error(response.status);
        const fileData = await response.arrayBuffer();
        ctx.rn.files[fileName] = { fileData };
        file.size = fileData.byteLength;
      }

      const fileData = ctx.rn.files[fileName].fileData;

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

      ctx.progress = {
        fileName: fileName,
        message: `Stat ${baseName(fileName)}`
      };

      return ctx.writer.write(reply.buffer);
    },
    transition('done', 'idle'),
    resetOnError
  ),

  handleFhReadseqMsg: invoke(
    async ctx => {
      const fileHandle = (await getBytes(ctx, 1))[0];
      const reqLength = new DataView(new Uint8Array(await getBytes(ctx, 2)).buffer).getUint16(0, true);
      const file = ctx.rn.handles[fileHandle];

      const fileName = file.fileName;
      if (!ctx.rn.files[fileName]) {
        const response = await fetch(rnUrlFor(ctx, fileName));
        if (!response.ok) throw new Error(response.status);
        const fileData = await response.arrayBuffer();
        ctx.rn.files[fileName] = { fileData };
        file.size = fileData.byteLength;
      }

      const fileData = ctx.rn.files[fileName].fileData;

      const pos = file?.pos ?? 0;
      let end = pos + reqLength;
      if (end > fileData.byteLength) end = fileData.byteLength;

      const length = end - pos;

      ctx.progress = {
        fileName, total: fileData.byteLength, complete: end,
        message: `Reading ${baseName(fileName)}`
      };

      file.pos = end;

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
      const file = ctx.rn.handles[fileHandle];

      ctx.rn.files[file.fileName] ||= { fileData: new ArrayBuffer() };
      const fileData = ctx.rn.files[file.fileName].fileData;

      const pos = reqOffset;
      let end = pos + reqLength;
      if (end > fileData.byteLength) end = fileData.byteLength;

      const length = end - pos;

      ctx.progress = {
        fileName: file.fileName,
        message: `Read ${baseName(file.fileName)} @ ${pos}`
      };

      ctx.rn.handles[fileHandle].pos = end;

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
      const file = ctx.rn.handles[fileHandle] ?? {};

      ctx.progress = {
        fileName: file?.fileName,
        message: `Close {${fileHandle}} ${file?.fileName}`
      };

      delete ctx.rn.handles[fileHandle];
    },
    transition('done', 'idle'),
    resetOnError
  ),

};
