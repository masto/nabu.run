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
import { useState, useEffect } from 'preact/hooks';
import { useMachine } from 'preact-robot';

import adaptorMachine from '/machines/adaptor';
import { ConfigContext } from './config-context';
import { AdaptorContext } from './adaptor-context';

import Header from './header';
import Home from '../routes/home';
import Faq from '../routes/home/faq';

const initConfig = () => {
  let
    baseUrl = '',
    imageDir = '',
    imageName = null,
    channelsUrl = '/channels.json',
    rnProxyUrl = '';
  try { baseUrl = process.env.PREACT_APP_BASE_URL } catch { };
  try { imageDir = process.env.PREACT_APP_IMAGE_DIR } catch { };
  try { imageName = process.env.PREACT_APP_IMAGE_NAME } catch { };
  try { channelsUrl = process.env.PREACT_APP_CHANNELS_URL } catch { };
  try { rnProxyUrl = process.env.PREACT_APP_RETRONET_PROXY } catch { };

  return {
    channelsUrl,
    baseUrl,
    rnProxyUrl,
    channel: { baseUrl, imageDir, imageName }
  };
}

// This is the only way I've been able to allow the state machine to
// have access to live app configuration.
const extern_config = {};
const syncConfig = newConfig => {
  for (let k in extern_config) delete extern_config[k];
  Object.assign(extern_config, newConfig);
};

const loadChannelList = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch channels: ${response.status}`);
  }

  const channels = await response.json();

  return channels;
};


const App = () => {
  const [config, setConfig] = useState(initConfig());
  useEffect(() => syncConfig(config), [config]);

  const adaptor = useMachine(adaptorMachine, {
    // Use of `navigator` breaks pre-rendering, so wrap it in a guard
    serial: typeof window !== 'undefined' ? navigator?.serial : undefined,
    getChannel: () => extern_config.channel,
    rnProxyUrl: config.rnProxyUrl,
    ...(process.env.NODE_ENV === 'development' ?
      { log: (...a) => console.log(...a) } : {})
  });

  useEffect(() => {
    if (config.channelsUrl)
      loadChannelList(config.channelsUrl).then(list => setConfig({ ...config, channelList: list }));
  }, []);

  return (
    <ConfigContext.Provider value={[config, setConfig]}>
      <AdaptorContext.Provider value={adaptor}>
        <div id="app">
          <Header />
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
