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

// The local folder the user chose, whether to use it, and which channels'
// files have been copied into it. Folder handles can only be kept in
// IndexedDB, so this lives there rather than in localStorage:
//
//   { handle, mode: 'folder' | 'temporary', copies: { [channel]: 'copying' | 'done' } }

const DB_NAME = 'nabu.run';
const STORE = 'settings';
const KEY = 'folder';

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transact = async (mode, fn) => {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
    });
  }
  finally {
    db.close();
  }
};

export const loadFolderSettings = async () => {
  try {
    return await transact('readonly', store => store.get(KEY)) ?? null;
  }
  catch {
    return null;
  }
};

// Merge `changes` into the saved settings.
export const updateFolderSettings = async changes => {
  const settings = { copies: {}, ...await loadFolderSettings(), ...changes };
  await transact('readwrite', store => store.put(settings, KEY));
  return settings;
};

// For the storage manager: which channels have been copied in.
export const folderCopies = {
  get: async channel => (await loadFolderSettings())?.copies?.[channel],
  set: async (channel, state) => {
    const settings = await loadFolderSettings();
    await updateFolderSettings({ copies: { ...settings?.copies, [channel]: state } });
  },
};
