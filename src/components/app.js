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
import { useState } from 'preact/hooks';
import { useMachine } from 'preact-robot';

import adaptorMachine from '/machines/adaptor';
import { ConfigContext } from './config-context';
import { AdaptorContext } from './adaptor-context';

import Home from '../routes/home';
import Faq from '../routes/home/faq';

const initState = () => {
	let baseUrl = '', imageDir = '', imageName;
	try { baseUrl = process.env.PREACT_APP_BASE_URL } catch { };
	try { imageDir = process.env.PREACT_APP_IMAGE_DIR } catch { };
	try { imageName = process.env.PREACT_APP_IMAGE_NAME } catch { };

	return { baseUrl, imageDir, imageName };
}

const config = {
	channel: initState()
};

const setConfig = newConfig => {
	Object.assign(config, newConfig);
};

const getChannel = () => config.channel;

const App = () => {
	let adaptor = useMachine(adaptorMachine, {
		// Use of `navigator` breaks pre-rendering, so wrap it in a guard
		serial: typeof window !== 'undefined' ? navigator?.serial : undefined,
		getChannel
	});

	return (
		<ConfigContext.Provider value={[config, setConfig]}>
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
		</ConfigContext.Provider>
	)
};

export default App;
