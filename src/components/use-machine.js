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

// A Preact hook for running a robot3 machine, returning
// [current, send, service] like preact-robot did. preact-robot breaks with
// robot3 1.x, which reports the immediate transitions taken inside
// interpret() before the hook is ready for them.

import { useEffect, useRef, useState } from 'preact/hooks';
import { interpret } from 'robot3';

// Snapshot of the innermost running (invoked) machine: its state, with
// `context` and `service` attached.
const snapshot = service => {
  while (service.child) service = service.child;
  return Object.freeze(Object.create(service.machine.state, {
    context: { value: service.context || {}, enumerable: true },
    service: { value: service, enumerable: true },
  }));
};

export function useMachine(machine, initialContext) {
  // Changes that happen before the component mounts (including during
  // interpret() itself) are picked up when the effect runs.
  const onChangeRef = useRef(null);
  const [service] = useState(() =>
    interpret(machine, s => onChangeRef.current?.(s), initialContext));
  const [current, setCurrent] = useState(() => snapshot(service));

  useEffect(() => {
    onChangeRef.current = s => setCurrent(snapshot(s));
    setCurrent(snapshot(service));
    return () => { onChangeRef.current = null; };
  }, [service]);

  return [current, service.send, service];
}
