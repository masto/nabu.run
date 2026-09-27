# Cloud CP/M and the RetroNET protocol

What DJ Sures' Cloud CP/M needs from an adaptor, as observed from his
Internet Adapter (IA) version 2026.05.06.00 in September 2026. Nothing here
comes from a published spec for the CP/M part: DJ's
[RetroNET Protocol Definition](https://cloud.nabu.ca/docs/NABU%20RetroNET%20Protocol%20Definition.pdf)
(version 2026.02.14.01) covers the general file store, TCP and IA-control
commands, but not the `0xED` CP/M drive commands. Those were worked out by
disassembling the Cloud CP/M BIOS (vA.8) and confirmed byte for byte against
the IA's comm log; see [How this was worked out](#how-this-was-worked-out).

All multi-byte integers are little-endian.

## Channels and boot

There are four channels, each a small (about 900 byte) loader at `0x140D`:

| Channel | Loader | BIOS | Command processor |
|---|---|---|---|
| Cloud CP/M Text | `CPM22-Text.NABU` | `BIOS_CPM.BIN` | built-in CCP |
| Cloud CP/M GUI | `CPM22-GUI.NABU` | `BIOS_CPMGUI.BIN` | `CLOUDGUI.COM` |
| Cloud CP/M F18a Text | `CPM22C80-Text.NABU` | `BIOS_CPM80.BIN` | built-in CCP |
| Cloud CP/M F18a GUI | `CPM22C80-GUI.NABU` | `BIOS_CPM80GUI.BIN` | `CLOUDGUI.COM` |

The BIOS files and `CLOUDGUI.COM` are at `http://cloud.nabu.ca/cpm/`.

The loader looks for its BIOS as a local file first, then at the cloud URL,
reads it to `0xCB3F` (the BIOS image includes CCP and BDOS) and jumps to
`0xDD71`:

```
A8 size BIOS_CPM.BIN => -1                          local: not there
A8 size http://cloud.nabu.ca/cpm/BIOS_CPM.BIN => 13244
A3 open http://cloud.nabu.ca/cpm/BIOS_CPM.BIN => 0
B5 readseq h=0 len=20000 => 13244
B5 readseq h=0 len=20000 => 0
A7 close h=0
```

The BIOS then looks for its command processor, again local first. It keeps
that handle open for the whole session and re-reads the command processor
from it with `0xA5` on every warm boot:

```
A3 open CCPM (read-only) => ff                      optional override; absent
A3 open BIOS_CPM.BIN (read-only) => ff              GUI: CLOUDGUI.COM
A3 open http://cloud.nabu.ca/cpm/BIOS_CPM.BIN => 0  GUI: .../CLOUDGUI.COM
ED reset session
A5 read h=0 off=0 len=1980 => 1980                  GUI: len=53627 => 45228
ED search first A0:$$$.SUB => ff                    (text CCP only)
```

Opening a *missing local file read-only* must return `0xFF`. The loader
relies on that to fall back to the URL. (The spec says a local open creates
a 0-byte file; the IA only does that for read-write opens.)

Every warm boot (`^C`, or a program exiting) repeats `ED reset session`
followed by that `0xA5` reload.

## Drives

Drives are folders, not disk images (the older
[Cloud CP/M page](https://nabu.ca/cloud-cpm) describing `A.DSK` images is out
of date). The IA keeps them in its store folder as

```
<store>/CPM/<drive letter>/<user area in hex>/<file>
```

for example `CPM/A/0/STAT.COM` and `CPM/A/B/...` for user 11. The IA
populates them from
[`https://cloud.nabu.ca/cpm/allYourCPM.zip`](https://cloud.nabu.ca/cpm/allYourCPM.zip)
(5 MB, the same layout under a top-level `CPM/`), which currently has drives
A, B and N. The contents are listed at
[nabu.ca/cpm-software](https://nabu.ca/cpm-software). Files written by the
NABU go to the same folders.

File names on disk are not all uppercase (`robots.x`, `XDIR.Com`,
`thexder.rom`); the IA matches them without regard to case and reports them
in uppercase.

## The `0xED` CP/M drive commands

The Cloud CP/M BDOS sends every file operation to the adaptor as `0xED`
followed by a subcommand. Names are CP/M's 11-byte form: 8 name bytes and 3
extension bytes, space padded, no dot, possibly containing `?` wildcards.
`drive` is 0 for A:, 1 for B:, and so on; `user` is 0 to 15.

The letter is what the BIOS flashes in the top right corner of the screen
during the operation. The function name is what the IA logs.

| Sub | Letter | IA function | Request (after `ED sub`) | Reply |
|---|---|---|---|---|
| 4 | O | `rn_cpm_open` | drive, user, name[11] | handle, records |
| 5 | N | `rn_cpm_create` | drive, user, name[11] | handle |
| 6 | D | `rn_cpm_delete` | drive, user, name[11] | none |
| 7 | M | `rn_cpm_rename` | drive, user, name[11], new name[11] | none |
| 8 | S | `rn_cpm_fileSize` | drive, user, name[11] | records (u16) |
| 9 | R | `rn_cpm_read` | handle, record (u16) | status; 128 bytes if status is 0 |
| 10 | W | `rn_cpm_write` | handle, record (u16), data[128] | none |
| 11 | L | `rn_cpm_searchFirst` | drive, user, name[11] | status; 128 bytes if status is 0 |
| 12 | L | `rn_cpm_searchNext` | none | status; 128 bytes if status is 0 |
| 13 | T | ? | handle, records? (2 bytes) | none |
| 14 | C | `rn_cpm_close` | handle | none |
| 15 | R | `rn_cpm_readBulk` | handle, offset (u32), length (u16) | count (u16), data[count] |
| 16 | Z | `rn_cpm_resetSession` | none | none |

Subcommands 1 to 3 don't appear in the BIOS.

### Details

**Records** are 128 bytes and numbered from 0 from the start of the file.
CP/M's extents never appear on the wire; a 200-record file is read and
written with record numbers 0 to 199.

**Open (4)** replies with a handle and the file's size in records, capped at
`0x80` (a 152-record file reports `80`). A missing file is `ff 00`. Handles
start at 1.

**Create (5)** replies with a handle. What it does to an existing file, and
what it returns on failure (probably `ff`), hasn't been seen: the CCP's
`SAVE`, like standard CP/M, deletes the file before creating it.

**Delete (6)** accepts wildcards (`Z?.DAT` deleted `ZU.DAT`). Nothing to
delete is not an error.

**Rename (7)** takes the old and new names in the same drive and user.

**File size (8)** is BDOS function 35: the size in records, not capped
(`03 00` for a 384-byte file).

**Read (9)** replies `00` and 128 bytes, or `01` at end of file. A final
partial record is padded to 128 bytes with `1A`, CP/M's end-of-file
character. Sequential and random reads both arrive as this command.

**Write (10)** has no reply. Writing past the end grows the file, filling any
gap with zeros: records 5 and 7 written to a 3-record file leave an 8-record
file with records 3, 4 and 6 zeroed. BDOS 40 (write random with zero fill)
arrives as a plain write.

**Search (11, 12)** replies `ff` when there's nothing (more) to find, or `00`
and a 128-byte buffer: one 32-byte CP/M directory entry followed by 96 bytes
of `E5`. In the entry, the user byte is 0, the name is uppercase with the
high bits clear, `ex`, `s1` and `s2` are 0, `rc` is the size in records capped
at `0x80`, and the allocation map is all zero:

```
00 43 4c 53 20 20 20 20 20 43 4f 4d 00 00 00 26   .CLS     COM...&
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
e5 e5 e5 ... (96 bytes)
```

Entries come in the folder's order, not sorted. The IA keeps one search in
progress per session.

**Close (14)** has no reply.

**Sub 13** hasn't been seen on the wire. The BIOS sends the handle and a
byte from the FCB's record count, so it may truncate or set the size of a
file on close.

**Read bulk (15)** reads raw bytes from an open file into memory: `count` is
what was actually read. The GUI uses it to load programs whole (it asks for
53627 bytes, the size of the TPA, and gets 19399 for `TUTORIAL.COM`).

**Reset session (16)** closes every CP/M handle and forgets the search. It's
sent at startup and on every warm boot. The IA also does this when the NABU
resets (`0x83`).

Setting file attributes (BDOS 30) sends nothing.

## Other RetroNET commands Cloud CP/M uses

These are in DJ's spec; notes are where the IA differs or the spec is vague.

- File store: `0xA3` open, `0xA4` size by handle, `0xA5` read, `0xA7` close,
  `0xA8` size by name, `0xA9` append, `0xB0` truncate, `0xB5` sequential
  read, `0xB6` seek.
  - Names without a scheme are local files in the IA's store folder (the
    spec mentions drive letters and backslashes, e.g.
    `z:\test\directory\testing.txt`). Names with `http://`, `https://` or
    `ftp://` are downloaded.
  - `0xA8` reports −1 for a missing local file (not −2).
  - `0xA3` with flag 1 (read-write) creates a missing local file; read-only
    returns `0xFF`.
- `0xDA` printer: one byte for the `LST:` device. According to DJ's Cloud
  CP/M page, the IA appends it to `LST.TXT` in its store (not captured).
- `0xD7` / `0xD8` read and write on the IA's TCP server channel, for the
  `RDR:`/`PUN:` devices and console redirection (`STAT CON:=UC1:`). The BIOS
  sends `D7 01` (read up to 1 byte; reply is a count and that many bytes)
  and `D8 01 c`.
- `0xBA` IA control: the BIOS calls subcommand `0x1F`, which isn't in the
  spec.
- The GUI keeps its settings in `CLOUDGUI.CFG` (and checks for
  `CLOUDGUI.SET`) in the store root: size, open read-write, truncate, one
  10068-byte append, close. It loads help pictures from
  `https://cloud.nabu.ca/resources/help/*.sc2` with a seek and 128-byte
  sequential reads.

Many programs on the drives (chat, telnet, IRC, the games in A: user 1) also
use the TCP client commands `0xD0` to `0xD4`.

## Open questions

- Sub 13: what it is and when the BDOS sends it.
- Sub 5 on an existing file, and its failure reply.
- `0xBA 0x1F`.
- Whether CP/M handles and file-store handles share one numbering (they
  never overlapped in the captures: CP/M handles started at 1 while
  file-store handle 0 was open).

## How this was worked out

1. The BIOS was disassembled (it's loaded at `0xCB3F`; the byte-write
   routine is at `0xDE7E` in `BIOS_CPM.BIN`) to find every `0xED` request and
   the shape of its reply.
2. With the IA's comm log on (`LogCommunicationToFile`) and its verbose
   Cloud CP/M log (`VerboseCloudCPMLog`), MAME was pointed at the IA with
   `-bitb socket.127.0.0.1:<port>` and driven through `DIR`, `TYPE`, `SAVE`,
   `ERA`, `REN`, `STAT`, and the GUI.
3. [`tools/retronet/make-bdos-test.py`](../tools/retronet/make-bdos-test.py)
   builds `ZTEST.COM`, which runs through the BDOS file functions. Copied to
   `CPM/A/0/` in the IA's store and run from `A0>`, it covers what the CCP
   commands don't.
4. [`tools/retronet/decode-commlog.py`](../tools/retronet/decode-commlog.py)
   turns a comm log into one line per command. It knows each command's
   shape, so ending with "leftover IA bytes 0" confirms every reply length.
   Cut the log at a session's `Init mode started` line first, since boot
   image traffic between sessions isn't decoded.

The same two tools can check an implementation: run `ZTEST.COM` against
nabu.run and against the IA, and compare the decoded logs.
