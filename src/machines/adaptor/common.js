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

import { transition, invoke, reduce, action } from 'robot3';
import { hex } from './util';

// Common reusable components for the state machine.

// When there's no recovery, this transition will log and halt.
export const fatalError = transition('error', 'error',
  reduce((ctx, ev) => ({ ...ctx, error: ev.error }))
);

// Most of the time, if something unexpected happens in the protocol, we
// just want to reset the state machine and try to recover.
export const resetOnError = transition('error', 'reset',
  reduce((ctx, ev) => ({ ...ctx, error: ev.error })),
  action(ctx => {
    console.log(ctx.error);
  })
);

// Output is pretty straightforward
export const sendBytes = (byteArray, nextState, ...args) => invoke(
  ctx => ctx.writer.write(new Uint8Array([byteArray].flat(3))),
  transition('done', nextState, ...args),
  resetOnError
);

// The next several functions are concerned with robustly handling the
// input side of things.

// All incoming reads go through this function. It will read until the
// supplied predicate function returns true. Input is buffered because we
// can't control how much we get back from read().
export const bufferUntil = async (ctx, matchFn) => {
  while (!matchFn(ctx)) {
    let { value, done } = await ctx.reader.read();
    if (done) {
      // done is like end of file, it's wildly unexpected for a serial port
      await ctx.reader.cancel();
      throw new Error('got done while buffering');
    }

    ctx.log(`read: ${hex(value)}`);
    ctx.readBuffer.push(...value);
  }
};

// Now build on the above to hold out for a specified number of bytes.
export const getBytes = async (ctx, count) => {
  await bufferUntil(ctx, ctx => ctx.readBuffer.length >= count);
  return ctx.readBuffer.splice(0, count);
};

// Another layer on top: get some bytes and do a callback on them.
export const processBytes = (count, cb, nextState) => invoke(
  ctx => getBytes(ctx, count).then(result => cb(result, ctx)),
  transition('done', nextState),
  resetOnError
);

// This is a fancier matcher that expects a specific sequence of byte(s).
// If if gets anything else, it will bail out to reset.
export const expectToReceive = (expectValue, nextState) => invoke(
  ctx => bufferUntil(ctx, ctx => {
    let expectArray = [expectValue].flat(3);
    ctx.log(`want [${hex(expectArray)}] have [${hex(ctx.readBuffer)}]`);
    let l = Math.min(ctx.readBuffer.length, expectArray.length);
    // We might not have all the bytes we want, but check the ones we do have
    if (!expectArray.slice(0, l).every((v, i) => v === ctx.readBuffer[i])) {
      throw new Error(`Expected ${hex(expectValue)}, got ${hex(ctx.readBuffer)}`);
    }

    // Did we have enough to check them all?
    if (ctx.readBuffer.length < expectArray.length) return false;

    // Remove the bytes that were matched
    ctx.readBuffer.splice(0, expectArray.length);
    return true;
  }),
  transition('done', nextState),
  resetOnError
);

// These are for doing stuff with packed binary data and structures.
const nabuTypes = {
  u8: {
    length: () => 1,
    get: async ctx => await getBytes(ctx, 1),
    decode: bytes => bytes[0],
  },
  u16: {
    length: () => 2,
    get: async ctx => await getBytes(ctx, 2),
    decode: bytes =>
      new DataView(new Uint8Array(bytes).buffer).getUint16(0, true),
  },
};

// Unpack a single value of `type`
export const decodeType = (type, value) => nabuTypes[type].decode(value);

// Unpack a sequence of typed fields
export const decodeStruct = (fields, bytes) => {
  let struct = {};
  let i = 0;
  for (const [field, type] of fields) {
    const length = nabuTypes[type].length();
    struct[field] = decodeType(type, bytes.slice(i, i + length + 1));
    i += length;
  }

  return struct;
};

// Read and unpack a single value of `type`
export const getType = async (ctx, type) =>
  decodeType(type, await nabuTypes[type].get(ctx));

// Read and unpack a sequence of typed fields
export const getStruct = async (ctx, fields) => {
  let struct = {};
  for (const [field, type] of fields) {
    struct[field] = await getType(ctx, type);
  }

  return struct;
};
