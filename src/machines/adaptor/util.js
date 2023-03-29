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

import { MSG_ESCAPE as NABU_MSG_ESCAPE } from "./constants";

export function hex(d, l = 2) {
  let arr = d?.length !== undefined ? Array.from(d).flat(3) : [d];
  return arr.map(n => "0x" + Number(n).toString(16).padStart(l, '0')).join(' ');
}

// Inefficiently takes in a Uint8Array and returns a new one, with the
// NABU protocol's escape code escaped.
export function escapeNabuMsg(inBuf) {
  return new Uint8Array(
    [...inBuf].map(v => v === NABU_MSG_ESCAPE ? [NABU_MSG_ESCAPE, v] : v).flat()
  );
}

export function baseName(path) {
  if (path == undefined) return '';
  return path.match(/[^\/]*$/)[0];
}
