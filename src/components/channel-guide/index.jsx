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

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { searchChannels } from '../channel-list';
import { NabuIcon } from './nabu-icon';
import style from './style.module.css';

// Below this width the guide shows one section at a time: whichever one
// has focus.
const narrowQuery = '(max-width: 699px)';
const isNarrow = () => window.matchMedia?.(narrowQuery).matches ?? false;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 'es'}`;

// For attribute selectors: channel values are arbitrary strings.
const quote = s => `"${s.replace(/["\\]/g, '\\$&')}"`;

// The channel guide: search across everything, browse by category, and
// tune in. Keyboard: Tab and Left/Right move between sections, Up/Down
// move through the categories and channels, Enter on a channel tunes it.
export function ChannelGuide(props) {
  const { open, categories, channels, current, recent, onTune, onClose } = props;

  const dialogRef = useRef();
  const [query, setQuery] = useState('');
  // 0 is "all channels", then one per category.
  const [catIndex, setCatIndex] = useState(0);
  const [selected, setSelected] = useState(current);
  const [section, setSection] = useState('rail');

  // Focus can only move to an element once it has rendered (and on a
  // narrow screen, once its section is showing), so moves go through a
  // render and leave the selector to focus here.
  const pendingFocusRef = useRef(null);
  const [, rerender] = useReducer(n => n + 1, 0);

  const goTo = (name, selector) => {
    setSection(name);
    pendingFocusRef.current = selector;
    rerender();
  };

  useLayoutEffect(() => {
    const selector = pendingFocusRef.current;
    if (!selector) return;
    pendingFocusRef.current = null;
    const el = dialogRef.current.querySelector(selector);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest' });
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog.open) {
      // Start a fresh search, but stay in the category from last time.
      setQuery('');
      setSelected(current);
      setSection('search');
      dialog.showModal();
      // Search has autofocus; show where the current channel is.
      requestAnimationFrame(() => dialog.querySelector(`[data-channel=${quote(current)}]`)
        ?.scrollIntoView?.({ block: 'center' }));
    }
    else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, current]);

  const hasRail = categories.length > 1;
  const matches = useMemo(() => searchChannels(channels, query), [channels, query]);
  const category = catIndex > 0 ? categories[catIndex - 1] : null;
  const list = category ? matches.filter(e => e.category === category.name) : matches;
  const sel = list.find(e => e.value === selected) ?? list[0] ?? null;

  const rail = [
    { name: query ? 'All matches' : 'All channels', count: matches.length },
    ...categories.map(c => ({
      ...c, count: matches.filter(e => e.category === c.name).length,
    })),
  ];

  const recentEntries = recent
    .map(v => channels.find(e => e.value === v))
    .filter(e => e);

  // What a narrow screen shows: the focused section, or while typing in
  // search, the results.
  let visible = section === 'search' || section === 'recent'
    ? (query || !hasRail ? 'list' : 'rail')
    : section;
  if (visible === 'rail' && !hasRail) visible = 'list';

  // Selectors for the element that takes focus in each section.
  const railSel = i => `[data-cat="${i}"]`;
  const channelSel = e => `[data-channel=${quote(e.value)}]`;
  const selectedSel = '#channel-list [aria-selected="true"]';
  const tuneSel = '#channel-tune';
  const searchSel = '#channel-search';

  // Each returns whether there was anything to move to.
  const focusSearch = () => goTo('search', searchSel);
  const focusList = () => !!sel && (goTo('list', selectedSel), true);
  const focusRail = () => hasRail && (goTo('rail', railSel(catIndex)), true);
  const focusDetails = () => !!sel && (goTo('details', tuneSel), true);

  const onSearchKey = e => {
    if ((e.key === 'ArrowDown' || e.key === 'Enter') && sel) {
      e.preventDefault();
      focusList();
    }
  };

  const onRailKey = (e, i) => {
    const moves = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: rail.length - 1 };
    if (e.key in moves) {
      e.preventDefault();
      const next = moves[e.key];
      if (next < 0) focusSearch();
      else if (next < rail.length) {
        setCatIndex(next);
        goTo('rail', railSel(next));
      }
    }
    else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusList() || focusDetails();
    }
  };

  const onRailClick = i => {
    setCatIndex(i);
    if (isNarrow()) goTo('list', selectedSel);
  };

  const onChannelKey = (e, i) => {
    const moves = {
      ArrowDown: i + 1, ArrowUp: i - 1, PageDown: Math.min(i + 10, list.length - 1),
      PageUp: Math.max(i - 10, 0), Home: 0, End: list.length - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      const next = moves[e.key];
      if (next < 0) focusSearch();
      else if (next < list.length) {
        setSelected(list[next].value);
        goTo('list', channelSel(list[next]));
      }
    }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusRail() || focusSearch();
    }
    else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusDetails();
    }
    else if (e.key === 'Enter') {
      e.preventDefault();
      onTune(list[i].value);
    }
  };

  const onChannelClick = entry => {
    setSelected(entry.value);
    if (isNarrow()) goTo('details', tuneSel);
  };

  const onDetailsKey = e => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusList() || focusRail();
    }
  };

  const onRecentKey = (e, i) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step) {
      e.preventDefault();
      const next = recentEntries[i + step];
      if (next) goTo('recent', `[data-recent=${quote(next.value)}]`);
    }
  };

  const onRecentClick = entry => {
    setQuery('');
    setCatIndex(0);
    setSelected(entry.value);
    if (isNarrow()) goTo('details', tuneSel);
    else goTo('list', channelSel(entry));
  };

  const onBack = () => {
    if (visible === 'details') focusList() || focusSearch();
    else if (query) {
      setQuery('');
      focusSearch();
    }
    else focusRail() || focusSearch();
  };

  const listTitle = query
    ? `${plural(list.length, 'match')} for “${query.trim()}”${category ? ` in ${category.name}` : ''}`
    : category?.name ?? 'All channels';
  const listSub = category?.description
    || (query ? 'Titles, authors, descriptions and channel numbers' : `${channels.length} channels`);

  return (
    <dialog ref={dialogRef} class={style.guide} aria-labelledby="channel-guide-title"
      onCancel={e => { e.preventDefault(); onClose(); }}
      onClick={e => e.target === dialogRef.current && onClose()}>
      <div class={style.frame} data-visible={visible} data-rail={hasRail ? '' : undefined}>
        <div class={style.top}>
          {visible !== 'rail' && (hasRail || visible === 'details') ?
            <button type="button" class={style.back} onClick={onBack} aria-label="Back">
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M12 3L6 9l6 6" /></svg>
            </button> : ''}
          <h2 id="channel-guide-title">Channel Guide</h2>
          <div class={style.search} onFocusIn={() => setSection('search')}>
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="9" cy="9" r="6.5" /><path d="M14 14l6 6" /></svg>
            <input id="channel-search" type="search" autofocus autocomplete="off"
              aria-label="Search channels" aria-controls="channel-list"
              placeholder={`Search ${channels.length} channels`}
              value={query}
              onInput={e => { setQuery(e.currentTarget.value); setCatIndex(0); }}
              onKeyDown={onSearchKey} />
          </div>
          <button type="button" class={style.close} onClick={onClose} aria-label="Close channel guide">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 3l12 12M15 3L3 15" /></svg>
          </button>
        </div>

        {recentEntries.length ?
          <div class={style.recent} role="group" aria-label="Recent channels"
            onFocusIn={() => setSection('recent')}>
            <span>Recent</span>
            {recentEntries.map((e, i) =>
              <button type="button" key={e.value} data-recent={e.value}
                tabIndex={i === 0 ? 0 : -1}
                onClick={() => onRecentClick(e)} onKeyDown={ev => onRecentKey(ev, i)}>
                <NabuIcon icon={e.icon} size={24} />
                {e.label}
              </button>
            )}
          </div> : ''}

        <div class={style.body}>
          {hasRail ?
            <nav class={style.rail} aria-label="Categories" onFocusIn={() => setSection('rail')}>
              {rail.map((c, i) =>
                <button type="button" key={c.name} data-cat={i}
                  aria-pressed={i === catIndex ? 'true' : 'false'}
                  tabIndex={i === catIndex ? 0 : -1}
                  class={c.count ? '' : style.none}
                  onClick={() => onRailClick(i)} onKeyDown={e => onRailKey(e, i)}>
                  <span class={style.swatch} style={{ background: c.color ?? 'var(--nabu-white)' }} />
                  <span class={style.name}>{c.name}</span>
                  <span class={style.count}>{c.count}</span>
                </button>
              )}
            </nav> : ''}

          <div class={style.listPane} onFocusIn={() => setSection('list')}>
            <div class={style.listHead}>
              <div>{listTitle}</div>
              <div class={style.sub}>{listSub}</div>
            </div>
            <div class={style.list} id="channel-list" role="listbox" aria-label={listTitle}>
              {list.map((e, i) =>
                <button type="button" role="option" key={e.value} data-channel={e.value}
                  aria-selected={e === sel ? 'true' : 'false'}
                  tabIndex={e === sel ? 0 : -1}
                  onClick={() => onChannelClick(e)} onKeyDown={ev => onChannelKey(ev, i)}>
                  <span class={style.number}>{e.number}</span>
                  <NabuIcon icon={e.icon} />
                  <span class={style.label}>
                    <span>{e.label}</span>
                    <span class={style.sub}>
                      {[category ? null : e.category, e.author].filter(s => s).join(' · ')}
                    </span>
                  </span>
                  {e.value === current ? <span class={style.onAir}>On air</span> : ''}
                </button>
              )}
              {list.length ? '' :
                <p class={style.empty}>
                  No channels match “{query.trim()}”.<br />
                  Try a shorter word, an author, or a channel number.
                </p>}
            </div>
          </div>

          <section class={style.details} aria-label="Channel details"
            onFocusIn={() => setSection('details')}>
            {sel ? <ChannelDetails entry={sel} category={categories.find(c => c.name === sel.category)}
              current={sel.value === current}
              onTune={() => onTune(sel.value)} onClose={onClose} onKeyDown={onDetailsKey} /> : ''}
          </section>
        </div>
      </div>
    </dialog>
  );
}

function ChannelDetails(props) {
  const { entry, category, current, onTune, onClose, onKeyDown } = props;
  const { imageDir, imageName } = entry.channel;

  return (
    <>
      <div class={style.detailsHead}>
        <NabuIcon icon={entry.icon} size={112} />
        <div>
          <span class={style.badge} style={{ background: category?.color }}>CH {entry.number}</span>
          <span>{entry.category}</span>
        </div>
      </div>
      <h3>{entry.label}</h3>
      {entry.author ? <div>by {entry.author}</div> : ''}
      {entry.storage === 'folder' ?
        <div class={style.tag} title="This channel can keep its files in a folder on your computer">Local storage</div>
        : ''}
      <p class={style.description}>{entry.description}</p>
      <div class={style.file}>{imageName ? `${imageDir}/${imageName}` : imageDir}</div>
      {current ?
        <button type="button" id="channel-tune" class={style.tuned}
          onClick={onClose} onKeyDown={onKeyDown}>Now tuned</button> :
        <button type="button" id="channel-tune" class={style.tune}
          onClick={onTune} onKeyDown={onKeyDown}>Tune in</button>}
    </>
  );
}
