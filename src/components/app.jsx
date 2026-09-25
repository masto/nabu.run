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
import { useMachine } from './use-machine';

import adaptorMachine from '../machines/adaptor';
import { ConfigContext, channelFromEntry } from './config-context';
import { parseChannelList } from './channel-list';
import { AdaptorContext } from './adaptor-context';

import Header from './header';
import Home from '../routes/home';
import Faq from '../routes/home/faq';

const env = import.meta.env;

const initConfig = () => {
  const baseUrl = env.PREACT_APP_BASE_URL ?? '';
  return {
    channelsUrl: env.PREACT_APP_CHANNELS_URL ?? 'https://catalog.nabu.run/channels.json',
    baseUrl,
    rnProxyUrl: env.PREACT_APP_RETRONET_PROXY ?? '',
    // Used until the channel list loads, or if it fails to.
    channel: {
      baseUrl,
      imageDir: env.PREACT_APP_IMAGE_DIR ?? '',
      imageName: env.PREACT_APP_IMAGE_NAME ?? null,
    },
  };
};

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

  return response.json();
};


const App = () => {
  const [config, setConfig] = useState(initConfig);
  useEffect(() => syncConfig(config), [config]);

  const adaptor = useMachine(adaptorMachine, {
    serial: navigator.serial,
    getChannel: () => extern_config.channel,
    rnProxyUrl: config.rnProxyUrl,
    ...(import.meta.env.DEV ? { log: (...a) => console.log(...a) } : {})
  });

  useEffect(() => {
    if (!config.channelsUrl) return;
    loadChannelList(config.channelsUrl)
      .then(data => setConfig(config => {
        const { categories, channels } = parseChannelList(data);
        // The list can mark a default; otherwise start with the first entry.
        const entry = channels.find(c => c.default) ?? channels[0];
        return entry ? {
          ...config,
          channelCategories: categories,
          channelList: channels,
          channelValue: entry.value,
          channel: channelFromEntry(config, entry),
        } : config;
      }))
      .catch(e => console.error('could not load channel list:', e));
  }, [config.channelsUrl]);

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
  );
};

export default App;
