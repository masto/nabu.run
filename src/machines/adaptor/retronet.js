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
import { hex, baseName, bytesToString } from './util';

import { resetOnError, getBytes } from './common';
import * as NABU from './constants';

const rnUrlFor = (ctx, fileName) => {
  // Until local files are supported, we want to hard fail anything that's not
  // a cloud URL. 'about:' seems to do the trick.
  if (!fileName.match(/^http/)) return 'about:';

  // Now we have to do some double backflip escaping so these filenames
  // make it through to the cloud server.
  const url = new URL(fileName);
  url.pathname = encodeURIComponent(url.pathname);

  return ctx.rnProxyUrl + url;
}

// Ensure we have downloaded the file.
const fetchFile = async (ctx, fileName) => {
  ctx.rn.files ??= {};

  // Maybe we already have it?
  if (ctx.rn.files[fileName]) return;

  // Nope, so we need to go get it.
  const response = await fetch(rnUrlFor(ctx, fileName));
  if (!response.ok) {
    throw new Error(`failed to fetch ${fileName}: ${response.status}`);
  }

  const fileData = await response.arrayBuffer();
  const size = fileData.byteLength;
  ctx.rn.files[fileName] = { fileData, size };
};

// These are merged into the state machine in protocol.js.
export const retroNetStates = {
  handleFileSizeMsg: invoke(
    async ctx => {
      const len = (await getBytes(ctx, 1))[0];
      const fileName = bytesToString(await getBytes(ctx, len));

      let size = -1;
      try {
        await fetchFile(ctx, fileName);
        size = ctx.rn.files[fileName].size;
      } catch { }

      const message = `FileSize ${baseName(fileName)}: ${size}`;
      ctx.log(message);
      ctx.progress = { fileName, message };

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
      ctx.log(`request [${fileHandle}] ${fileName}`);

      ctx.rn.handles ??= [];
      // Asked to assign a handle, or requested handle is in use.
      if (fileHandle === 0xff || ctx.rn.handles[fileHandle]) {
        // Find the next unused handle.
        fileHandle = ctx.rn.handles.findIndex(e => e == undefined);
        if (fileHandle === -1) fileHandle = ctx.rn.handles.length;
      }
      // Out of handles? Bad news.
      if (fileHandle >= 0xff) return ctx.writer.write(new Uint8Array([0xff]).buffer);

      // All good if we made it this far.
      ctx.rn.handles[fileHandle] = { fileName, fileFlag };

      const message = `Open {${fileHandle}} = ${baseName(fileName)} (${rdwr})`;
      ctx.log(message);
      ctx.progress = { fileName, message };

      return ctx.writer.write(new Uint8Array([fileHandle]).buffer);
    },
    transition('done', 'idle'),
    resetOnError
  ),

  handleFhDetailsMsg: invoke(
    async ctx => {
      const fileHandle = (await getBytes(ctx, 1))[0];

      const fh = ctx.rn.handles[fileHandle];
      const fileName = fh.fileName;

      try {
        await fetchFile(ctx, fileName);
      }
      catch (err) { throw err }
      const file = ctx.rn.files[fileName];

      const reply = new Uint8Array(83);
      const dv = new DataView(reply.buffer);

      dv.setUint32(0, file.size, true); // file_size

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

      const message = `Stat ${baseName(fileName)}`;
      ctx.log(message);
      ctx.progress = { fileName, message };

      return ctx.writer.write(reply.buffer);
    },
    transition('done', 'idle'),
    resetOnError
  ),

  handleFhReadseqMsg: invoke(
    async ctx => {
      const fileHandle = (await getBytes(ctx, 1))[0];
      const reqLength = new DataView(new Uint8Array(await getBytes(ctx, 2)).buffer).getUint16(0, true);

      const fh = ctx.rn.handles[fileHandle];
      const fileName = fh.fileName;

      try {
        await fetchFile(ctx, fileName);
      }
      catch (err) { throw err }
      const { fileData, size } = ctx.rn.files[fileName];

      const pos = fh?.pos ?? 0;
      let end = pos + reqLength;
      if (end > size) end = size;

      const message = `Reading ${baseName(fileName)}`;
      ctx.log(`readseq ${baseName(fileName)} ${pos}-${end - 1}/${size}`);
      ctx.progress = { fileName, message, total: size, complete: end };

      // This is a sequential read, so update the next start position.
      fh.pos = end;

      const returnLength = new Uint8Array(2);
      new DataView(returnLength.buffer).setUint16(0, end - pos, true);
      await ctx.writer.write(returnLength.buffer);
      if (end === pos) return; // No data
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

      const fh = ctx.rn.handles[fileHandle];
      const fileName = fh.fileName;

      try {
        await fetchFile(ctx, fileName);
      }
      catch {
        // Trying to read a nonexistent file is not an error in RetroNET.
        ctx.rn.files[fileName] = { fileData: new ArrayBuffer(), size: 0 };
      }
      const { fileData, size } = ctx.rn.files[fileName];

      const pos = reqOffset;
      let end = pos + reqLength;
      if (end > size) end = size;

      const message = `Read ${baseName(fh.fileName)} @ ${pos}`;
      ctx.log(`read ${baseName(fileName)} ${pos}-${end - 1}/${size}`);
      ctx.progress = { fileName, message };

      fh.pos = end;

      const returnLength = new Uint8Array(2);
      new DataView(returnLength.buffer).setUint16(0, end - pos, true);
      await ctx.writer.write(returnLength.buffer);
      if (end === pos) return;
      return ctx.writer.write(fileData.slice(pos, end));
    },
    transition('done', 'idle'),
    resetOnError
  ),

  handleFhSeekMsg: invoke(
    async ctx => {
      const fileHandle = (await getBytes(ctx, 1))[0];
      const offset = new DataView(new Uint8Array(await getBytes(ctx, 4)).buffer).getUint32(0, true);
      const whence = (await getBytes(ctx, 1))[0];

      const fh = ctx.rn.handles[fileHandle];
      let pos = fh?.pos ?? 0;

      switch (whence) {
        case NABU.RN_SEEK_SET: pos = offset; break;
        case NABU.RN_SEEK_CUR: pos += offset; break;
        case NABU.RN_SEEK_END: pos = fh.size + offset; break;
        default: ctx.log(`bad whence: ${whence}`);
      }

      const message = `Seek {${fileHandle}} ${offset}, ${whence}) -> ${pos}`;
      ctx.log(message);
      ctx.progress = { fileName: fh?.fileName, message };

      fh.pos = pos;
      const returnOffset = new Uint8Array(4);
      new DataView(returnOffset.buffer).setUint32(0, fh.pos, true);
      return ctx.writer.write(returnOffset.buffer);
    },
    transition('done', 'idle'),
    resetOnError
  ),

  handleFhLineCountMsg: invoke(
    async ctx => {
      const fileHandle = (await getBytes(ctx, 1))[0];

      const fh = ctx.rn.handles[fileHandle];
      const fileName = fh.fileName;

      try {
        await fetchFile(ctx, fileName);
      }
      catch (err) { throw err }
      const { fileData } = ctx.rn.files[fileName];

      // Just count the number of newlines
      const lines = new Uint8Array(fileData).reduce(
        (count, byte) => count + (byte === 0x0a), 0);

      const message = `LineCount {${fileHandle}}: ${lines}`;
      ctx.log(message);
      ctx.progress = { fileName: fh?.fileName, message };

      const returnLineCount = new Uint8Array(2);
      new DataView(returnLineCount.buffer).setUint16(0, lines, true);
      return ctx.writer.write(returnLineCount.buffer);
    },
    transition('done', 'idle'),
    resetOnError
  ),

  handleFhGetLineMsg: invoke(
    async ctx => {
      const fileHandle = (await getBytes(ctx, 1))[0];
      let lineNumber =
        new DataView(new Uint8Array(await getBytes(ctx, 2)).buffer).getUint16(0, true);

      const fh = ctx.rn.handles[fileHandle];
      const fileName = fh.fileName;

      try {
        await fetchFile(ctx, fileName);
      }
      catch (err) { throw err }
      const { fileData, size } = ctx.rn.files[fileName];

      const message = `GetLine {${fileHandle}} ${lineNumber}`;
      ctx.log(message);
      ctx.progress = { fileName: fh?.fileName, message };

      let byteArray = new Uint8Array(fileData);
      let begin = 0;
      // Skip over `lineNumber` newlines
      while (lineNumber > 0) {
        const index = byteArray.indexOf(0x0a, begin);
        if (index == -1) {
          ctx.log('GetLine ran out of lines');
          lineNumber = 0;
        }
        else {
          lineNumber--;
          begin = index + 1;
        }
      }
      // Find the end of the line we want to return
      let end = byteArray.indexOf(0x0a, begin);
      // Clamp to end of file
      if (end == -1) end = size;
      // If line ended with CR+NL, don't return the CR
      if (byteArray[end] === 0x0d) end--;

      const returnArray = byteArray.subarray(begin, end);
      const returnLength = new Uint8Array(2);
      new DataView(returnLength.buffer).setUint16(0, returnArray.length, true);
      await ctx.writer.write(returnLength.buffer);
      return ctx.writer.write(returnArray);
    },
    transition('done', 'idle'),
    resetOnError
  ),

  handleFhCloseMsg: invoke(
    async ctx => {
      const fileHandle = (await getBytes(ctx, 1))[0];

      const fh = ctx.rn.handles[fileHandle] ?? {};

      const message = `Close {${fileHandle}} ${baseName(fh?.fileName)}`;
      ctx.log(message);
      ctx.progress = { fileName: fh?.fileName, message };

      delete ctx.rn.handles[fileHandle];
    },
    transition('done', 'idle'),
    resetOnError
  ),

};
