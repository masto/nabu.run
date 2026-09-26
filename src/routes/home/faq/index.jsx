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

import style from '../style.module.css';

const Faq = () => {
  return (
    <div class={style.faq}>
      <h1>
        <a href="/">Back to Home</a>
      </h1>

      <h1>Frequently Assumed Questions</h1>

      <h2>
        What does <a href="https://nabu.run">nabu.run</a> do?
      </h2>
      <p>
        It serves a selection of NABU cycle paks and homebrew files to a NABU PC
        connected to a serial port, or to an emulator connected to a WebSocket,
        if you have a supported browser (e.g. Chrome).
      </p>

      <h2>
        Can it do <i>some other thing</i>?
      </h2>
      <p>
        There are plenty of additional features that might be added over time,
        if it's possible to do so, and if I have the time and interest. Some of
        them are listed below.
      </p>

      <h2>Can it support a TCP socket (e.g. for MAME)?</h2>
      <p>
        Yes, with one extra detail: you need to run a local proxy server to
        allow the web page and MAME to connect. See the README at{" "}
        <a href="https://github.com/masto/nabu.run#websockets">
          https://github.com/masto/nabu.run
        </a>{" "}
        for more details on how to do this.
      </p>

      <h2>Can I add my own channels/paks/homebrew?</h2>
      <p>
        Not at the moment, unless you install and host your own copy of
        nabu.run.
      </p>

      <h2 id="files">Where are my files kept?</h2>
      <p>
        Some channels, like "Ishkur CP/M (NFS)", support local storage. Their channel
        has a <b>Storage</b> switch at the top of the page with two settings.
      </p>
      <p>
        <b>Temporary</b> keeps everything in the browser's memory. The NABU can
        save, rename and delete files as usual, and they last through restarting
        the NABU, but they're gone when you reload or close the nabu.run page.
      </p>
      <p>
        <b>Local folder</b> keeps the files in a folder on your computer that
        you choose. The first time, nabu.run copies the channel's files into a
        subfolder named after the channel, and from then on that subfolder is
        the NABU's disk: you can add, edit and back up files there yourself.
      </p>
      <p>
        Local folders require a browser that supports{" "}
        <a href="https://caniuse.com/native-filesystem-api">
          File System Access
        </a>
        .
      </p>

      <h2>Can I run it as a standalone application?</h2>
      <p>
        I have no interest in repackaging this in, e.g, Electron. But what you
        can do is click the install button in Chrome to save it as an
        application. I have not yet put any effort into testing to make sure
        this is set up correctly, but it seems to work.
      </p>

      <h2>Is this open source? Can I run my own copy?</h2>
      <p>
        <a href="https://github.com/masto/nabu.run">
          https://github.com/masto/nabu.run
        </a>
        . I made this for fun, not to carve out ownership of something. Feel
        free to use it in whatever ways make you happy. If you have fixes and
        improvements, I welcome pull requests.
      </p>

      <p class={style.small} style="text-align: right">
        Made by <a href="https://masto.me">@masto</a>
      </p>
    </div>
  );
};

export default Faq;
