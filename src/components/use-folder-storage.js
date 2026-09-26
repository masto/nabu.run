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

// Whether the NABU's files are kept temporarily (in memory) or in a local
// folder, for the Storage control in the header.
//
// status is one of:
//   loading      finding out
//   unsupported  this browser can't use folders
//   none         no folder chosen yet
//   saved        a folder was chosen before, but the browser needs the
//                user's say-so to use it again (attention: they were using
//                it, so it's the thing to do)
//   ready        allowed to use the folder, but temporary was chosen
//   active       files are kept in the folder

import { createContext } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';

import * as NABU from '../machines/adaptor/constants';
import { loadFolderSettings, updateFolderSettings } from './folder-settings';

export const StorageContext = createContext(null);

const supported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export function useFolderStorage(manager, channel) {
  const [status, setStatus] = useState(supported() ? 'loading' : 'unsupported');
  const [folder, setFolder] = useState(null);
  const [attention, setAttention] = useState(false);
  const [progress, setProgress] = useState({});
  const [error, setError] = useState(null);

  const activate = useCallback(async handle => {
    manager.setRoot(handle);
    setFolder(handle);
    setStatus('active');
    setAttention(false);
    setError(null);
    await updateFolderSettings({ handle, mode: 'folder' });
  }, [manager]);

  // Start where the user left off, reconnecting by itself if the browser
  // still allows it (as it will after "Allow on every visit").
  useEffect(() => {
    if (!supported()) return;
    loadFolderSettings().then(async settings => {
      if (!settings?.handle) {
        setStatus('none');
        return;
      }
      setFolder(settings.handle);
      const permission = await settings.handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        if (settings.mode === 'folder') {
          manager.setRoot(settings.handle);
          setStatus('active');
        }
        else {
          setStatus('ready');
        }
      }
      else {
        setStatus('saved');
        setAttention(settings.mode === 'folder');
      }
    }).catch(e => {
      console.error('could not load folder settings:', e);
      setStatus('none');
    });
  }, [manager]);

  useEffect(() => manager.subscribe(event => {
    if (event.type === 'progress') {
      setProgress(p => ({ ...p, [event.channel]: event.progress }));
    }
    else if (event.type === 'error') {
      console.error('local folder:', event.error);
      setError(event.error);
      // The browser took back its permission; stop using the folder until
      // the user reconnects.
      if (event.error?.code === NABU.NHACP_ERROR_EACCES) {
        manager.setRoot(null);
        setStatus('saved');
        setAttention(true);
      }
    }
  }), [manager]);

  // Get the channel's folder ready (copying its files in) as soon as it's
  // in use, rather than when the NABU first asks for a file.
  useEffect(() => {
    if (status === 'active' && manager.usesFolder(channel)) {
      manager.folderFor(channel).catch(() => { });
    }
  }, [manager, status, channel]);

  // Write out changes before the page goes away.
  useEffect(() => {
    const flush = () => { manager.flush().catch(() => { }); };
    const warn = event => {
      if (!manager.dirty) return;
      flush();
      event.preventDefault();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', warn);
    };
  }, [manager]);

  // Ask for a folder. Has to happen in response to a click.
  const pick = async () => {
    let handle;
    try {
      handle = await window.showDirectoryPicker({ id: 'nabu-run', mode: 'readwrite' });
    }
    catch (e) {
      if (e.name !== 'AbortError') setError(e);
      return;
    }
    // A different folder starts with nothing copied into it.
    if (!folder || !await handle.isSameEntry(folder)) {
      await updateFolderSettings({ handle, copies: {} });
    }
    await activate(handle);
  };

  const chooseFolder = async () => {
    if (status === 'none') return pick();
    if (status === 'saved') {
      // Also has to happen in response to a click.
      const permission = await folder.requestPermission({ mode: 'readwrite' });
      if (permission === 'granted') await activate(folder);
      return;
    }
    if (status === 'ready') await activate(folder);
  };

  const chooseTemporary = async () => {
    if (status !== 'active') return;
    manager.setRoot(null);
    setStatus('ready');
    await updateFolderSettings({ mode: 'temporary' });
  };

  // For trying things out from the console, e.g. with the private folder
  // that needs no picker: nabuRunUseFolder(await navigator.storage.getDirectory())
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.nabuRunUseFolder = activate;
    return () => { delete window.nabuRunUseFolder; };
  }, [activate]);

  return {
    status,
    folderName: folder?.name,
    attention,
    copying: channel?.id ? progress[channel.id] ?? null : null,
    error,
    chooseFolder,
    chooseTemporary,
    change: pick,
  };
}
