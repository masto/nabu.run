import { Link } from 'preact-router/match';
import style from './style.css';

import { useContext, useState } from 'preact/hooks';
import { AdaptorContext } from '../adaptor-context';
import { ConfigContext } from '../../components/config-context';

import { WebSocketDialog } from './websocket-dialog';

function SerialButton(props) {
  const { current, send } = props;

  const port = current.context?.port;
  const isWaiting = current.name === 'waitingForPort';
  const isOpened = current.context?.portInfo?.match(/^serial/);

  const title = isOpened ? 'Close Port' : 'Connect Serial';
  const onClick = isWaiting ? () => send('requestSerial') : () => port.forget();

  return (
    <button
      class={style.port}
      disabled={!(isOpened || isWaiting)}
      onClick={onClick}>
      {title}
    </button>
  );
}

function WebSocketButton(props) {
  const { current, onClick } = props;

  const isWaiting = current.name === 'waitingForPort';
  const isOpened = current.context?.portInfo?.match(/^websocket/);

  const title = isOpened ? 'Close Port' : 'Connect WebSocket';
  const handleClick = isWaiting ? () => onClick() : () => {
    current.context.reader.cancel();
  };

  return (
    <button
      class={style.port}
      disabled={!(isOpened || isWaiting)}
      onClick={handleClick}>
      {title}
    </button>
  );
}

const Header = () => {
  const [config, setConfig] = useContext(ConfigContext);
  const adaptor = useContext(AdaptorContext);
  const [current, send] = adaptor;

  const setChannel = event => {
    setConfig({
      ...config,
      channel: {
        ...config.channel, baseUrl: config.baseUrl, ...event.target.value
      }
    });
  };

  const [wsDialogOpen, setWsDialogOpen] = useState(false);
  const [wsUrl, setWsUrl] = useState('ws://127.0.0.1:5818');

  const handleConnect = (event, value) => {
    setWsUrl(value);
    setWsDialogOpen(false);
    send({ type: 'requestSocket', value: value });
    event.preventDefault();
  };

  const onClickWsButton = () => setWsDialogOpen(true);

  return (
    <header class={style.header}>
      <a href="/" class={style.logo}>
        <img src="../../assets/nabu-run.svg" alt="nabu.run logo" height="64" />
      </a>
      <div class={style.controls}>
        {config.channelList ?
          <ChannelSelector
            channel={config.channel} channelList={config.channelList} onChange={setChannel} />
          : ""}
        <div class={style.ports}>
          {current.context?.serial ? <SerialButton current={current} send={send} /> : ""}
          {current.context?.serial ? <WebSocketButton current={current} onClick={onClickWsButton} /> : ""}
        </div>
      </div>
      <WebSocketDialog open={wsDialogOpen} value={wsUrl}
        onConnect={handleConnect} onCancel={() => setWsDialogOpen(false)} />
    </header>
  );
};

const Select = ({ label, value, options, onChange }) => {
  return (
    <>
      <label for="channel-select">
        {label}
      </label>
      <select value={value} onChange={onChange} id="channel-select">
        {options.map((option) => (
          <option value={option.value}>{option.label}</option>
        ))}
      </select>
    </>
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
        label='Channel'
        options={channelList}
        value={value}
        onChange={selectChannel} />
    </span>
  )
}

export default Header;
