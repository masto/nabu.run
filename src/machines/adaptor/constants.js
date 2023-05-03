// To avoid making up my own names, these constants are derived from
// https://github.com/thorpej/nabud/blob/main/libnabud/nabu_proto.h.

// The license for the above file, therefore, applies and is retained here.

/*-
 * Copyright (c) 2022, 2023 Jason R. Thorpe.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 * IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
 * BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED
 * AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */

/*
BSD 3-Clause License
Copyright (c) 2022, Nick Daniels
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

export const MAXSEGMENTSIZE = 65536;
export const MAXPACKETSIZE = 1024;
export const MAXPAYLOADSIZE = 991;
export const HEADERSIZE = 16;
export const FOOTERSIZE = 2;
export const TOTALPAYLOADSIZE = MAXPAYLOADSIZE + HEADERSIZE + FOOTERSIZE;

export const MSG_RESET = 0x80;
export const MSG_MYSTERY = 0x81;
export const MSG_GET_STATUS = 0x82;
export const MSG_START_UP = 0x83;
export const MSG_PACKET_REQUEST = 0x84;
export const MSG_CHANGE_CHANNEL = 0x85;

export const MSG_ESCAPE = 0x10;

export const SERVICE_UNAUTHORIZED = 0x90;
export const SERVICE_AUTHORIZED = 0x91;

export const STATUS_SIGNAL = 0x01;
export const STATUS_READY = 0x05;
export const STATUS_GOOD = 0x06;
export const STATUS_TRANSMIT = 0x1e;

export const STATE_CONFIRMED = 0xe4;
export const STATE_DONE = 0xe1;

export const SIGNAL_STATUS_NO = 0x9f;
export const SIGNAL_STATUS_YES = 0x1f;

export const MSGSEQ_ACK = [MSG_ESCAPE, STATUS_GOOD];
export const MSGSEQ_FINISHED = [MSG_ESCAPE, STATE_DONE];

export const IMAGE_TIME = 0x007fffff;

// RetroNet

export const MSG_RN_FILE_SIZE = 0xa8;
export const MSG_RN_FILE_OPEN = 0xa3;
export const MSG_RN_FH_DETAILS = 0xb4;
export const MSG_RN_FH_READSEQ = 0xb5;
export const MSG_RN_FH_READ = 0xa5;
export const MSG_RN_FH_CLOSE = 0xa7;
export const MSG_RN_FH_SEEK = 0xb6;

// Not yet implemented
export const MSG_RN_FH_SIZE = 0xa4;
export const MSG_RN_FH_APPEND = 0xa9;
export const MSG_RN_FH_INSERT = 0xaa;
export const MSG_RN_FH_DELETE_RANGE = 0xab;
export const MSG_RN_FH_REPLACE = 0xac;
export const MSG_RN_FILE_DELETE = 0xad;
export const MSG_RN_FILE_COPY = 0xae;
export const MSG_RN_FILE_MOVE = 0xaf;
export const MSG_RN_FH_TRUNCATE = 0xb0;
export const MSG_RN_FILE_LIST = 0xb1;
export const MSG_RN_FILE_LIST_ITEM = 0xb2;
export const MSG_RN_FILE_DETAILS = 0xb3;
export const MSG_RN_FH_LINE_COUNT = 0xdc;
export const MSG_RN_FH_GET_LINE = 0xdd;

export const RN_SEEK_SET = 1;
export const RN_SEEK_CUR = 2;
export const RN_SEEK_END = 3;

// NHACP

export const MSG_NHACP_REQUEST = 0x8f;
export const NHACP_REQUEST_HELLO = 0x00;
export const NHACP_REQUEST_STORAGE_OPEN = 0x01;
export const NHACP_REQUEST_FILE_CLOSE = 0x05;
export const NHACP_REQUEST_STORAGE_GET_BLOCK = 0x07;
export const NHACP_RESPONSE_SESSION_STARTED = 0x80;
export const NHACP_RESPONSE_OK = 0x81;
export const NHACP_RESPONSE_ERROR = 0x82;
export const NHACP_RESPONSE_STORAGE_LOADED = 0x83;
export const NHACP_RESPONSE_DATA_BUFFER = 0x84;

export const NHACP_ERROR_UNDEFINED = 0; // undefined generic error
export const NHACP_ERROR_ENOTSUP = 1; // Operation is not supported
export const NHACP_ERROR_EPERM = 2; // Operation is not permitted
export const NHACP_ERROR_ENOENT = 3; // Requested file does not exist
export const NHACP_ERROR_EIO = 4; // Input / output error
export const NHACP_ERROR_EBADF = 5; // Bad file descriptor
export const NHACP_ERROR_ENOMEM = 6; // Out of memory
export const NHACP_ERROR_EACCES = 7; // Access denied
export const NHACP_ERROR_EBUSY = 8; // File is busy
export const NHACP_ERROR_EEXIST = 9; // File already exists
export const NHACP_ERROR_EISDIR = 10; // File is a directory
export const NHACP_ERROR_EINVAL = 11; // Invalid argument / request
export const NHACP_ERROR_ENFILE = 12; // Too many open files
export const NHACP_ERROR_EFBIG = 13; // File is too large
export const NHACP_ERROR_ENOSPC = 14; // Out of space
export const NHACP_ERROR_ESEEK = 15; // Seek on non - seekable file
export const NHACP_ERROR_ENOTDIR = 16; // File is not a directory
export const NHACP_ERROR_ENOTEMPTY = 17; // Directory is not empty
export const NHACP_ERROR_ESRCH = 18; // No such process or session
export const NHACP_ERROR_ENSESS = 19; // Too many sessions
export const NHACP_ERROR_EAGAIN = 20; // Try again later
export const NHACP_ERROR_EROFS = 21; // Storage object is write - protected

export const unimplemented = {
   [MSG_RN_FH_SIZE]: 'MSG_RN_FH_SIZE',
   [MSG_RN_FH_APPEND]: 'MSG_RN_FH_APPEND',
   [MSG_RN_FH_INSERT]: 'MSG_RN_FH_INSERT',
   [MSG_RN_FH_DELETE_RANGE]: 'MSG_RN_FH_DELETE_RANGE',
   [MSG_RN_FH_REPLACE]: 'MSG_RN_FH_REPLACE',
   [MSG_RN_FILE_DELETE]: 'MSG_RN_FILE_DELETE',
   [MSG_RN_FILE_COPY]: 'MSG_RN_FILE_COPY',
   [MSG_RN_FILE_MOVE]: 'MSG_RN_FILE_MOVE',
   [MSG_RN_FH_TRUNCATE]: 'MSG_RN_FH_TRUNCATE',
   [MSG_RN_FILE_LIST]: 'MSG_RN_FILE_LIST',
   [MSG_RN_FILE_LIST_ITEM]: 'MSG_RN_FILE_LIST_ITEM',
   [MSG_RN_FILE_DETAILS]: 'MSG_RN_FILE_DETAILS',
};
