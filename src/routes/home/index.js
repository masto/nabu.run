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

import { useContext, useState } from 'preact/hooks';
import { AdaptorContext } from '../../components/adaptor-context';
import { baseName } from '../../machines/adaptor/util';
import style from './style.css';


const Home = () => {
  const adaptor = useContext(AdaptorContext);
  const [current, send] = adaptor;

  return (
    <div class={style.home}>
      <p>
        All you need is an RS-422 adapter and a browser that
        supports <a href="https://wicg.github.io/serial/">WebSerial</a> (Chrome)
        to get your NABU online. Use the button above to choose your serial port, and
        then switch on your NABU.
      </p>

      <AdaptorState current={current} />

      <p class={style.small}>
        <a href="https://youtu.be/PoQDRdr75cA">Demo video</a>
        , <a href="/faq">FAQ</a>
        , <a href="https://github.com/masto/nabu.run">Code</a>
      </p>

      <p class={style.small} style="text-align: right">
        Made by <a href="https://masto.me">@masto</a>
      </p>
    </div>
  );
};

function ProgressIndicator(props) {
  let { complete, total } = props;
  let pct = (complete / total) * 100;

  return (
    <div class={style.progressBar}>
      <div class={style.indicator} style={`width:${pct}%`}></div>
    </div>
  );
}

function OpenFileList(props) {
  const { handles } = props;

  return (
    <div class={style.openFileList}>
      <h2>Open files</h2>
      <ul>
        {handles.map((fh, i) =>
          <li>{'{' + i + '}'} {baseName(fh.fileName)}
            {fh.fileFlag & 1 ? ' (rw)' : ' (ro)'}</li>
        )}
      </ul>
    </div>
  );
}

function AdaptorState(props) {
  const { current, onChange } = props;

  const state = current.name;
  const port = current.context?.port;
  const portInfo = current.context?.portInfo;
  const progress = current.context?.progress;

  const hasOpenFiles = current.context?.rn?.handles?.some(e => e);

  return (
    <p>
      <div>Adaptor state: {state}</div>
      <div>Port: {portInfo ?? 'not connected'}</div>
      {progress ? <div class={style.progressMessage}>{progress.message}</div> : ""}
      {progress?.complete ? <ProgressIndicator complete={progress.complete} total={progress.total} /> : ""}
      {hasOpenFiles ? <OpenFileList handles={current.context.rn.handles} /> : ""}
    </p>
  );
}


export default Home;
