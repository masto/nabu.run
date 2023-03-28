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
import { ConfigContext } from '../../components/config-context';
import { baseName } from '../../machines/adaptor/util';
import style from './style.css';

const hex = (d, l = 2) => '0x' + Number(d).toString(16).padStart(l, '0');


const Home = () => {
	const [config, setConfig] = useContext(ConfigContext);
	const adaptor = useContext(AdaptorContext);
	const [current, send] = adaptor;

	const setChannel = event => {
		setConfig({
			...config,
			channel: {
				...config.channel, ...event.target.value
			}
		});
	};

	return (
		<div class={style.home}>
			<h1>
				Hello, NABU!
			</h1>

			<p>
				All you need is an RS-422 adapter and a browser that
				supports <a href="https://wicg.github.io/serial/">WebSerial</a> (Chrome)
				to get your NABU online. Use the button below to choose your serial port, and
				then switch on your NABU.
			</p>

			<AdaptorState current={current} />

			<p>
				{current.context?.serial ? <SerialButton current={current} send={send} /> : ""}
				{config.channelList ?
					<ChannelSelector
						channel={config.channel} channelList={config.channelList} onChange={setChannel} />
					: ""}
			</p>

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
		<ul>
			{handles.map((fh, i) =>
				<li>{'{' + i + '}'} {baseName(fh.fileName)}
					{fh.fileFlag & 1 ? ' (rw)' : ' (ro)'}</li>
			)}
		</ul>
	);
}

function AdaptorState(props) {
	const { current, onChange } = props;

	const state = current.name;
	const port = current.context?.port;
	const progress = current.context?.progress;

	const hasOpenFiles = current.context?.handles?.some(e => e);

	const portStatus = port ? (() => {
		const i = port.getInfo();
		return `vendor=${hex(i.usbVendorId, 4)} product=${hex(i.usbProductId, 4)}`;
	})()
		: current.context?.serial ? 'not connected' : 'WebSerial is not available';

	return (
		<p>
			<div>Adaptor state: {state}</div>
			<div>Port: {portStatus}</div>
			{progress ? <div class={style.progressMessage}>{progress.message}</div> : ""}
			{progress?.complete ? <ProgressIndicator complete={progress.complete} total={progress.total} /> : ""}
			{hasOpenFiles ? <OpenFileList handles={current.context.handles} /> : ""}
		</p>
	);
}

function SerialButton(props) {
	const { current, send } = props;

	const port = current.context?.port;
	const isWaiting = current.name === 'waitingForPort';

	const title = isWaiting ? 'Select Port' : 'Close Port';
	const onClick = isWaiting ? () => send('request') : () => port.forget();

	return <button class={style.port} onClick={onClick}>{title}</button>;
}

const Select = ({ label, value, options, onChange }) => {
	return (
		<label>
			{label}
			<select value={value} onChange={onChange}>
				{options.map((option) => (
					<option value={option.value}>{option.label}</option>
				))}
			</select>
		</label>
	);
};

function ChannelSelector(props) {
	const { channelList, onChange } = props;

	const [value, setValue] = useState('cycle 2 raw');

	const selectChannel = event => {
		setValue(event.target.value);
		const newChannel = channelList.find(v => v.value === event.target.value).channel;
		onChange({ target: { value: newChannel } });
	};

	return (
		<span class={style.channel}>
			<Select
				label='Channel:'
				options={channelList}
				value={value}
				onChange={selectChannel} />
		</span>
	)
}

export default Home;
