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

// The channel list (channels.json) is either the original flat array of
// channel entries, or an object with categories:
//
//   { "categories": [
//       { "name": "Games", "description": "...", "color": "#34c84c",
//         "channels": [ { "label", "value", "channel", ... } ] } ] }
//
// Either way it becomes a list of categories, each channel getting a
// channel number (category, then position: 3rd channel of category 2 is
// "203") and the name of its category.
//
// A channel with "disabled": "reason" is left out, as if it weren't there;
// the reason is a note for whoever maintains the list (e.g. "Needs
// RetroNET file handles, which aren't implemented").

// TMS9918 colors, used for categories that don't pick their own.
const CATEGORY_COLORS = [
  '#d7b454', '#1ee2ef', '#34c84c', '#ff5f4c', '#b2b2b2', '#514bfb', '#af329a',
];

export function parseChannelList(data) {
  const raw = Array.isArray(data)
    ? [{ name: 'Channels', channels: data }]
    : (data?.categories ?? []);

  const categories = raw
    .map((c, ci) => {
      const name = c.name ?? `Category ${ci + 1}`;
      const channels = (c.channels ?? [])
        .filter(e => e?.value && e.channel && !e.disabled)
        .map((e, i) => ({
          ...e,
          number: `${ci + 1}${String(i + 1).padStart(2, '0')}`,
          category: name,
        }));
      return {
        name,
        description: c.description ?? '',
        color: c.color ?? CATEGORY_COLORS[ci % CATEGORY_COLORS.length],
        channels,
      };
    })
    .filter(c => c.channels.length);

  return { categories, channels: categories.flatMap(c => c.channels) };
}

// Every word of the query has to appear somewhere in the entry, or be the
// start of its channel number.
export function searchChannels(channels, query) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w);
  if (!words.length) return channels;

  return channels.filter(e => {
    const text = [e.label, e.author, e.description, e.category, e.value,
      e.channel.imageName].filter(s => s).join(' ').toLowerCase();
    return words.every(w => text.includes(w) || e.number.startsWith(w));
  });
}

// TMS9918 palette; color 0 is transparent.
const PALETTE = [
  null, [0, 0, 0], [10, 173, 30], [52, 200, 76], [43, 45, 227],
  [81, 75, 251], [189, 41, 37], [30, 226, 239], [251, 44, 43],
  [255, 95, 76], [189, 162, 43], [215, 180, 84], [10, 140, 24],
  [175, 50, 154], [178, 178, 178], [255, 255, 255],
];

// The NABU logo tile, for channels without an icon.
export const DEFAULT_ICON = {
  pattern: 'AD8AkpXV1de1tZWVlQA/AAD8AHVVVWV1VVVVVXcA/AA=',
  color: '9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQ=',
};

const fromBase64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// Decode a 16x16 icon to RGBA pixels, or null if it isn't valid. The icon
// is the Internet Adapter's IconTilePattern/IconTileColor: four 8x8
// pattern tiles in sprite order (top left, bottom left, top right, bottom
// right), and a color byte per tile row with the foreground in the high
// nibble and background in the low one.
export function decodeIcon(icon) {
  let pattern, color;
  try {
    pattern = fromBase64(icon.pattern);
    color = fromBase64(icon.color);
  }
  catch {
    return null;
  }
  if (pattern.length < 32 || color.length < 32) return null;

  const pixels = new Uint8ClampedArray(16 * 16 * 4);
  for (let tile = 0; tile < 4; tile++) {
    const x0 = tile & 2 ? 8 : 0;
    const y0 = tile & 1 ? 8 : 0;
    for (let row = 0; row < 8; row++) {
      const bits = pattern[tile * 8 + row];
      const fg = color[tile * 8 + row] >> 4;
      const bg = color[tile * 8 + row] & 0xf;
      for (let col = 0; col < 8; col++) {
        const rgb = PALETTE[bits & (0x80 >> col) ? fg : bg];
        if (!rgb) continue;
        const i = ((y0 + row) * 16 + x0 + col) * 4;
        pixels.set([...rgb, 255], i);
      }
    }
  }
  return pixels;
}

// Recently tuned channels, most recent first, kept in this browser only.
const RECENT_KEY = 'nabu.run:recentChannels';
const RECENT_MAX = 5;

export function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(list) ? list.filter(v => typeof v === 'string') : [];
  }
  catch {
    return [];
  }
}

export function addRecent(recent, value) {
  const list = [value, ...recent.filter(v => v !== value)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  }
  catch {
    // Storage can be unavailable (private windows); recents just won't stick.
  }
  return list;
}

// The channel in the page's URL (?ch=ishkur-nfs), so a channel can be
// bookmarked or shared and survives a reload. It uses the channel's value,
// which, unlike its number, doesn't change when the list is rearranged.
export const channelFromUrl = () =>
  new URLSearchParams(window.location.search).get('ch');

// Put a channel in the URL, or take it out if null. Replaces the current
// history entry, so changing channels doesn't fill up the back button.
export function setChannelInUrl(value) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set('ch', value);
  else url.searchParams.delete('ch');
  if (url.href !== window.location.href) {
    window.history.replaceState(window.history.state, '', url);
  }
}
