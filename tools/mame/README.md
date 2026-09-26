# MAME test harness

Boots a NABU in [MAME](https://www.mamedev.org/) against a headless copy of
the nabu.run adaptor, so you can check changes end to end without a browser
or hardware. It types commands, takes screenshots, and logs the whole
conversation between the NABU and the adaptor.

It needs MAME (with the `nabupc` ROMs) and Node. The adaptor runs the same
protocol code as the web app, bundled for Node with Vite's `rolldown`, and
serves files from a local directory instead of a web server.

```sh
tools/mame/run.sh <name> <directory> [imageName] <steps>
```

- `directory` plays the part of the channel's directory: paks, `.nabu`
  files, and anything opened over NHACP or RetroNET.
- `imageName` serves that one file for every image request, like a
  channel's `imageName`. Leave it out for a cycle of paks.
- `steps` are timed actions, separated by `|`, with times in emulated
  seconds since power-on:
  - `20:snap` saves a screenshot
  - `22:type:dir\n` types text (`\n` is Enter)
  - `30:exit` quits

For example, to boot Ishkur CP/M, list the disk, and save a file:

```sh
tools/mame/run.sh ishkur ../catalog.nabu.run/catalog/assets/ishkur/ndsk 000001.nabu \
  '20:type:dir\n|25:type:save 2 test.com\n|30:type:dir\n|35:snap|36:exit'
```

Everything ends up in `tools/mame/out/<name>/`: `adaptor.log` (every
state, request and reply), `mame.log`, and `snap/*.png`.

Settings, as environment variables:

- `NABU_MAME_ROMS`: MAME ROM path (default `mame/roms` in this repo)
- `NABU_MAME_PORT`: TCP port between MAME and the adaptor (default 5827)
- `NABU_MAME_OUT`: output directory (default `tools/mame/out`)

Things to know:

- Type in lowercase. MAME's natural keyboard drops every other shifted
  character, and a character right after a shifted one (so `*.com` comes
  out as `*com`). CP/M uppercases commands anyway.
- MAME runs with SDL's dummy video and audio drivers so no window opens;
  screenshots still work.
- MAME's config is copied fresh from `cfg/nabupc.cfg` for each run (null
  modem at 115200 baud, 2 stop bits), so your own MAME settings aren't
  touched.
