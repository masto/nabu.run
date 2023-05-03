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

import { transition, invoke, action, guard } from 'robot3';
import { hex, baseName, bytesToString } from './util';

import { resetOnError, getBytes, decodeType, decodeStruct } from './common';
import * as NABU from './constants';

// See dispatch function in protocol.js for the idea behind this.
const dispatch = (type, nextState) => transition('done', nextState,
  guard(ctx => {
    if (ctx.nhacp.message?.type === type) {
      ctx.log(`-> ${nextState}`);
      return true;
    }
  })
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
    transition('done', 'reset', action(ctx => {
      ctx.log(`Unhandled NHACP message type ${ctx.nhacp.message?.type}`);
    })),
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

      const adapterId = 'nabu.run';
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
        // TODO: proper error handling
        throw new Error(`Invalid requested session ID ${message.sessionId}`);
      }

      dv.setUint16(1, 1, true); // version
      response.set(adapterId, 2); // adapter-id

      return ctx.writer.write(responseFrame(NABU.NHACP_RESPONSE_SESSION_STARTED, response).buffer);
    },
    transition('done', 'idle'),
    resetOnError
  )

};
