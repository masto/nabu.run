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

// We need a place to stash this context so it can be available across
// modules. I have no idea if this is the right way to do this, but it seems
// to work for now. It should probably be turned into accessor methods instead
// of directly exporting the variable.

import { createContext } from 'preact';

export const ConfigContext = createContext();
