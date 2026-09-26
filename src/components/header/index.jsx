import style from './style.module.css';

import { useContext, useState } from 'preact/hooks';
import { AdaptorContext } from '../adaptor-context';
import { ConfigContext, channelFromEntry } from '../config-context';
import { addRecent, loadRecent } from '../channel-list';
import { ChannelGuide } from '../channel-guide';
import { NabuIcon } from '../channel-guide/nabu-icon';

import { WebSocketDialog } from './websocket-dialog';
import { StorageControl } from './storage-control';

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

  const [guideOpen, setGuideOpen] = useState(false);
  const [recent, setRecent] = useState(loadRecent);

  const setChannel = value => {
    const entry = config.channelList.find(c => c.value === value);
    setConfig({
      ...config,
      channelValue: value,
      channel: channelFromEntry(config, entry),
    });
    setRecent(recent => addRecent(recent, value));
    setGuideOpen(false);
  };

  const currentEntry = config.channelList?.find(c => c.value === config.channelValue);

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
        <img src="/assets/nabu-run.svg" alt="nabu.run logo" height="64" />
      </a>
      <div class={style.controls}>
        {currentEntry?.storage === 'folder' ? <StorageControl /> : ''}
        {currentEntry ?
          <ChannelButton entry={currentEntry} open={guideOpen}
            onClick={() => setGuideOpen(true)} />
          : ""}
        <div class={style.ports}>
          {current.context?.serial ? <SerialButton current={current} send={send} /> : ""}
          {current.context?.serial ? <WebSocketButton current={current} onClick={onClickWsButton} /> : ""}
        </div>
      </div>
      {config.channelList ?
        <ChannelGuide open={guideOpen}
          categories={config.channelCategories} channels={config.channelList}
          current={config.channelValue} recent={recent}
          onTune={setChannel} onClose={() => setGuideOpen(false)} />
        : ""}
      <WebSocketDialog open={wsDialogOpen} value={wsUrl}
        onConnect={handleConnect} onCancel={() => setWsDialogOpen(false)} />
    </header>
  );
};

function ChannelButton(props) {
  const { entry, open, onClick } = props;

  return (
    <div class={style.field}>
      <span class={style.caption} aria-hidden="true">Select channel</span>
      <button class={style.channel} onClick={onClick}
        aria-haspopup="dialog" aria-expanded={open ? 'true' : 'false'}>
        <NabuIcon icon={entry.icon} />
        <span class={style.channelText}>
          <span class={style.channelNumber}>Channel {entry.number}</span>
          <span class={style.channelLabel}>{entry.label}</span>
        </span>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 6l6 6 6-6" /></svg>
      </button>
    </div>
  );
}

export default Header;
