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

import {
  createMachine, state, transition, invoke, immediate, reduce, action,
  guard, state as final
} from 'robot3';
import { crc16ccitt } from 'crc';
import { hex, escapeNabuMsg } from './util';
import * as NABU from './constants';

// The formal state machine is defined at the end of the file.
// First we start with some reusable components.

// When there's no recovery, this transition will log and halt.
const fatalError = transition('error', 'error',
  reduce((ctx, ev) => ({ ...ctx, error: ev.error }))
);

// Most of the time, if something unexpected happens in the protocol, we
// just want to reset the state machine and try to recover.
const resetOnError = transition('error', 'reset',
  reduce((ctx, ev) => ({ ...ctx, error: ev.error })),
  action(ctx => {
    console.log(ctx.error);
  })
);

// Output is pretty straightforward
const sendBytes = (byteArray, nextState) => invoke(
  ctx => ctx.writer.write(new Uint8Array([byteArray].flat(3))),
  transition('done', nextState),
  resetOnError
);

// The next several functions are concerned with robustly handling the
// input side of things.

// All incoming reads go through this function. It will read until the
// supplied predicate function returns true. Input is buffered because we
// can't control how much we get back from read().
const bufferUntil = async (ctx, matchFn) => {
  while (!matchFn(ctx)) {
    let { value, done } = await ctx.reader.read();
    if (done) {
      // done is like end of file, it's wildly unexpected for a serial port
      throw new Error('got done while buffering');
    }

    console.log(`read: ${hex(value)}`);
    ctx.readBuffer.push(...value);
  }
};

// Now build on the above to hold out for a specified number of bytes.
const getBytes = (ctx, count) => new Promise(async r => {
  await bufferUntil(ctx, ctx => ctx.readBuffer.length >= count);
  r(ctx.readBuffer.splice(0, count), ctx);
});

// Another layer on top: get some bytes and do a callback on them.
const processBytes = (count, cb, nextState) => invoke(
  ctx => getBytes(ctx, count).then(result => cb(result, ctx)),
  transition('done', nextState),
  resetOnError
);

// This is a fancier matcher that expects a specific sequence of byte(s).
// If if gets anything else, it will bail out to reset.
const expectToReceive = (expectValue, nextState) => invoke(
  ctx => bufferUntil(ctx, ctx => {
    let expectArray = [expectValue].flat(3);
    console.log(`want [${hex(expectArray)}] have [${hex(ctx.readBuffer)}]`);
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

// A lot of messages all behave the same: if we receive it, we send an
// acknowledgement, and that's all that happens.
const dispatch = (expectMsg, nextState) => transition('done', nextState,
  guard(ctx => {
    if (ctx.readBuffer[0] === expectMsg) {
      ctx.readBuffer.shift();
      console.log(`-> ${nextState}`);
      return true;
    }
  })
);

// Use that dispatch function to generate a bunch of 'done' transitions
// with guards that control which one gets to handle it. Clever, huh?
const processMessages = invoke(
  ctx => bufferUntil(ctx, ctx => ctx.readBuffer.length),
  dispatch(NABU.MSG_RESET, 'handleResetMsg'),
  dispatch(NABU.MSG_START_UP, 'sendInit'),
  dispatch(NABU.MSG_GET_STATUS, 'sendStatusGood'),
  dispatch(NABU.STATUS_SIGNAL, 'sendChannelStatus'),
  dispatch(NABU.STATUS_TRANSMIT, 'sendFinished'),
  dispatch(NABU.MSG_MYSTERY, 'sendMysteryAck'),
  dispatch(NABU.MSG_PACKET_REQUEST, 'sendPacketReqAck'),
  dispatch(NABU.MSG_CHANGE_CHANNEL, 'sendChangeChannelAck'),
  transition('done', 'reset', action(ctx => {
    console.log(`Unhandled NABU message ${hex(ctx.readBuffer[0])}`);
  })),
  resetOnError
);

// Now after all that prep work, the state machine definition:
const machine = createMachine({
  /*
   *  Entry and exit points 
   */

  // Entry. If we have no serial API, just give up.
  start: state(
    immediate('checkingPorts', guard(ctx => ctx.serial)),
    immediate('stopped')
  ),

  // This is a dead-end that should only be reached if there's no recovery.
  stopped: final(),

  // Log an error message and transition to stopped.
  error: state(immediate(
    'stopped',
    action(ctx => {
      console.log("fatal error: ", ctx.error);
    })
  )),

  /*
   *  Serial port management
   */

  // Get the list of ports we have access to.
  checkingPorts: invoke(ctx => ctx.serial.getPorts(),
    transition('done', 'validatingPorts',
      reduce((ctx, ev) => ({ ...ctx, foundPorts: ev.data }))
    ),
    fatalError),

  // If we don't have a port, we need to ask for one.
  validatingPorts: state(
    immediate('openingPort',
      guard(ctx => ctx.foundPorts?.length),
      action(ctx => {
        console.log("found a port, skipping request", ctx.foundPorts);
        // Just assume the first one in the list. It'd be unusual to choose
        // multiple ports, but if this is the wrong one, the user will
        // probably close it and we can try again.
        ctx.port = ctx.foundPorts[0];
      })
    ),
    immediate('waitingForPort',
      action(ctx => delete ctx?.port)
    )
  ),

  // Pause here because WebSerial access needs to be user-initiated.
  // Somewhere an onClick should trigger the `request` transition.
  waitingForPort: state(
    transition('request', 'requestingPort')
  ),

  // Ask the user for access to a serial port.
  requestingPort: invoke(ctx => ctx.serial.requestPort(),
    transition('done', 'openingPort',
      reduce((ctx, ev) => {
        console.log(ev);
        return { ...ctx, port: ev.data }
      })
    ),
    transition('error', 'waitingForPort')),

  // Now we have a port, so open it
  openingPort: invoke(ctx => ctx.port.open({
    baudRate: ctx.baud, dataBits: 8, stopBits: 2, parity: 'none'
  }),
    transition('done', 'startConnection'),
    fatalError
  ),

  // This is the return path from the NABU protocol states if the serial
  // port goes away.
  closed: state(
    immediate('start', action(() => { console.log('port was closed') }))
  ),

  /*
   *  NABU connection management
   */

  // (Re-)entry for starting to talk to the NABU. Should clean up any
  // internal state.
  startConnection: state(
    immediate('idle',
      guard(ctx => ctx.port.readable && ctx.port.writable),
      action(ctx => {
        ctx.reader = ctx.port.readable.getReader();
        ctx.writer = ctx.port.writable.getWriter();
        ctx.readBuffer = [];
        delete ctx.image;
        delete ctx.progress;
      })
    ),
    // If the port was found to be unusable, bail out of the NABU loop
    immediate('closed')
  ),

  // If we get out of sync, various states will transition through `reset`
  // in order to start over again.
  reset: state(
    immediate('startConnection', action(ctx => {
      console.log("RESET");
      // Need to release these or we won't be able to grab them again.
      ctx.reader?.releaseLock();
      ctx.writer?.releaseLock();
    }))
  ),

  /*
   *  NABU protocol handling
   */

  // Main dispatch loop. We should be parked here when nothing is going on.
  idle: processMessages,

  // Trivial responses that do no work and return to idle.
  sendInit: sendBytes([NABU.MSGSEQ_ACK, NABU.STATE_CONFIRMED], 'idle'),
  sendStatusGood: sendBytes(NABU.MSGSEQ_ACK, 'idle'),
  sendChannelStatus: sendBytes([NABU.SIGNAL_STATUS_YES, NABU.MSGSEQ_FINISHED], 'idle'),
  sendConfirmed: sendBytes(NABU.STATE_CONFIRMED, 'idle'),
  sendFinished: sendBytes(NABU.MSGSEQ_FINISHED, 'idle'),

  // You want reset, I give you reset.
  handleResetMsg: sendBytes([NABU.MSGSEQ_ACK, NABU.STATE_CONFIRMED], 'reset'),

  // Read some data we don't care about, and throw it away
  sendChangeChannelAck: sendBytes(NABU.MSGSEQ_ACK, 'handleChangeChannel'),
  handleChangeChannel: processBytes(2, bytes => console.log(`change channel: [${hex(bytes)}]`), 'sendConfirmed'),

  // ¯\_(ツ)_/¯
  sendMysteryAck: sendBytes(NABU.MSGSEQ_ACK, 'getMysteryBytes'),
  getMysteryBytes: processBytes(2, bytes => console.log(`mystery bytes: [${hex(bytes)}]`), 'sendConfirmed'),

  /*
   *  Packet handling
   */

  // Finally, the point where we work with some actual data.
  sendPacketReqAck: sendBytes(NABU.MSGSEQ_ACK, 'handlePacketReq'),
  handlePacketReq: invoke(
    ctx => getBytes(ctx, 4).then(bytes => {
      // Unpack which segment and pak ID were requested
      console.log(`packet req: ${hex(bytes)}`);
      let segment = bytes[0];
      let imageId = bytes[3] << 16 | bytes[2] << 8 | bytes[1];

      // We retain the last image since multiple segments will be requested
      if (ctx?.image?.imageId !== imageId) {
        console.log("preparing new image");
        ctx.image = { imageId: imageId };
      }
      ctx.image.segment = segment;
      console.log(`segment ${hex(segment)} image ${hex(imageId, 6)}`);
    }),
    // We don't handle the clock yet, let the other IAs have some value :-)
    transition('done', 'sendPacketUnauthorized', guard(ctx => ctx.image.imageId === NABU.IMAGE_TIME)),
    transition('done', 'preparePacket'),
    resetOnError
  ),

  // In the event we want to reject the request
  sendPacketUnauthorized: sendBytes([NABU.STATE_CONFIRMED, NABU.SERVICE_UNAUTHORIZED], 'awaitUnauthAck'),
  awaitUnauthAck: expectToReceive([NABU.MSGSEQ_ACK], 'idle'),

  // The meat of the thing is serving a segment of the requested file
  preparePacket: invoke(ctx => {
    // First, download the file from the cloud, if necessary
    return new Promise(async (resolve, reject) => {
      // Check to see if it has already been downloaded and stuffed in ctx
      if (ctx.image.pak) return resolve(ctx.image.pak);

      // We don't have the data, so get it from the Internet. Browsers are
      // good at this.
      console.log("Fetching image remotely");
      const pakId = ctx.image.imageId.toString(16).padStart(6, '0');
      ctx.image.pakId = pakId;
      const url = `${ctx.baseUrl}${pakId}.pak`;
      const response = await fetch(url);
      // This can go one of two ways
      if (response.ok) {
        resolve(response.arrayBuffer());
      }
      else {
        reject(`failed to fetch pak ${pakId}: ${response.status}`);
      }
    })
      .then(pak => {
        // At this point, we have the pak file, so we just need to slice and serve.
        ctx.image.pak = pak;
        const pakSize = pak.byteLength;
        delete ctx.progress;

        const segment = ctx.image.segment;

        // PAK files have been pre-processed into packets, so we can just
        // grab the appropriate chunk of the file.
        let len = NABU.TOTALPAYLOADSIZE;
        let offset = 2 + (segment * (len + 2));

        if (offset >= pakSize) {
          throw new Error(`offset ${offset} exceeds PAK size ${pakSize}`);
        }

        // Cap the final packet to the remaining bytes
        if (offset + len >= pakSize) {
          len = pakSize - offset;
        }

        ctx.progress = { total: pakSize, complete: offset + len };

        let buf = new Uint8Array(pak.slice(offset, offset + len));

        // Recalculate the CRC just in case
        let crc = crc16ccitt(buf.subarray(0, len - 2)) ^ 0xffff;
        new DataView(buf.buffer).setUint16(len - 2, crc);

        ctx.image.buf = buf;
      })
      .catch(error => { console.log(error); throw error; })
  },
    transition('done', 'sendPacketAuthorized'),
    transition('error', 'sendFinished')),

  // This is the happy path.
  sendPacketAuthorized: sendBytes([NABU.STATE_CONFIRMED, NABU.SERVICE_AUTHORIZED], 'awaitPacketAck'),
  awaitPacketAck: expectToReceive([NABU.MSGSEQ_ACK], 'sendPacket'),
  sendPacket: invoke(
    ctx => ctx.writer.write(escapeNabuMsg(ctx.image.buf)),
    transition('done', 'sendFinished'),
    resetOnError
  )
},
  initialContext => ({ baud: 111816, ...initialContext }));

export default machine;
