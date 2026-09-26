# nabu.run

This is the code for [nabu.run](https://nabu.run), a
[NABU PC](https://en.wikipedia.org/wiki/NABU_Network) "Adaptor" emulator written
in JavaScript. It runs in a browser and uses
[WebSerial](https://wicg.github.io/serial/) to deliver software to the NABU, as
long as your computer has a suitable RS-422 adapter.

Made by [Christopher Masto](https://masto.me) using
[Preact](https://preactjs.com/) and [Robot](https://thisrobot.life/).

# WebSockets

nabu.run can connect to a WebSocket, e.g. for emulators or IP to serial bridges.
To use native TCP sockets, you will need to run a local proxy server, such as
[websocat](https://github.com/vi/websocat).

## Using MAME with nabu.run and websocat

To start `websocat` listening on WebSockets port 5818 and TCP port 5817, use the
following command:

```sh
websocat -v --binary -E ws-l:127.0.0.1:5818 reuse-raw:autoreconnect:tcp-l:127.0.0.1:5817
```

Then select "Connect WebSocket" in nabu.run and enter the URL
`ws://127.0.0.1:5818`.

At this point, you can run MAME and connect to port 5817 for NABU serial
emulation. How to do this depends on your MAME setup. This is what I use on my
Mac:

```sh
mame nabupc -window -kbd nabu_hle -hcca null_modem -bitb socket.127.0.0.1:5817
```

It was also necessary to go into the MAME machine settings and configure the
serial port to RX and TX baud rates of 115200, and 2 stop bits.

# Channel list

The channels nabu.run offers come from a JSON file, set by
`PREACT_APP_CHANNELS_URL` in `.env`. It groups channels into categories, which
the channel guide shows in order:

```json
{
  "categories": [
    {
      "name": "NABU Cycles",
      "description": "The original NABU Network broadcasts, restored.",
      "color": "#d7b454",
      "channels": [
        {
          "label": "NABU Network 1986 Cycle v3",
          "value": "cycle-3",
          "default": true,
          "author": "NABU Corp.",
          "description": "The third NABU cycle ...",
          "icon": { "pattern": "AACAwODw...", "color": "lJSUlJSU..." },
          "channel": { "imageDir": "assets/cycles/cycle-3", "imageName": null }
        }
      ]
    }
  ]
}
```

- `label`, `value` and `channel` are required. `value` identifies the channel,
  so it has to be unique across the whole file. `channel` is what the adaptor
  serves: `imageDir`, `imageName` (a single file, or `null` for a cycle of
  paks), and optionally `baseUrl` and `imageType`.
- `default: true` picks the channel to start on; otherwise it's the first one.
- `author`, `description` and `icon` are optional and shown in the guide. `icon`
  is a 16x16 TMS9918 tile in the Internet Adapter's format: base64
  `IconTilePattern` and `IconTileColor` (32 bytes each), copied as-is from its
  `filesV3.json`. Channels without one get the NABU logo.
- A category's `description` and `color` are optional too.
- Channel numbers are made up from the order: the 3rd channel in the 2nd
  category is 203. Reordering the file renumbers them.

A plain array of channels (the old format) still works, as one category.

# Development

Requires Node.js 22.12 or newer. Built with [Vite](https://vite.dev/).

```bash
# install dependencies
npm install

# serve with hot reload at localhost:5173
npm run dev

# build for production into build/
npm run build

# test the production build locally at localhost:8080
npm run serve

# lint and run tests
npm run lint
npm test
```

Build settings (channel list URL, default base URL, RetroNET proxy) are in
`.env`. Put local overrides in `.env.local`, which isn't committed.

The protocol tests can also replay real cycle paks. Set `NABU_CYCLES_DIR` (in
`.env.local` or the environment) to a directory of paks laid out as
`<cycle>/<pak id>.pak`, e.g. `cycle-2/000001.pak`. A sample is replayed by
default; set `NABU_ALL_PAKS=1` to replay every pak in the directory.

## Releasing

```bash
export NABU_RUN_DEPLOY_TARGET=user@host:nabu.run/   # an rsync destination
tools/release.sh        # build, and show what deploying would change
tools/release.sh --go   # build, and deploy
```

Without `NABU_RUN_DEPLOY_TARGET`, the release is built and checked but not
deployed.

The release is built from a fresh export of the last commit. Bump the version
with `npm version <x.y.z> --no-git-tag-version`, which updates both
`package.json` and `package-lock.json`.
