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

// Serial port management

import {
  state, transition, invoke, immediate, reduce, action, guard
} from 'robot3';

import { fatalError } from './common';

export const serialStates = {
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
        ctx.log('found a port, skipping request', ctx.foundPorts);
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

  // Ask the user for access to a serial port.
  requestingSerialPort: invoke(ctx => ctx.serial.requestPort(),
    transition('done', 'openingPort',
      reduce((ctx, ev) => {
        ctx.log(ev);
        return { ...ctx, port: ev.data }
      })
    ),
    transition('error', 'waitingForPort')),

  // Now we have a port, so open it.
  openingPort: invoke(ctx => ctx.port.open({
    baudRate: ctx.baud, dataBits: 8, stopBits: 2, parity: 'none'
  }),
    transition('done', 'startConnection'),
    fatalError
  )
};
