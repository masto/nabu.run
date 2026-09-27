#!/usr/bin/env python3
"""Build ZTEST.COM, a CP/M program that exercises the BDOS file functions.

Under Cloud CP/M every BDOS file call becomes a 0xED request to the adaptor,
so running this on the real Internet Adapter and on nabu.run, and comparing
the two decoded comm logs, checks the whole file protocol. It prints
nothing; the adaptor's log is the output. It leaves ZBIG.DAT on A: user 0
and ZUSER1.DAT on A: user 1, and warm boots at the end.

In order:
  open NOSUCH.TXT (missing)          make ZT.DAT, write 3 records, close
  compute size of ZT.DAT             open ZT.DAT, random read record 1,
  random write record 5 (sparse),    random write with zero fill record 7
  close                              set attributes (R/O) on ZT.DAT
  search Z?.DAT, first and next      rename ZT.DAT to ZU.DAT
  make ZBIG.DAT, 200 records         in user 1: make ZUSER1.DAT, 1 record
  search B:????????.???              delete Z?.DAT (wildcard)

usage: tools/retronet/make-bdos-test.py [output]   (default ZTEST.COM)

See docs/cloud-cpm-protocol.md.
"""

import sys

ORG = 0x100
FCB_BASE = 0x600

code = bytearray()
fcbs = {}


def fcb(key, drive, name, ext, attr=0, rename_to=None):
    """An FCB in the data area. drive: 0 = current, 1 = A:, 2 = B:, ..."""
    f = bytearray(36)
    f[0] = drive
    f[1:9] = name.ljust(8).encode()
    f[9:12] = ext.ljust(3).encode()
    f[9] |= attr
    if rename_to:
        f[17:28] = (rename_to[0].ljust(8) + rename_to[1].ljust(3)).encode()
    fcbs[key] = (FCB_BASE + 36 * len(fcbs), f)


def emit(*b):
    code.extend(b)


def bdos(fn, key=None, e=None):
    emit(0x0E, fn)                                  # LD C,fn
    if key:
        addr = fcbs[key][0]
        emit(0x11, addr & 0xFF, addr >> 8)          # LD DE,fcb
    if e is not None:
        emit(0x1E, e)                               # LD E,n
    emit(0xCD, 0x05, 0x00)                          # CALL 5


def poke(key, offset, value):
    addr = fcbs[key][0] + offset
    emit(0x3E, value, 0x32, addr & 0xFF, addr >> 8)  # LD A,n; LD (nn),A


fcb('nosuch', 0, 'NOSUCH', 'TXT')
fcb('zt', 0, 'ZT', 'DAT')
fcb('zt2', 0, 'ZT', 'DAT')
fcb('attr', 0, 'ZT', 'DAT', attr=0x80)
fcb('wild', 0, 'Z?', 'DAT')
fcb('ren', 0, 'ZT', 'DAT', rename_to=('ZU', 'DAT'))
fcb('big', 0, 'ZBIG', 'DAT')
fcb('user1', 0, 'ZUSER1', 'DAT')
fcb('b', 2, '????????', '???')
fcb('del', 0, 'Z?', 'DAT')

emit(0x3E, 0x58, 0x32, 0x80, 0x00)  # mark the DMA buffer: (0080) = 'X'
bdos(15, 'nosuch')                  # open a missing file
bdos(22, 'zt')                      # make
for _ in range(3):
    bdos(21, 'zt')                  # write sequential
bdos(16, 'zt')                      # close
bdos(35, 'zt2')                     # compute file size
bdos(15, 'zt2')                     # open
poke('zt2', 33, 1)
bdos(33, 'zt2')                     # read random, record 1
poke('zt2', 33, 5)
bdos(34, 'zt2')                     # write random, record 5
poke('zt2', 33, 7)
bdos(40, 'zt2')                     # write random with zero fill, record 7
bdos(16, 'zt2')                     # close
bdos(30, 'attr')                    # set file attributes
bdos(17, 'wild')                    # search first
bdos(18, 'wild')                    # search next
bdos(23, 'ren')                     # rename
bdos(22, 'big')                     # make
emit(0x06, 200)                     # LD B,200
loop = ORG + len(code)
emit(0xC5)                          # PUSH BC
bdos(21, 'big')                     # write sequential
emit(0xC1)                          # POP BC
emit(0x10, (loop - (ORG + len(code) + 2)) & 0xFF)  # DJNZ loop
bdos(16, 'big')                     # close
bdos(32, e=1)                       # user 1
bdos(22, 'user1')
bdos(21, 'user1')
bdos(16, 'user1')
bdos(32, e=0)                       # user 0
bdos(17, 'b')                       # search first on B:
bdos(19, 'del')                     # delete, with a wildcard
emit(0xC3, 0x00, 0x00)              # warm boot

assert ORG + len(code) <= FCB_BASE
image = bytearray(FCB_BASE - ORG + 36 * len(fcbs))
image[:len(code)] = code
for addr, f in fcbs.values():
    image[addr - ORG:addr - ORG + 36] = f

out = sys.argv[1] if len(sys.argv) > 1 else 'ZTEST.COM'
with open(out, 'wb') as fh:
    fh.write(image)
print(f'{out}: {len(image)} bytes')
