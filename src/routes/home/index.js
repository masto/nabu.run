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

import { useContext } from 'preact/hooks';
import AdaptorContext from '../../components/adaptor-context';
import style from './style.css';

import 'robot3/debug';

const hex = (d, l = 2) => '0x' + Number(d).toString(16).padStart(l, '0');

const Home = () => {
	const [current, send] = useContext(AdaptorContext);

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

			{current.context?.serial ? <SerialButton current={current} send={send} /> : ""}

			<p class={style.small}>
				<a href="https://youtu.be/PoQDRdr75cA">Demo video</a>, <a href="/faq">FAQ</a>
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

function AdaptorState(props) {
	const { current } = props;

	const state = current.name;
	const port = current.context?.port;
	const progress = current.context?.progress;
	const pakId = current.context?.image?.pakId;

	const portStatus = port ? (() => {
		const i = port.getInfo();
		return `vendor=${hex(i.usbVendorId, 4)} product=${hex(i.usbProductId, 4)}`;
	})()
		: current.context?.serial ? 'not connected' : 'WebSerial is not available';

	return (
		<p>
			<div>Adaptor state: {state}</div>
			<div>Port: {portStatus}</div>
			{pakId ? <div>Requested PAK: {pakId}</div> : ""}
			{progress ? <ProgressIndicator complete={progress.complete} total={progress.total} /> : ""}
		</p>
	);
}

function SerialButton() {
	const [current, send] = useContext(AdaptorContext);
	const port = current.context?.port;

	const title = !port ? 'Select Port' : 'Close Port';
	const onClick = !port ? () => send('request') : () => port.forget();

	return <p><button class={style.port} onClick={onClick}>{title}</button></p >;
}

export default Home;
