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

import style from '../style.css';

const Faq = () => {
  return (
    <div class={style.faq}>
      <h1>
        <a href="./">Back to Home</a>
      </h1>

      <h1>
        Frequently Assumed Questions
      </h1>

      <h2>
        What does <a href="https://nabu.run">nabu.run</a> do?
      </h2>
      <p>
        Right now, it serves "NABU Network 1984 Cycle v2" to a NABU connected
        to a serial port, using Chrome and WebSerial.
      </p>

      <h2>
        Can it do <i>some other thing</i>?
      </h2>
      <p>
        This is a very early concept demo. There are plenty of additional features
        that might be added over time, if it's possible to do so, and if I have
        the time and interest. Some of them are listed below.
      </p>

      <h2>
        Can it support a TCP socket (e.g. for MAME)?
      </h2>
      <p>
        Probably not. Raw TCP sockets are not currently supported in any browsers,
        and the functionality for creating a <i>listening</i> socket is generally
        rejected for security concerns. Chrome apps used to be able to do this, but
        they are deprecated.
      </p>

      <h2>
        Can I change to a different channel/cycle/file?
      </h2>
      <p>
        I intend to add a menu soon to allow you to select what you want to load.
      </p>

      <h2>
        Can I add local files?
      </h2>
      <p>
        This is possible through APIs supported in Chrome, so I will probably add
        it at some point.
      </p>

      <h2>
        Can I run it as a standalone application?
      </h2>
      <p>
        I have no interest in repackaging this in, e.g, Electron. But what you can
        do is click the install button in Chrome to save it as an application.
        I have not yet put any effort into testing to make this is set up correctly,
        but it seems to work.
      </p>
      <p>
        At some point, I intend to pull the code out of here into a library that
        can be used in a standalone Node.js server, so you can run it headless.
      </p>

      <h2>
        Is this open source? Can I run my own copy?
      </h2>
      <p>
        <a href="https://github.com/masto/nabu.run">https://github.com/masto/nabu.run</a>.
        If you want to run it on your computer or host another copy somewhere,
        you can do so, with or without a hex editor. My intention was to make it easy
        for people to get started by not having to do any of that.
      </p>

      <p class={style.small} style="text-align: right">
        Made by <a href="https://masto.me">@masto</a>
      </p>
    </div >
  );
};

export default Faq;