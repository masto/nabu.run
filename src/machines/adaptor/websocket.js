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

// WebSocket port management

import {
  state, transition, invoke, immediate, reduce, action, guard
} from 'robot3';

import { fatalError } from './common';
import { hex } from './util';

export const webSocketStates = {
  requestingWsPort: state(
    immediate('openingWsPort')
  ),

  // Now we have a port, so open it.
  openingWsPort: invoke(ctx => new Promise((resolve, reject) => {
    const websocket = new WebSocket('ws://127.0.0.1:5818');
    websocket.binaryType = 'arraybuffer';

    const errorController = new AbortController();
    websocket.addEventListener('close',
      event => {
        console.log('websocket closed unexpectedly', event);
        reject(event);
      },
      { signal: errorController.signal }
    );

    websocket.addEventListener('open',
      openEvent => {
        const readable = new ReadableStream({
          start: controller => {
            // If we get here, the connection is open, so we don't need the
            // "see if it fails to open" listener any more.
            errorController.abort();

            // When something goes wrong, bubble it up to the controller.
            websocket.addEventListener('close', event => controller.close());
            websocket.addEventListener('error', event => {
              ctx.log('discard error ', event);
              controller.error(event);
            });

            // Enqueue incoming chunks and the stream will do the rest.
            websocket.addEventListener('message', event => {
              controller.enqueue(new Uint8Array(event.data));
            });
          },

          cancel: reason => {
            ctx.log('canceling websocket: ', reason);
            websocket.close(1000, reason);
          }
        });

        const writable = new WritableStream({
          write: async chunk => {
            websocket.send(chunk);
          }
        });

        resolve({ readable, writable, websocket });
      }
    );
  }),
    transition('done', 'startConnection',
      reduce((ctx, ev) => ({ ...ctx, port: ev.data })),
      action(ctx => {
        ctx.portInfo = `websocket(${ctx.port.websocket.url})`;
      })),
    transition('error', 'closed', action((ctx, ev) => {
      if (CloseEvent.prototype.isPrototypeOf(ev.error)) {
        alert(`WebSocket connection to ${ev.error.target.url} failed.\r` +
          `Code: ${ev.error.code} ${ev.error.reason}`);
      }
      else {
        console.log('websocket connection error\n', ev.error);
      }
    }))
  )
};
