import { Link } from 'preact-router/match';
import style from './style.css';

import { useContext, useState } from 'preact/hooks';
import { AdaptorContext } from '../adaptor-context';
import { ConfigContext } from '../../components/config-context';

function SerialButton(props) {
  const { current, send } = props;

  const port = current.context?.port;
  const isWaiting = current.name === 'waitingForPort';

  const title = isWaiting ? 'Select Port' : 'Close Port';
  const onClick = isWaiting ? () => send('request') : () => port.forget();

  return <button class={style.port} onClick={onClick}>{title}</button>;
}

const Header = () => {
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
    <header class={style.header}>
      <a href="/" class={style.logo}>
        <img src="../../assets/nabu-run.svg" alt="nabu.run logo" height="64" />
      </a>
      <div class={style.controls}>
        {config.channelList ?
          <ChannelSelector
            channel={config.channel} channelList={config.channelList} onChange={setChannel} />
          : ""}
        {current.context?.serial ? <SerialButton current={current} send={send} /> : ""}
      </div>
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
