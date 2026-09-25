# nabu.run

This is the code for [nabu.run](https://nabu.run), a [NABU
PC](https://en.wikipedia.org/wiki/NABU_Network)
"Adaptor" emulator written in JavaScript. It runs in a browser and uses
[WebSerial](https://wicg.github.io/serial/) to deliver software to the NABU,
as long as your computer has a suitable RS-422 adapter.

Made by [Christopher Masto](https://masto.me)
using [Preact](https://preactjs.com/)
and [Robot](https://thisrobot.life/).

# WebSockets

nabu.run can connect to a WebSocket, e.g. for emulators or IP to serial
bridges. To use native TCP sockets, you will need to run a local proxy server,
such as [websocat](https://github.com/vi/websocat).

## Using MAME with nabu.run and websocat

To start `websocat` listening on WebSockets port 5818 and TCP port 5817, use
the following command:

```sh
websocat -v --binary -E ws-l:127.0.0.1:5818 reuse-raw:autoreconnect:tcp-l:127.0.0.1:5817
```

Then select "Connect WebSocket" in nabu.run and enter the URL
`ws://127.0.0.1:5818`.

At this point, you can run MAME and connect to port 5817 for NABU serial
emulation. How to do this depends on your MAME setup. This is what I use on
my Mac:

```sh
mame nabupc -window -kbd nabu_hle -hcca null_modem -bitb socket.127.0.0.1:5817
```

It was also necessary to go into the MAME machine settings and configure the
serial port to RX and TX baud rates of 115200, and 2 stop bits.

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
