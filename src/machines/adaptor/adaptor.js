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

// State machine that establishes a WebSerial or WebSockets port and then
// hands off to the protocol machine.

import {
  createMachine, state, transition, invoke, immediate, reduce, action,
  guard, state as final
} from 'robot3';

import { fatalError } from './common';

import { serialStates } from './serial';
import protocolMachine from './protocol';

const machine = createMachine({
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

  startConnection: invoke(protocolMachine,
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
  ),

  ...serialStates
},
  initialContext => ({
    baud: 111816, log: (...a) => { }, ...initialContext
  }));

export default machine;
