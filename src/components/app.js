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

import { Router } from 'preact-router';
import { useMachine } from 'preact-robot';

import adaptorMachine from '/machines/adaptor';
import AdaptorContext from './adaptor-context';

import Home from '../routes/home';
import Faq from '../routes/home/faq';

const App = () => {
	let baseUrl = '/';
	try { baseUrl = process.env.PREACT_APP_BASE_URL } catch { };
	let adaptor = useMachine(adaptorMachine, {
		// Use of `navigator` breaks pre-rendering, so wrap it in a guard
		serial: typeof window !== "undefined" ? navigator?.serial : undefined,
		baseUrl
	});

	return (
		<AdaptorContext.Provider value={adaptor}>
			<div id="app">
				<main>
					<Router>
						<Home path="/" />
						<Faq path="/faq" />
					</Router>
				</main>
			</div>
		</AdaptorContext.Provider>
	)
	// }
};

export default App;
