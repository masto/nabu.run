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

// State machine that gets a WebSerial port and then hands off to the
// adaptor.

import {
  createMachine, state, transition, invoke, immediate, reduce, action,
  guard, state as final
} from 'robot3';

import {
  fatalError
} from './common';

import adaptor from './adaptor';

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
      ctx.log('fatal error: ', ctx.error);
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

  // Pause here because WebSerial access needs to be user-initiated.
  // Somewhere an onClick should trigger the `request` transition.
  waitingForPort: state(
    transition('request', 'requestingPort')
  ),

  // Ask the user for access to a serial port.
  requestingPort: invoke(ctx => ctx.serial.requestPort(),
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
  ),

  startConnection: invoke(adaptor,
    transition('done', 'error', guard(ctx => ctx.error)),
    transition('done', 'closed'),
    fatalError
  ),

  // This is the return path from the NABU protocol states if the serial
  // port goes away.
  closed: state(
    immediate('start', action(ctx => {
      delete ctx.progress;
      delete ctx.rn;
      ctx.log('port was closed');
    }))
  )
},
  initialContext => ({
    baud: 111816, log: (...a) => { }, ...initialContext
  }));

export default machine;
