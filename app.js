/* app.js — the lab shell controller. Wires the status bar, scene nav, scene
   rendering, arcade rounds, and finishing. Global namespacing, classic scripts.
*/
(function (global) {
  'use strict';
  var UI = global.UI, State = global.State, Config = global.Config, Scenes = global.Scenes, Arcade = global.Arcade;

  var current = 's1';

  function qs(id) { return document.getElementById(id); }

  function boot() {
    State.bootFromQuery();
    var run = State.getRun();
    if (!run) { location.href = 'index.html' + (location.search || ''); return; }
    buildStatusBar();
    buildNav();
    openScene(firstUnsolvedOr('s1'));
    setInterval(tick, 1000);
    tick();
  }

  function firstUnsolvedOr(def) {
    for (var i = 0; i < Config.SCENE_ORDER.length; i++) {
      var id = Config.SCENE_ORDER[i];
      if (!State.isSolved(id) && State.prereqsMet(id)) return id;
    }
    return def;
  }

  function buildStatusBar() {
    var bar = qs('statusbar');
    UI.clear(bar);
    function stat(k, id, cls) {
      return UI.el('div', { class: 'stat' }, [UI.el('span', { class: 'k', text: k }), UI.el('span', { class: 'v' + (cls ? ' ' + cls : ''), id: id, text: '—' })]);
    }
    bar.appendChild(stat('handle', 'sb-handle'));
    bar.appendChild(stat('elapsed', 'sb-time'));
    bar.appendChild(stat('points', 'sb-points', 'lime'));
    bar.appendChild(stat('scenes', 'sb-scenes'));
    bar.appendChild(stat('par', 'sb-par'));
    var sp = UI.el('div', { class: 'spacer' });
    bar.appendChild(sp);
    bar.appendChild(UI.el('button', { class: 'btn small ghost', text: 'save my run', onclick: function () { State.downloadExport(); UI.toast('Run saved to a text file.', 'ok'); } }));
    bar.appendChild(UI.el('button', { class: 'btn small', id: 'sb-finish', text: 'finish', onclick: finish, disabled: 'disabled' }));
  }

  function tick() {
    var run = State.getRun(); if (!run) return;
    qs('sb-handle').textContent = run.handle + (run.practice ? ' (practice)' : '');
    qs('sb-time').textContent = UI.fmtTime(State.elapsedMs());
    qs('sb-points').textContent = State.totalPoints();
    var solved = 0; Config.SCENE_ORDER.forEach(function (id) { if (State.isSolved(id)) solved++; });
    qs('sb-scenes').textContent = solved + ' / 8';
    // par comparison: target = par of solved scenes + par of the current in-progress scene
    var target = 0;
    Config.SCENE_ORDER.forEach(function (id) { if (State.isSolved(id)) target += Config.PAR[id]; });
    var next = firstUnsolvedOr(null);
    if (next) target += Config.PAR[next];
    var delta = target - State.elapsedSec();
    var parEl = qs('sb-par');
    if (delta >= 0) { parEl.textContent = 'ahead ' + UI.fmtTime(delta * 1000); parEl.className = 'v lime'; }
    else { parEl.textContent = 'behind ' + UI.fmtTime(-delta * 1000); parEl.className = 'v amber'; }

    var fin = qs('sb-finish');
    if (State.allSolved()) fin.removeAttribute('disabled'); else fin.setAttribute('disabled', 'disabled');
    refreshNav();
  }

  function buildNav() {
    var nav = qs('nav');
    UI.clear(nav);
    nav.appendChild(UI.el('h2', { text: 'Scenes' }));
    var ul = UI.el('ul', { class: 'navlist', id: 'nav-scenes' });
    Config.SCENE_ORDER.forEach(function (id, i) {
      var sc = Scenes[id];
      var btn = UI.el('button', { class: 'navbtn', id: 'nav-' + id, 'data-id': id }, [
        UI.el('span', { class: 'num', text: (i + 1) }),
        UI.el('span', { text: sc ? sc.title : id }),
        UI.el('span', { class: 'tick', id: 'tick-' + id, text: '' })
      ]);
      btn.addEventListener('click', function () { tryOpen(id); });
      ul.appendChild(UI.el('li', {}, [btn]));
    });
    nav.appendChild(ul);

    var sect = UI.el('div', { class: 'navsection' });
    sect.appendChild(UI.el('h2', { text: 'Arcade' }));
    var aul = UI.el('ul', { class: 'navlist' });
    Config.ARCADE_IDS.forEach(function (aid) {
      var meta = Arcade.META[aid];
      var btn = UI.el('button', { class: 'navbtn', id: 'nav-' + aid }, [
        UI.el('span', { class: 'num', text: aid.toUpperCase() }),
        UI.el('span', { text: meta.title })
      ]);
      btn.addEventListener('click', function () { openArcade(aid); });
      aul.appendChild(UI.el('li', {}, [btn]));
    });
    sect.appendChild(aul);
    sect.appendChild(UI.el('p', { class: 'small muted', style: 'margin-top:10px', text: 'Arcade is bonus only. It breaks ties on the board; it never replaces a scene.' }));
    nav.appendChild(sect);
    refreshNav();
  }

  function refreshNav() {
    Config.SCENE_ORDER.forEach(function (id) {
      var btn = qs('nav-' + id); if (!btn) return;
      var solved = State.isSolved(id);
      var locked = !State.prereqsMet(id) && !solved;
      btn.classList.toggle('solved', solved);
      btn.classList.toggle('locked', locked);
      btn.classList.toggle('active', id === current);
      var tk = qs('tick-' + id); if (tk) tk.textContent = solved ? '✓' : (locked ? '🔒' : '');
    });
    Config.ARCADE_IDS.forEach(function (aid) {
      var btn = qs('nav-' + aid); if (btn) btn.classList.toggle('active', aid === current);
    });
  }

  function tryOpen(id) {
    if (!State.prereqsMet(id) && !State.isSolved(id)) {
      var reqs = (Config.PREREQS[id] || []).map(function (r) { return Scenes[r] ? Scenes[r].title : r; });
      UI.toast('Locked — first solve: ' + reqs.join(', '), 'bad');
      return;
    }
    openScene(id);
  }

  function openScene(id) {
    current = id;
    var main = qs('main-panel');
    UI.clear(main);
    var scene = Scenes[id];
    if (!scene || !scene.render) {
      main.appendChild(UI.el('div', { class: 'panel' }, [UI.el('h2', { text: 'Not built yet' }), UI.el('p', { text: 'This scene is a placeholder.' })]));
      refreshNav(); return;
    }
    var api = makeApi(id, scene, main);
    scene.render(api);
    refreshNav();
    main.scrollIntoView({ block: 'start' });
  }

  function makeApi(id, scene, container) {
    var api = {
      UI: UI, State: State, KAYA: global.KAYA, Trace: global.Trace,
      seed: State.seed(), sceneId: id, scene: scene, container: container,
      refreshStatus: tick,
      isSolved: function () { return State.isSolved(id); },
      flagFor: function () { return State.flagFor(id); }
    };
    api.solve = function (winningInput, extra) {
      var r = State.recordSolve(id, winningInput, extra);
      if (r.ok && !r.already) {
        UI.toast('Scene solved! Flag unlocked.', 'ok', 3200);
        tick();
        if (api.__refreshFlag) api.__refreshFlag();
        if (State.allSolved()) UI.toast('All eight solved — press finish for your victory code.', 'ok', 4000);
      } else if (!r.ok) {
        UI.toast(r.error || 'Could not record solve.', 'bad');
      }
      return r;
    };
    return api;
  }

  function openArcade(aid) {
    current = aid;
    var main = qs('main-panel');
    Arcade.render(aid, main, function () { openScene(firstUnsolvedOr('s1')); });
    refreshNav();
    main.scrollIntoView({ block: 'start' });
  }

  function finish() {
    var r = State.finishRun();
    if (!r.ok) { UI.toast(r.error, 'bad'); return; }
    var body = UI.el('div', {});
    body.appendChild(UI.el('p', { text: 'Show this screen to the facilitator. They will type your code into the verification page.' }));
    body.appendChild(UI.el('div', { class: 'flagbox', style: 'font-size:22px;text-align:center;letter-spacing:2px' }, [r.code]));
    body.appendChild(UI.el('div', { class: 'row', style: 'margin-top:10px;justify-content:center' }, [
      UI.el('button', { class: 'btn cyan small', text: 'copy code', onclick: function () { UI.copyToClipboard(r.code); UI.toast('Code copied', 'ok'); } }),
      UI.el('button', { class: 'btn ghost small', text: 'save my run', onclick: function () { State.downloadExport(); } })
    ]));
    if (r.unverified) {
      body.appendChild(UI.el('div', { class: 'banner bad', style: 'margin-top:12px', text: 'Integrity: UNVERIFIED — the facilitator will check your run on screen.' }));
    } else {
      body.appendChild(UI.el('div', { class: 'banner ok', style: 'margin-top:12px', text: 'Integrity: clean run. Nicely done.' }));
    }
    body.appendChild(UI.el('p', { class: 'small muted', text: 'Total time ' + UI.fmtTime(State.elapsedMs()) + '  ·  ' + State.totalPoints() + ' points  ·  ' + State.arcadeTotal() + ' arcade.' }));
    UI.modal({ title: 'Your victory code', bodyNode: body, buttons: [{ label: 'Done', class: 'btn' }] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
