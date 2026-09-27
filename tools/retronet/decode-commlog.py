#!/usr/bin/env python3
"""Decode a NABU Internet Adapter CommLog.txt into RetroNET transactions.

The IA's comm log (Settings: LogCommunicationToFile) records every byte in
each direction, but in arbitrary chunks. This walks the NABU's bytes as a
stream of commands of known shape and takes each reply's bytes from the IA's
stream, printing one line per transaction. It starts at the first RetroNET
command, skipping the boot image. "leftover IA bytes 0" at the end means
every reply was the length we expected.

usage: tools/retronet/decode-commlog.py CommLog.txt

To decode one session, cut the log at its "Init mode started" line first.
See docs/cloud-cpm-protocol.md.
"""

import re
import sys


class Stream:
    def __init__(self, data):
        self.data, self.pos = data, 0

    def get(self, n):
        r = self.data[self.pos:self.pos + n]
        if len(r) < n:
            raise EOFError
        self.pos += n
        return r

    def u8(self):
        return self.get(1)[0]

    def u16(self):
        return int.from_bytes(bytes(self.get(2)), 'little')

    def i32(self):
        return int.from_bytes(bytes(self.get(4)), 'little', signed=True)

    def string(self):
        return bytes(self.get(self.u8())).decode('latin1')


def load(path):
    nabu, ia, started = [], [], False
    for line in open(path, errors='replace'):
        m = re.match(r'(NABU|IA)\s+\(\d+\): (.*)', line)
        if not m:
            continue
        data = [int(x, 16) for x in re.findall(r'0x([0-9A-F]{2})', m.group(2))]
        if not started and m.group(1) == 'NABU' and data and data[0] in (0xA8, 0xA3):
            started = True
        if started:
            (nabu if m.group(1) == 'NABU' else ia).extend(data)
    return Stream(nabu), Stream(ia)


def hexs(b):
    return bytes(b).hex(' ')


def cpm_name(b):
    b = bytes(b).decode('latin1')
    return b[:8].rstrip() + '.' + b[8:11].rstrip()


def details(b):
    size = int.from_bytes(bytes(b[:4]), 'little', signed=True)
    return f'size={size} {bytes(b[19:19 + b[18]]).decode("latin1")}'


def cloud_cpm(n, i):
    sub = n.u8()
    if sub in (4, 5, 6, 7, 8, 11):
        d, u, name = n.u8(), n.u8(), cpm_name(n.get(11))
        where = f'{chr(65 + d)}{u}:{name}'
        if sub == 4:
            return f'open {where} => {hexs(i.get(2))}'
        if sub == 5:
            return f'make {where} => {hexs(i.get(1))}'
        if sub == 6:
            return f'delete {where}'
        if sub == 7:
            return f'rename {where} -> {cpm_name(n.get(11))}'
        if sub == 8:
            return f'size {where} => {i.u16()}'
        status = i.u8()
        entry = hexs(i.get(128)[:16]) if status == 0 else ''
        return f'search first {where} => {status:02x} {entry}'
    if sub == 9:
        h, rec = n.u8(), n.u16()
        status = i.u8()
        if status == 0:
            i.get(128)
        return f'read h={h} rec={rec} => {status:02x}'
    if sub == 10:
        h, rec = n.u8(), n.u16()
        n.get(128)
        return f'write h={h} rec={rec}'
    if sub == 12:
        status = i.u8()
        entry = hexs(i.get(128)[:16]) if status == 0 else ''
        return f'search next => {status:02x} {entry}'
    if sub == 13:
        return f'sub13 {hexs(n.get(2))}'
    if sub == 14:
        return f'close h={n.u8()}'
    if sub == 15:
        h, off, ln = n.u8(), n.i32(), n.u16()
        got = i.u16()
        i.get(got)
        return f'readBulk h={h} off={off} len={ln} => {got}'
    if sub == 16:
        return 'reset session'
    raise ValueError(f'unknown 0xED subcommand {sub}')


def command(c, n, i):
    if c == 0xED:
        return 'ED ' + cloud_cpm(n, i)
    if c == 0xA8:
        return f'A8 size {n.string()} => {i.i32()}'
    if c == 0xA3:
        name, flag, h = n.string(), n.u16(), n.u8()
        return f'A3 open {name} flag={flag} h={h} => {i.u8()}'
    if c == 0xA7:
        return f'A7 close h={n.u8()}'
    if c == 0xA4:
        return f'A4 size h={n.u8()} => {i.i32()}'
    if c == 0xA5:
        h, off, ln = n.u8(), n.i32(), n.u16()
        got = i.u16()
        i.get(got)
        return f'A5 read h={h} off={off} len={ln} => {got}'
    if c == 0xA9:
        h, ln = n.u8(), n.u16()
        n.get(ln)
        return f'A9 append h={h} len={ln}'
    if c in (0xAA, 0xAC):
        h, off, ln = n.u8(), n.i32(), n.u16()
        n.get(ln)
        return f'{c:02X} {"insert" if c == 0xAA else "replace"} h={h} off={off} len={ln}'
    if c == 0xAB:
        h, off, ln = n.u8(), n.i32(), n.u16()
        return f'AB delete range h={h} off={off} len={ln}'
    if c == 0xB0:
        return f'B0 truncate h={n.u8()}'
    if c == 0xAD:
        return f'AD delete {n.string()}'
    if c in (0xAE, 0xAF):
        src, dst, flag = n.string(), n.string(), n.u8()
        return f'{c:02X} {"copy" if c == 0xAE else "move"} {src} -> {dst} flag={flag}'
    if c == 0xB1:
        path, wild, flags = n.string(), n.string(), n.u8()
        return f'B1 list {path!r} {wild!r} flags={flags} => {i.u16()}'
    if c == 0xB2:
        ix = n.u16()
        return f'B2 item {ix} => {details(i.get(83))}'
    if c == 0xB3:
        name = n.string()
        return f'B3 details {name} => {details(i.get(83))}'
    if c == 0xB4:
        h = n.u8()
        return f'B4 details h={h} => {details(i.get(83))}'
    if c == 0xB5:
        h, ln = n.u8(), n.u16()
        got = i.u16()
        i.get(got)
        return f'B5 readseq h={h} len={ln} => {got}'
    if c == 0xB6:
        h, off, whence = n.u8(), n.i32(), n.u8()
        return f'B6 seek h={h} off={off} whence={whence} => {i.i32()}'
    if c == 0xE7:
        name, off, ln = n.string(), n.i32(), n.u16()
        got = i.u16()
        i.get(got)
        return f'E7 read {name} off={off} len={ln} => {got}'
    if c == 0xDC:
        h = n.u8()
        return f'DC line count h={h} => {i.u16()}'
    if c == 0xDD:
        h, line = n.u8(), n.u16()
        got = i.u16()
        return f'DD get line h={h} {line} => {bytes(i.get(got)).decode("latin1")!r}'
    if c == 0xDA:
        return f'DA printer {n.u8():02x}'
    if c == 0xD7:
        ln = n.u8()
        got = i.u8()
        i.get(got)
        return f'D7 server read {ln} => {got}'
    if c == 0xD8:
        ln = n.u8()
        n.get(ln)
        return f'D8 server write {ln}'
    raise ValueError(f'unknown command {c:02x}')


# NABU-protocol bytes that can appear between RetroNET commands (resets,
# status polls, image requests). They're skipped, with their replies.
SKIP = {0x83, 0x82, 0x81, 0x84, 0x8F, 0x85, 0x01, 0x05, 0x00, 0x10, 0x06}


def main():
    n, i = load(sys.argv[1])
    try:
        while n.pos < len(n.data):
            c = n.u8()
            if c in SKIP:
                continue
            print(command(c, n, i))
    except EOFError:
        print('(log ends mid-command)')
    except ValueError as e:
        print(f'stopped: {e} at NABU byte {n.pos}: {hexs(n.data[n.pos:n.pos + 12])}')
    print(f'leftover IA bytes {len(i.data) - i.pos}')


if __name__ == '__main__':
    main()
