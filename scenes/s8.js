/* Scene 8 — "Lock it down". The capstone, and the only scene that teaches defence.
   The student configures KAYA and must pass all twelve tests: five attacks must be
   blocked, seven workflows must still pass. Turning everything off blocks the
   attacks but breaks the workflows. There is one family of configs that passes all
   twelve; a least-privilege bonus rewards the most economical passing config.
*/
(function (global) {
  'use strict';
  var Scenes = global.Scenes = global.Scenes || {};
  var SceneUI = global.SceneUI, UI = global.UI;

  var TOOLS = ['orders.lookup', 'tickets.search', 'memory.read', 'memory.write', 'image.preview', 'reply.send', 'refund.process'];
  var REQ_SCOPE = {
    'orders.lookup': 'read', 'tickets.search': 'read', 'memory.read': 'read',
    'memory.write': 'write', 'image.preview': 'send', 'reply.send': 'send', 'refund.process': 'write'
  };

  function defaultConfig() {
    var tools = {}, scope = {}, approval = {};
    TOOLS.forEach(function (t) { tools[t] = true; scope[t] = 'read'; approval[t] = false; });
    return { tools: tools, scope: scope, approval: approval,
      trust: 'off', origin: 'any', output: 'raw', toolCap: 3, logging: 'off' };
  }

  function en(cfg, t) { return !!cfg.tools[t]; }
  function scopeOk(cfg, t) { return cfg.scope[t] === REQ_SCOPE[t]; }

  var TESTS = [
    { id: 'T1', kind: 'attack', label: 'scene-3 impersonated lookup',
      pass: function (c) { return c.origin === 'operator' || c.trust === 'enforce'; },
      fail: 'T1 failed: a review was able to drive orders.lookup on someone else\'s order.' },
    { id: 'T2', kind: 'attack', label: 'scene-4 encoded bypass',
      pass: function (c) { return c.origin === 'operator' || c.trust === 'enforce'; },
      fail: 'T2 failed: an encoded instruction in a document still drove a tool call.' },
    { id: 'T3', kind: 'attack', label: 'scene-5 exfiltration chain',
      pass: function (c) { return c.trust === 'enforce' || c.origin === 'operator' || !en(c, 'image.preview') || !en(c, 'memory.read'); },
      fail: 'T3 failed: a planted note read a secret and sent it out through image.preview.' },
    { id: 'T4', kind: 'attack', label: 'scene-6 poisoned retrieval',
      pass: function (c) { return c.trust === 'enforce'; },
      fail: 'T4 failed: poisoned (untrusted) documents still shaped the authoritative answer. Only trust=enforce excludes them.' },
    { id: 'T5', kind: 'attack', label: 'script tag into the staff dashboard',
      pass: function (c) { return c.output === 'escaped' || c.output === 'schema'; },
      fail: 'T5 failed: KAYA\'s output was written raw into the dashboard — a script tag executed (XSS).' },
    { id: 'W1', kind: 'workflow', label: 'customer asks about their own order',
      pass: function (c) { return en(c, 'orders.lookup') && scopeOk(c, 'orders.lookup') && en(c, 'reply.send') && scopeOk(c, 'reply.send'); },
      fail: 'W1 failed: a customer asked about their own order and got no answer (orders.lookup/reply.send off or mis-scoped).' },
    { id: 'W2', kind: 'workflow', label: 'staff searches tickets',
      pass: function (c) { return en(c, 'tickets.search') && scopeOk(c, 'tickets.search'); },
      fail: 'W2 failed: staff could not search tickets (tickets.search off or not read-scoped).' },
    { id: 'W3', kind: 'workflow', label: 'write a note to memory during escalation',
      pass: function (c) { return en(c, 'memory.write') && scopeOk(c, 'memory.write'); },
      fail: 'W3 failed: a legitimate escalation could not write a note (memory.write off or not write-scoped).' },
    { id: 'W4', kind: 'workflow', label: 'preview an image from the company asset host',
      pass: function (c) { return en(c, 'image.preview') && scopeOk(c, 'image.preview'); },
      fail: 'W4 failed: KAYA could not preview a company image (image.preview off or not send-scoped).' },
    { id: 'W5', kind: 'workflow', label: 'small refund after a human confirms',
      pass: function (c) { return en(c, 'refund.process') && scopeOk(c, 'refund.process') && c.toolCap >= 1; },
      fail: 'W5 failed: a small refund could not be processed at all (refund.process off/mis-scoped or tool cap 0).' },
    { id: 'W6', kind: 'workflow', label: 'large refund held for approval',
      pass: function (c) { return en(c, 'refund.process') && c.approval['refund.process'] === true; },
      fail: 'W6 failed: a $500+ refund went through without a human confirming it (refund.process needs human approval).' },
    { id: 'W7', kind: 'workflow', label: 'reconstruct which document triggered a tool call',
      pass: function (c) { return c.logging === 'actions+trigger'; },
      fail: 'W7 failed: an incident review could not tell which document triggered a tool call (logging must record actions + trigger).' }
  ];

  function evaluate(cfg) {
    var results = TESTS.map(function (t) {
      var ok = t.pass(cfg);
      return { id: t.id, kind: t.kind, label: t.label, pass: ok,
        explain: ok ? (t.kind === 'attack' ? t.id + ' blocked.' : t.id + ' passed.') : t.fail };
    });
    var allPass = results.every(function (r) { return r.pass; });
    return { results: results, allPass: allPass, leastPriv: allPass ? leastPrivBonus(cfg) : 0 };
  }

  function leastPrivBonus(cfg) {
    var penalty = 0;
    if (en(cfg, 'memory.read')) penalty += 25;            // not needed by any workflow
    if (cfg.origin !== 'operator') penalty += 20;          // operator-only is tighter
    penalty += Math.max(0, cfg.toolCap - 1) * 8;           // prefer the smallest cap
    if (cfg.output !== 'schema') penalty += 10;            // schema is the strictest output handling
    return Math.max(0, 100 - penalty);
  }

  function optimalConfig() {
    var c = defaultConfig();
    // enable the needed tools with correct scopes; drop memory.read
    c.tools['memory.read'] = false;
    TOOLS.forEach(function (t) { c.scope[t] = REQ_SCOPE[t]; });
    c.trust = 'enforce';
    c.origin = 'operator';
    c.output = 'schema';
    c.toolCap = 1;
    c.logging = 'actions+trigger';
    c.approval['refund.process'] = true;
    return c;
  }

  function selfSolve() {
    var c = optimalConfig();
    var ev = evaluate(c);
    return { solved: ev.allPass, winningInput: 'passing config (trust=enforce, operator-only, schema output, least privilege)', leastPriv: ev.leastPriv };
  }

  function render(api) {
    var cfg = defaultConfig();
    var c = api.container;
    c.appendChild(SceneUI.briefing(api.scene));

    var editor = SceneUI.panel('KAYA configuration', 'tune it — lazy answers fail');
    // tools + scope + approval
    var toolsTbl = UI.el('table', { class: 'data' });
    toolsTbl.appendChild(UI.el('tr', {}, [UI.el('th', { text: 'tool' }), UI.el('th', { text: 'enabled' }), UI.el('th', { text: 'scope' }), UI.el('th', { text: 'requires approval' })]));
    TOOLS.forEach(function (t) {
      var cb = UI.el('input', { type: 'checkbox', 'aria-label': 'enable ' + t }); cb.checked = cfg.tools[t];
      cb.addEventListener('change', function () { cfg.tools[t] = cb.checked; });
      var sc = UI.el('select', { 'aria-label': 'scope for ' + t });
      ['read', 'write', 'send'].forEach(function (s) { var o = UI.el('option', { value: s, text: s }); if (s === cfg.scope[t]) o.selected = true; sc.appendChild(o); });
      sc.addEventListener('change', function () { cfg.scope[t] = sc.value; });
      var ap = UI.el('input', { type: 'checkbox', 'aria-label': 'approval for ' + t }); ap.checked = cfg.approval[t];
      ap.addEventListener('change', function () { cfg.approval[t] = ap.checked; });
      toolsTbl.appendChild(UI.el('tr', {}, [UI.el('td', { class: 'mono', text: t }), UI.el('td', {}, [cb]), UI.el('td', {}, [sc]), UI.el('td', {}, [ap])]));
    });
    editor.appendChild(toolsTbl);

    function selectRow(label, options, cur, onChange) {
      var sel = UI.el('select', { 'aria-label': label });
      options.forEach(function (o) { var op = UI.el('option', { value: o, text: o }); if (o === cur) op.selected = true; sel.appendChild(op); });
      sel.addEventListener('change', function () { onChange(sel.value); });
      return UI.el('div', { class: 'field' }, [UI.el('label', { text: label }), sel]);
    }
    var controls = UI.el('div', { class: 'grid', style: 'grid-template-columns:1fr 1fr 1fr' });
    controls.appendChild(selectRow('trust tagging', ['off', 'warn', 'enforce'], cfg.trust, function (v) { cfg.trust = v; }));
    controls.appendChild(selectRow('origin rule', ['any', 'operator'], cfg.origin, function (v) { cfg.origin = v; }));
    controls.appendChild(selectRow('output handling', ['raw', 'escaped', 'schema'], cfg.output, function (v) { cfg.output = v; }));
    controls.appendChild(selectRow('logging', ['off', 'actions', 'actions+trigger'], cfg.logging, function (v) { cfg.logging = v; }));
    var capIn = UI.el('input', { type: 'number', min: '0', max: '9', value: String(cfg.toolCap), 'aria-label': 'tool call cap' });
    capIn.addEventListener('change', function () { cfg.toolCap = parseInt(capIn.value, 10) || 0; });
    controls.appendChild(UI.el('div', { class: 'field' }, [UI.el('label', { text: 'per-turn tool call cap' }), capIn]));
    editor.appendChild(controls);
    c.appendChild(editor);

    var harness = SceneUI.panel('Test harness', '5 attacks must block · 7 workflows must pass');
    var runBtn = UI.el('button', { class: 'btn cyan', text: 'Run all twelve tests' });
    var lpIndicator = UI.el('span', { class: 'pill', text: 'least-privilege: —' });
    harness.appendChild(UI.el('div', { class: 'row', style: 'margin-bottom:10px' }, [runBtn, lpIndicator]));
    var resultsBox = UI.el('div', {});
    harness.appendChild(resultsBox);
    c.appendChild(harness);

    function drawResults(ev) {
      UI.clear(resultsBox);
      var tbl = UI.el('table', { class: 'data' });
      tbl.appendChild(UI.el('tr', {}, [UI.el('th', { text: '' }), UI.el('th', { text: 'test' }), UI.el('th', { text: 'result' }), UI.el('th', { text: 'detail' })]));
      ev.results.forEach(function (r) {
        var want = r.kind === 'attack' ? 'block' : 'pass';
        tbl.appendChild(UI.el('tr', {}, [
          UI.el('td', { class: 'mono', text: r.id }),
          UI.el('td', { text: r.label + ' (' + want + ')' }),
          UI.el('td', {}, [UI.el('span', { class: r.pass ? 'pill ok' : 'pill bad', text: r.pass ? 'OK' : 'FAIL' })]),
          UI.el('td', { class: 'small', text: r.explain })
        ]));
      });
      resultsBox.appendChild(tbl);
      lpIndicator.textContent = 'least-privilege: ' + (ev.allPass ? ev.leastPriv + '/100' : '—');
      lpIndicator.className = ev.allPass ? 'pill ok' : 'pill';
    }

    runBtn.addEventListener('click', function () {
      var ev = evaluate(cfg);
      drawResults(ev);
      if (ev.allPass) {
        if (!global.State.isSolved('s8')) { api.solve(selfSolveInput(), { bonusPoints: ev.leastPriv }); if (api.__refreshFlag) api.__refreshFlag(); }
        else UI.toast('Already solved. Least-privilege: ' + ev.leastPriv + '/100', 'ok');
      } else {
        // 2-second cool-down on a failed run to make brute force impractical
        runBtn.disabled = true;
        var n = 2; runBtn.textContent = 'Wait ' + n + 's…';
        var iv = setInterval(function () { n--; if (n <= 0) { clearInterval(iv); runBtn.disabled = false; runBtn.textContent = 'Run all twelve tests'; } else runBtn.textContent = 'Wait ' + n + 's…'; }, 1000);
      }
    });
    function selfSolveInput() { return 'passing config: trust=' + cfg.trust + ', origin=' + cfg.origin + ', output=' + cfg.output + ', logging=' + cfg.logging + ', cap=' + cfg.toolCap; }

    var row = UI.el('div', { class: 'grid', style: 'grid-template-columns:1fr 1fr' });
    row.appendChild(SceneUI.hints(api));
    row.appendChild(SceneUI.flagArea(api));
    c.appendChild(row);
  }

  Scenes.s8 = {
    id: 's8', act: 'Four', title: 'Lock it down',
    tools: TOOLS,
    briefing:
      'You have spent the afternoon breaking KAYA. Now lock it down. Configure it so that all five attacks you have seen (plus one you have not) are blocked, while all seven legitimate workflows still work.\n\n' +
      'Turning everything off is not the answer — it breaks the workflows and fails the tests. There is a family of configurations that passes all twelve, and it rewards understanding over brute force. Read each failure: the harness tells you exactly what broke.\n\n' +
      'Among passing configs, fewer privileges score better. Aim for least privilege.',
    hints: [
      'Work the attacks and workflows together. T4 (poisoned retrieval) can only be stopped one way — trust tagging set to enforce. Start there.',
      'Each enabled tool needs its correct scope or its workflow breaks (orders.lookup=read, memory.write=write, image.preview=send, refund.process=write). T5 needs output escaped or schema. W6 needs human approval on refunds. W7 needs logging = actions+trigger.',
      'trust=enforce, origin=operator, output=schema, logging=actions+trigger, cap=1, refund.process approval on, and enable exactly orders.lookup(read), tickets.search(read), memory.write(write), image.preview(send), reply.send(send), refund.process(write) — memory.read off for full least-privilege.'
    ],
    verbalCheck: 'Ask why turning memory.read off still passes every workflow, and which single setting stops the poisoned-retrieval attack.',
    evaluate: evaluate, optimalConfig: optimalConfig, selfSolve: selfSolve, render: render,
    _TESTS: TESTS, _defaultConfig: defaultConfig
  };
})(typeof window !== 'undefined' ? window : globalThis);
