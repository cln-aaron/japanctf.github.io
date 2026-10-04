/* scenes/common.js — shared scene UI helpers. Global: window.SceneUI
   Scenes are plain objects on window.Scenes[id]. Each provides headless logic
   (build/attempt/selfSolve) plus a render(api) for the browser. These helpers
   keep the chat/hint/flag chrome consistent.
*/
(function (global) {
  'use strict';
  var UI = global.UI, State = global.State;

  function panel(title, kicker) {
    var p = UI.el('div', { class: 'panel' });
    if (kicker) p.appendChild(UI.el('div', { class: 'kicker', text: kicker }));
    if (title) p.appendChild(UI.el('h2', { text: title }));
    return p;
  }

  function briefing(scene) {
    var p = panel(scene.title, 'Act ' + scene.act + '  ·  ' + scene.id.toUpperCase() +
      '  ·  par ' + Math.round((global.Config.PAR[scene.id]) / 60) + ' min  ·  ' +
      global.Config.BASE_POINTS[scene.id] + ' pts');
    scene.briefing.split('\n\n').forEach(function (para) {
      p.appendChild(UI.el('p', { text: para }));
    });
    if (scene.tools && scene.tools.length) {
      p.appendChild(UI.el('p', { class: 'small muted', text: 'Tools available this scene: ' + scene.tools.join(', ') }));
    }
    return p;
  }

  // Hints panel with cost + staggered cooldown.
  function hints(api) {
    var scene = api.scene;
    var p = panel('Hints', 'cost points — try first');
    var list = UI.el('div', {});
    p.appendChild(list);
    function redraw() {
      UI.clear(list);
      var taken = State.hintsTakenForScene(scene.id).sort(function (a, b) { return a.tier - b.tier; });
      taken.forEach(function (ht) {
        list.appendChild(UI.el('div', { class: 'seg document' }, [
          UI.el('div', { class: 'origin', text: 'Hint ' + (ht.tier + 1) + ' (−' + ht.cost + ' pts)' }),
          UI.el('div', { text: scene.hints[ht.tier] })
        ]));
      });
      var nh = State.nextHint(scene.id);
      if (nh.done) { list.appendChild(UI.el('div', { class: 'small muted', text: 'All hints opened.' })); return; }
      var btn = UI.el('button', { class: 'btn amber small' });
      if (!nh.available) {
        var secs = Math.ceil(nh.waitMs / 1000);
        btn.textContent = 'Hint ' + (nh.tier + 1) + ' locked (' + secs + 's) — −' + nh.cost + ' pts';
        btn.disabled = true;
        setTimeout(redraw, 1000);
      } else {
        btn.textContent = 'Open hint ' + (nh.tier + 1) + ' (−' + nh.cost + ' pts)';
        btn.addEventListener('click', function () {
          var r = State.takeHint(scene.id);
          if (r.ok) { api.refreshStatus(); redraw(); }
          else UI.toast(r.error || 'locked', 'bad');
        });
      }
      list.appendChild(btn);
    }
    redraw();
    return p;
  }

  // Flag area: shows the flag once solved, plus a submission box (rejected if the
  // state machine has not recorded the solve).
  function flagArea(api) {
    var scene = api.scene;
    var p = panel('Flag', 'proof of solve');
    var body = UI.el('div', {});
    p.appendChild(body);
    function redraw() {
      UI.clear(body);
      if (State.isSolved(scene.id)) {
        var flag = State.flagFor(scene.id);
        var box = UI.el('div', { class: 'flagbox' }, [
          UI.el('div', { text: flag }),
          UI.el('button', { class: 'btn small cyan', text: 'copy flag', style: 'margin-top:8px',
            onclick: function () { UI.copyToClipboard(flag); UI.toast('Flag copied', 'ok'); } })
        ]);
        body.appendChild(UI.el('div', { class: 'pill ok', text: 'SOLVED' }));
        body.appendChild(box);
      } else {
        body.appendChild(UI.el('p', { class: 'muted small', text: 'Solve the scene in the lab and the flag appears here. Pasting a flag you did not earn will be rejected.' }));
        var inp = UI.el('input', { type: 'text', placeholder: 'TIGA{...}', 'aria-label': 'flag submission' });
        var sb = UI.el('button', { class: 'btn small', text: 'submit flag', onclick: function () {
          var r = State.checkFlagSubmission(scene.id, inp.value);
          if (r.ok) UI.toast('Correct — but the lab already tracks your solve.', 'ok');
          else if (r.reason === 'not-earned') UI.modal({ title: 'Not yet', bodyHtml: '<p>' + UI.esc(r.message) + '</p>' });
          else UI.toast('Not the flag for this scene.', 'bad');
        } });
        body.appendChild(UI.el('div', { class: 'row', style: 'margin-top:8px' }, [inp, sb]));
      }
    }
    api.__refreshFlag = redraw;
    redraw();
    return p;
  }

  // A chat interface for the conversational scenes. sceneObj must provide
  // build(seed)->runtime, run(runtime, operator)->trace, check(runtime,trace)->{solved,winningInput}.
  function chat(api, opts) {
    opts = opts || {};
    var scene = api.scene;
    var p = panel('Talk to KAYA', opts.kicker || 'type a turn, read the trace');
    var log = UI.el('div', { class: 'chatlog', 'aria-live': 'polite' });
    var input = UI.el('textarea', { rows: '3', placeholder: opts.placeholder || 'Ask KAYA something…', 'aria-label': 'message to KAYA' });
    var tracePanel = UI.el('div', { class: 'panel deep', style: 'margin-top:12px' }, [UI.el('div', { class: 'kicker', text: 'KAYA trace — the last turn' })]);
    var traceBody = UI.el('div', {});
    tracePanel.appendChild(traceBody);

    function addMsg(who, text) {
      log.appendChild(UI.el('div', { class: 'msg ' + who }, [
        UI.el('div', { class: 'who', text: who === 'user' ? 'you' : 'KAYA' }),
        UI.el('div', { class: 'bubble', text: text })
      ]));
      log.scrollTop = log.scrollHeight;
    }

    function send() {
      var op = input.value;
      if (!op.trim() && !opts.allowEmpty) { UI.toast('Type something first.', 'bad'); return; }
      addMsg('user', op);
      var trace = scene.run(api.runtime, op);
      var reply = trace.decision.type === 'tool'
        ? (trace.toolResults.map(function (t) { return (t.held ? '[held] ' : '') + t.tool + ' → ' + t.result; }).join('\n') || 'KAYA performed an action.')
        : trace.decision.reply;
      addMsg('kaya', reply);
      UI.clear(traceBody);
      traceBody.appendChild(global.Trace.renderTrace(trace));
      var res = scene.check(api.runtime, trace);
      if (opts.afterTurn) opts.afterTurn(trace, res);
      if (res && res.solved && !State.isSolved(scene.id)) {
        api.solve(res.winningInput || op, res.extra);
      }
      input.value = '';
    }

    var sendBtn = UI.el('button', { class: 'btn', text: 'Send turn', onclick: send });
    input.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); }
    });
    p.appendChild(log);
    p.appendChild(UI.el('div', { class: 'field', style: 'margin-top:10px' }, [input]));
    p.appendChild(UI.el('div', { class: 'row' }, [sendBtn,
      UI.el('span', { class: 'small muted', text: 'Ctrl/⌘+Enter sends' })]));
    p.appendChild(tracePanel);
    return { node: p, addMsg: addMsg, send: send, input: input };
  }

  // Simple answer-box panel for marker/flag submission scenes.
  function answerBox(api, opts) {
    var p = panel(opts.title || 'Answer', opts.kicker || 'submit when you have it');
    if (opts.hint) p.appendChild(UI.el('p', { class: 'muted small', text: opts.hint }));
    var inp = UI.el('input', { type: 'text', placeholder: opts.placeholder || '', 'aria-label': 'answer' });
    var btn = UI.el('button', { class: 'btn', text: opts.button || 'Submit' });
    btn.addEventListener('click', function () {
      var r = opts.onSubmit(inp.value.trim());
      if (r && r.ok) { UI.toast(opts.okMsg || 'Correct!', 'ok'); }
      else UI.toast((r && r.msg) || 'Not quite — keep hunting.', 'bad');
    });
    p.appendChild(UI.el('div', { class: 'row' }, [inp, btn]));
    return p;
  }

  global.SceneUI = { panel: panel, briefing: briefing, hints: hints, flagArea: flagArea, chat: chat, answerBox: answerBox };
})(typeof window !== 'undefined' ? window : globalThis);
