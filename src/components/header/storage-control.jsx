// Where the NABU's files are kept, for channels that can use a local
// folder: temporary (in memory) or a folder on this computer. The state and
// actions come from useFolderStorage.

import style from './style.module.css';

import { useContext } from 'preact/hooks';
import { StorageContext } from '../use-folder-storage';

// A folder with a swap arrow: choose a different folder.
const ChangeFolderIcon = () => (
  <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
    <path d="M1.5 4.5v10a1 1 0 0 0 1 1h11" />
    <path d="M1.5 4.5v-2a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v3" />
    <path d="M13.5 12.5h7m-2.5-2.5 2.5 2.5-2.5 2.5" />
  </svg>
);

export function StorageControl() {
  const storage = useContext(StorageContext);
  const { status, folderName, attention, copying, error } = storage;

  const active = status === 'active';
  const unsupported = status === 'unsupported';
  const hasFolder = folderName && !unsupported;

  let folderLabel;
  if (unsupported || status === 'none' || status === 'loading') folderLabel = 'Local folder…';
  else if (status === 'saved' && attention) folderLabel = <>Reconnect <q>{folderName}</q></>;
  else if (active && copying) {
    const percent = copying.total ? Math.floor(100 * copying.done / copying.total) : 0;
    folderLabel = `Copying… ${percent}%`;
  }
  else folderLabel = `${folderName} folder`;

  let folderTitle;
  if (unsupported) folderTitle = 'Needs Chrome or Edge';
  else if (error) folderTitle = `Problem with the folder: ${error.message}`;
  else if (status === 'saved') folderTitle = `Keep files in the "${folderName}" folder again`;

  const partClass = [
    style.folderPart,
    active && style.on,
    status === 'saved' && attention && style.attention,
    unsupported && style.disabled,
  ].filter(c => c).join(' ');

  return (
    <div class={style.field} role="group" aria-labelledby="storage-label">
      <span class={style.caption}>
        <span id="storage-label">Storage</span>
        <a href="/faq#files" class={style.help}
          title="Where are my files kept?" aria-label="Where are my files kept?">?</a>
      </span>
      <span class={style.segments}>
        <button type="button" class={`${style.segment} ${style.temporary}`}
          aria-pressed={active ? 'false' : 'true'}
          onClick={storage.chooseTemporary}>
          Temporary
        </button>
        <span class={partClass}>
          <button type="button" class={style.segment}
            aria-pressed={active ? 'true' : 'false'}
            disabled={unsupported || status === 'loading'}
            title={folderTitle}
            onClick={storage.chooseFolder}>
            {folderLabel}
          </button>
          {hasFolder ?
            <button type="button" class={style.changeFolder}
              title="Choose a different folder" aria-label="Choose a different folder"
              onClick={storage.change}>
              <ChangeFolderIcon />
            </button>
            : ''}
        </span>
      </span>
    </div>
  );
}
