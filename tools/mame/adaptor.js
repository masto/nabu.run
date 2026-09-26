// A headless nabu.run adaptor for testing with MAME. It listens on a TCP
// port for MAME's null modem and runs the same protocol machine as the web
// app, serving files from a local directory.
//
// Node can't load the app's extensionless imports directly, so run.sh
// bundles this first.
//
// usage: node adaptor.mjs <port> <directory> [imageName] [logfile]

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { interpret } from 'robot3';

import protocolMachine from '../../src/machines/adaptor/protocol.js';

const [port, dir, imageName, logFile = 'adaptor.log'] = process.argv.slice(2);
if (!port || !dir) {
  console.error('usage: node adaptor.mjs <port> <directory> [imageName] [logfile]');
  process.exit(2);
}

const logStream = fs.createWriteStream(logFile, { flags: 'a' });
const t0 = Date.now();
const log = (...args) => {
  const time = ((Date.now() - t0) / 1000).toFixed(3);
  const text = args.map(a =>
    typeof a === 'string' ? a
      : a instanceof Error ? `${a.name}: ${a.message}`
        : JSON.stringify(a)).join(' ');
  logStream.write(`${time} ${text}\n`);
};
// The protocol machine reports errors with console.log; keep them in the log.
console.log = log;
globalThis.alert = message => log('ALERT', message);

// Files are served from the directory, as local:<absolute path> URLs.
globalThis.fetch = async url => {
  const file = decodeURIComponent(String(url).replace(/^local:/, ''));
  try {
    const bytes = fs.readFileSync(file);
    log('FETCH', file, bytes.length);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'Last-Modified': fs.statSync(file).mtime.toUTCString() }),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  }
  catch {
    log('FETCH 404', file);
    return { ok: false, status: 404, headers: new Headers() };
  }
};

const channel = { baseUrl: 'local:', imageDir: path.resolve(dir), imageName: imageName || null };

net.createServer(socket => {
  log('CONNECT', socket.remoteAddress, socket.remotePort);
  socket.setNoDelay(true);

  const readable = new ReadableStream({
    start: controller => {
      socket.on('data', data => controller.enqueue(new Uint8Array(data)));
      socket.on('end', () => { log('EOF'); controller.close(); });
      socket.on('error', e => { log('SOCKET ERROR', e); controller.error(e); });
    },
    cancel: () => socket.destroy(),
  });
  const writable = new WritableStream({
    write: chunk => new Promise((resolve, reject) => {
      const bytes = Buffer.from(chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk);
      log('TX', bytes.length, bytes.subarray(0, 24).toString('hex'));
      socket.write(bytes, e => e ? reject(e) : resolve());
    }),
  });

  let last;
  interpret(protocolMachine, service => {
    while (service.child) service = service.child;
    const name = service.machine.current;
    if (name !== last) log('STATE', name);
    last = name;
  }, { port: { readable, writable }, portInfo: 'tcp', getChannel: () => channel, rnProxyUrl: '', log });
}).listen(Number(port), '127.0.0.1', () => log('LISTEN', port, 'serving', channel.imageDir, imageName || '(paks)'));
