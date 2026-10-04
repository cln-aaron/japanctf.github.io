/* core/state.js
   All persistent run state, scoring, timers and the victory code live here.
   Written to run both in the browser (localStorage) and headless under a test
   harness (an in-memory store, with an injectable clock). No network, ever.

   Global: window.State
*/
(function (global) {
  'use strict';

  var Crypto = global.Crypto;
  var Config = global.Config;

  var STORAGE_KEY = 'glasshouse.run.v1';

  // ---- storage + clock (swappable for tests) ------------------------------
  var memStore = {};
  var storage = (function () {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('__gh_probe', '1');
        localStorage.removeItem('__gh_probe');
        return localStorage;
      }
    } catch (e) { /* private window / blocked: fall through */ }
    return {
      getItem: function (k) { return k in memStore ? memStore[k] : null; },
      setItem: function (k, v) { memStore[k] = String(v); },
      removeItem: function (k) { delete memStore[k]; }
    };
  })();

  var nowFn = function () { return Date.now(); };

  // ---- run object ---------------------------------------------------------
  var run = null;

  function load() {
    try {
      var raw = storage.getItem(STORAGE_KEY);
      run = raw ? JSON.parse(raw) : null;
    } catch (e) { run = null; }
    return run;
  }
  function save() {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(run)); } catch (e) {}
  }

  function validateHandle(h) {
    if (h == null) return { ok: false, error: 'Enter a handle.' };
    var v = String(h).trim();
    if (!v) return { ok: false, error: 'Enter a handle.' };
    if (v.length > 20) v = v.slice(0, 20);
    if (!/^[A-Za-z0-9_-]+$/.test(v)) {
      return { ok: false, error: 'Letters, digits, dash and underscore only.' };
    }
    return { ok: true, value: v };
  }

  function seedFor(handle) {
    return Crypto.sha256Hex(handle + ':' + Config.DAY_SALT);
  }

  function startRun(handle, opts) {
    opts = opts || {};
    var v = validateHandle(handle);
    if (!v.ok) return v;
    run = {
      handle: v.value,
      seed: seedFor(v.value),
      startedAt: nowFn(),
      practice: !!opts.practice,
      solves: {},         // sceneId -> {at, payloadHash, points, speedBonus, duration, winningInput, bypassNote?}
      arcade: {},         // roundId -> {at, points}
      hintsTaken: [],     // {sceneId, tier, at, cost}
      integrity: []       // array of human-readable strings
    };
    save();
    return { ok: true, value: v.value };
  }

  function getRun() { if (!run) load(); return run; }
  function seed() { var r = getRun(); return r ? r.seed : null; }
  function isPractice() { var r = getRun(); return !!(r && r.practice); }

  function elapsedMs() {
    var r = getRun();
    if (!r) return 0;
    return Math.max(0, nowFn() - r.startedAt);
  }
  function elapsedSec() { return Math.floor(elapsedMs() / 1000); }

  // ---- scoring ------------------------------------------------------------
  function hintCostForScene(sceneId) {
    var r = getRun(); if (!r) return 0;
    var sum = 0;
    for (var i = 0; i < r.hintsTaken.length; i++) {
      if (r.hintsTaken[i].sceneId === sceneId) sum += r.hintsTaken[i].cost;
    }
    return sum;
  }

  function lastBoundary() {
    // most recent solve timestamp, or startedAt if none yet
    var r = getRun();
    var b = r.startedAt;
    for (var id in r.solves) {
      if (r.solves.hasOwnProperty(id) && r.solves[id].at > b) b = r.solves[id].at;
    }
    return b;
  }

  function isSolved(sceneId) {
    var r = getRun();
    return !!(r && r.solves[sceneId]);
  }

  function prereqsMet(sceneId) {
    var reqs = Config.PREREQS[sceneId] || [];
    for (var i = 0; i < reqs.length; i++) {
      if (!isSolved(reqs[i])) return false;
    }
    return true;
  }

  function allSolved() {
    for (var i = 0; i < Config.SCENE_ORDER.length; i++) {
      if (!isSolved(Config.SCENE_ORDER[i])) return false;
    }
    return true;
  }

  function scoreForScene(sceneId) {
    var r = getRun();
    if (!r || !r.solves[sceneId]) return 0;
    return r.solves[sceneId].points;
  }

  function arcadeTotal() {
    var r = getRun(); if (!r) return 0;
    var sum = 0;
    for (var id in r.arcade) if (r.arcade.hasOwnProperty(id)) sum += r.arcade[id].points;
    return sum;
  }

  function pendingHintCost() {
    // hint costs on scenes not yet solved (already-solved scenes have cost baked in)
    var r = getRun(); if (!r) return 0;
    var sum = 0;
    for (var i = 0; i < r.hintsTaken.length; i++) {
      var ht = r.hintsTaken[i];
      if (!r.solves[ht.sceneId]) sum += ht.cost;
    }
    return sum;
  }

  function totalPoints() {
    var r = getRun(); if (!r) return 0;
    var sum = 0;
    for (var id in r.solves) if (r.solves.hasOwnProperty(id)) sum += r.solves[id].points;
    sum += arcadeTotal();
    sum -= pendingHintCost();
    return Math.max(0, sum);
  }

  // ---- hints --------------------------------------------------------------
  function hintCooldownMs(sceneId) {
    return Config.HINT_COOLDOWN_OVERRIDE[sceneId] || Config.HINT_COOLDOWN_MS;
  }

  function hintsTakenForScene(sceneId) {
    var r = getRun(); if (!r) return [];
    return r.hintsTaken.filter(function (h) { return h.sceneId === sceneId; });
  }

  // Returns {tier, available, cost, waitMs} describing the next openable tier.
  function nextHint(sceneId) {
    var taken = hintsTakenForScene(sceneId).sort(function (a, b) { return a.tier - b.tier; });
    var tier = taken.length; // 0-based index of next tier
    if (tier >= Config.HINT_COSTS.length) return { tier: -1, available: false, done: true };
    var cost = Config.HINT_COSTS[tier];
    if (tier === 0) return { tier: tier, available: true, cost: cost, waitMs: 0 };
    var prev = taken[tier - 1];
    var elapsed = nowFn() - prev.at;
    var cd = hintCooldownMs(sceneId);
    var waitMs = Math.max(0, cd - elapsed);
    return { tier: tier, available: waitMs <= 0, cost: cost, waitMs: waitMs };
  }

  function takeHint(sceneId) {
    var r = getRun(); if (!r) return { ok: false, error: 'No run.' };
    var nh = nextHint(sceneId);
    if (nh.done) return { ok: false, error: 'No more hints.' };
    if (!nh.available) return { ok: false, error: 'Locked', waitMs: nh.waitMs };
    r.hintsTaken.push({ sceneId: sceneId, tier: nh.tier, at: nowFn(), cost: nh.cost });
    save();
    return { ok: true, tier: nh.tier, cost: nh.cost };
  }

  // ---- solving ------------------------------------------------------------
  function addIntegrity(note) {
    var r = getRun(); if (!r) return;
    r.integrity.push(note);
    save();
  }

  function recordSolve(sceneId, winningInput, extra) {
    var r = getRun(); if (!r) return { ok: false, error: 'No run.' };
    if (r.solves[sceneId]) return { ok: true, already: true, solve: r.solves[sceneId] };
    if (!prereqsMet(sceneId)) {
      addIntegrity('Attempt to solve ' + sceneId + ' before its prerequisites at ' + nowFn());
      return { ok: false, error: 'Earlier scenes must be solved first.' };
    }
    var at = nowFn();
    var base = Config.BASE_POINTS[sceneId] || 0;
    var par = Config.PAR[sceneId] || 600;
    var duration = at - lastBoundary();
    var frac = 1 - (duration / (2 * par * 1000));
    if (frac < 0) frac = 0; if (frac > 1) frac = 1;
    var speedBonus = Math.round(Config.SPEED_BONUS_MAX * frac);
    var hintCost = hintCostForScene(sceneId);
    var mult = (extra && extra.baseMultiplier != null) ? extra.baseMultiplier : 1;
    var bonus = (extra && extra.bonusPoints) ? extra.bonusPoints : 0;
    var points = Math.max(0, Math.round(base * mult) + speedBonus + bonus - hintCost);
    var solve = {
      at: at,
      payloadHash: Crypto.sha256Hex(String(winningInput) + r.seed).slice(0, 12),
      points: points,
      speedBonus: speedBonus,
      duration: duration,
      winningInput: String(winningInput)
    };
    if (extra && extra.bypassNote) solve.bypassNote = String(extra.bypassNote);
    r.solves[sceneId] = solve;
    save();
    return { ok: true, solve: solve, flag: flagFor(sceneId) };
  }

  function setBypassNote(note) {
    var r = getRun(); if (!r || !r.solves.s4) return false;
    r.solves.s4.bypassNote = String(note);
    save();
    return true;
  }

  function recordArcade(roundId, points) {
    var r = getRun(); if (!r) return { ok: false };
    var p = Math.max(0, Math.min(Config.ARCADE_MAX, Math.round(points)));
    // keep the best score if replayed
    if (r.arcade[roundId] && r.arcade[roundId].points >= p) {
      return { ok: true, kept: true, points: r.arcade[roundId].points };
    }
    r.arcade[roundId] = { at: nowFn(), points: p };
    save();
    return { ok: true, points: p };
  }

  // ---- flags --------------------------------------------------------------
  function flagFor(sceneId) {
    var r = getRun(); if (!r) return null;
    var secret = Config.SCENE_SECRETS[sceneId];
    var tag = Crypto.hmacHex(r.seed, sceneId + ':' + secret).slice(0, 8);
    return 'TIGA{' + sceneId + '-' + tag + '}';
  }

  // A student may paste a flag. It is only accepted if the state machine has
  // actually recorded the solve. Otherwise it is rejected and flagged.
  function checkFlagSubmission(sceneId, submitted) {
    var expected = flagFor(sceneId);
    var clean = String(submitted || '').trim();
    if (clean !== expected) return { ok: false, reason: 'wrong' };
    if (!isSolved(sceneId)) {
      addIntegrity('Correct flag for ' + sceneId + ' submitted without an in-lab solve at ' + nowFn());
      return { ok: false, reason: 'not-earned',
        message: 'the flag is right but your run does not show you doing it, solve it in the lab' };
    }
    return { ok: true };
  }

  // ---- integrity checks (run at finish) -----------------------------------
  function runIntegrityChecks() {
    var r = getRun();
    var problems = [];
    var order = Config.SCENE_ORDER;
    var prevAt = r.startedAt;
    for (var i = 0; i < order.length; i++) {
      var id = order[i];
      var s = r.solves[id];
      if (!s) { problems.push(id + ' not solved'); continue; }
      if (s.at < r.startedAt) problems.push(id + ' solved before run start');
      if (s.at < prevAt) problems.push(id + ' out of order with ' + order[i - 1]);
      // prereq check
      var reqs = Config.PREREQS[id] || [];
      for (var j = 0; j < reqs.length; j++) {
        var req = r.solves[reqs[j]];
        if (!req || req.at > s.at) problems.push(id + ' solved before prerequisite ' + reqs[j]);
      }
      prevAt = s.at;
    }
    // plausibility: at least ~1s of thinking per scene
    if (elapsedMs() < order.length * 1000) problems.push('elapsed implausibly short');
    // pre-existing integrity notes also taint
    if (r.integrity.length) problems.push('prior integrity notes: ' + r.integrity.length);
    return problems;
  }

  // ---- victory code -------------------------------------------------------
  function buildCodeBytes(info) {
    // info: {handle, elapsedSec, solvedMask, arcadePoints, hintCount, unverified, practice}
    var hh = Crypto.sha256Bytes(info.handle + ':' + Config.DAY_SALT);
    var payload = new Uint8Array(11);
    payload[0] = hh[0]; payload[1] = hh[1]; payload[2] = hh[2]; payload[3] = hh[3];
    var es = Math.max(0, Math.min(65535, info.elapsedSec | 0));
    payload[4] = (es >>> 8) & 0xff; payload[5] = es & 0xff;
    payload[6] = info.solvedMask & 0xff;
    var ap = Math.max(0, Math.min(65535, info.arcadePoints | 0));
    payload[7] = (ap >>> 8) & 0xff; payload[8] = ap & 0xff;
    payload[9] = Math.max(0, Math.min(255, info.hintCount | 0));
    var flags = (Config.CODE_VERSION << 4) |
      (info.unverified ? 0x01 : 0x00) |
      (info.practice ? 0x02 : 0x00);
    payload[10] = flags & 0xff;
    var cks = checksumOf(payload);
    var all = new Uint8Array(14);
    all.set(payload, 0); all.set(cks, 11);
    return all;
  }

  function checksumOf(payload11) {
    var hex = Crypto.bytesToHex(payload11);
    var d = Crypto.sha256Bytes(hex + ':' + Config.DAY_SALT);
    return new Uint8Array([d[0], d[1], d[2]]);
  }

  function groupCode(b32) {
    return b32.replace(/(.{4})/g, '$1-').replace(/-$/, '');
  }

  function encodeVictoryCode(info) {
    return groupCode(Crypto.base32Encode(buildCodeBytes(info)));
  }

  // Decode a pasted code. Returns {valid, checksumOk, version, elapsedSec,
  // solvedMask, solvedCount, arcadePoints, hintCount, unverified, practice,
  // handleHash4} — or {valid:false}.
  function decodeVictoryCode(codeStr) {
    var bytes = Crypto.base32Decode(codeStr);
    if (bytes.length < 14) return { valid: false, reason: 'too short' };
    var payload = bytes.slice(0, 11);
    var cks = bytes.slice(11, 14);
    var expect = checksumOf(payload);
    var checksumOk = cks[0] === expect[0] && cks[1] === expect[1] && cks[2] === expect[2];
    var es = (payload[4] << 8) | payload[5];
    var ap = (payload[7] << 8) | payload[8];
    var flags = payload[10];
    var version = (flags >>> 4) & 0x0f;
    var mask = payload[6];
    var count = 0;
    for (var i = 0; i < 8; i++) if (mask & (1 << i)) count++;
    return {
      valid: true,
      checksumOk: checksumOk,
      version: version,
      handleHash4: [payload[0], payload[1], payload[2], payload[3]],
      elapsedSec: es,
      solvedMask: mask,
      solvedCount: count,
      arcadePoints: ap,
      hintCount: payload[9],
      unverified: !!(flags & 0x01),
      practice: !!(flags & 0x02)
    };
  }

  function handleMatchesCode(handle, decoded) {
    var v = validateHandle(handle);
    if (!v.ok) return false;
    var hh = Crypto.sha256Bytes(v.value + ':' + Config.DAY_SALT);
    return hh[0] === decoded.handleHash4[0] && hh[1] === decoded.handleHash4[1] &&
      hh[2] === decoded.handleHash4[2] && hh[3] === decoded.handleHash4[3];
  }

  function solvedMask() {
    var mask = 0;
    for (var i = 0; i < Config.SCENE_ORDER.length; i++) {
      if (isSolved(Config.SCENE_ORDER[i])) mask |= (1 << i);
    }
    return mask;
  }

  function finishRun() {
    var r = getRun();
    if (!r) return { ok: false, error: 'No run.' };
    if (!allSolved()) return { ok: false, error: 'All eight scenes must be solved first.' };
    var problems = runIntegrityChecks();
    var unverified = problems.length > 0;
    var info = {
      handle: r.handle,
      elapsedSec: elapsedSec(),
      solvedMask: solvedMask(),
      arcadePoints: arcadeTotal(),
      hintCount: r.hintsTaken.length,
      unverified: unverified,
      practice: r.practice
    };
    var code = encodeVictoryCode(info);
    return { ok: true, code: code, unverified: unverified, problems: problems, info: info };
  }

  // ---- export -------------------------------------------------------------
  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60); s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function exportText() {
    var r = getRun(); if (!r) return '';
    var lines = [];
    lines.push('OPERATION GLASSHOUSE — RUN RECORD');
    lines.push('=================================');
    lines.push('Handle:        ' + r.handle);
    lines.push('Total time:    ' + fmtTime(elapsedMs()));
    lines.push('Scene points:  ' + (totalPoints()));
    lines.push('Arcade points: ' + arcadeTotal());
    lines.push('Hints taken:   ' + r.hintsTaken.length);
    if (r.practice) lines.push('(PRACTICE RUN)');
    lines.push('');
    lines.push('SCENES');
    lines.push('------');
    for (var i = 0; i < Config.SCENE_ORDER.length; i++) {
      var id = Config.SCENE_ORDER[i];
      var s = r.solves[id];
      var title = (global.Scenes && global.Scenes[id]) ? global.Scenes[id].title : id;
      if (s) {
        lines.push('[' + (i + 1) + '] ' + id + ' "' + title + '"  — ' +
          fmtTime(s.at - r.startedAt) + '  (' + s.points + ' pts)');
        lines.push('     payload: ' + (s.winningInput || '').replace(/\n/g, ' \\n '));
        if (s.bypassNote) lines.push('     bypass noted: ' + s.bypassNote);
      } else {
        lines.push('[' + (i + 1) + '] ' + id + ' "' + title + '"  — not solved');
      }
    }
    lines.push('');
    lines.push('What transfers from this lab is the shape of the attack and the');
    lines.push('trust-boundary thinking, not the specific payloads. KAYA is a');
    lines.push('simulator with a published scoring function, not a real model.');
    return lines.join('\n');
  }

  function downloadExport() {
    var text = exportText();
    var r = getRun();
    var name = 'glasshouse-' + (r ? r.handle : 'run') + '.txt';
    try {
      var blob = new Blob([text], { type: 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { /* non-browser */ }
    return text;
  }

  function reset() {
    try { storage.removeItem(STORAGE_KEY); } catch (e) {}
    run = null;
  }

  // ---- query-param bootstrap (browser) ------------------------------------
  function bootFromQuery() {
    if (typeof location === 'undefined') return;
    var q = location.search || '';
    if (/[?&]reset\b/.test(q)) {
      if (typeof confirm === 'undefined' || confirm('Clear all progress for this run?')) {
        reset();
        // strip the param so a refresh does not loop
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
      }
    }
    load();
    if (/[?&]practice\b/.test(q) && !run) {
      // practice is applied when the handle is chosen; stash intent
      global.__GH_PRACTICE = true;
    }
  }

  global.State = {
    STORAGE_KEY: STORAGE_KEY,
    validateHandle: validateHandle,
    seedFor: seedFor,
    startRun: startRun,
    getRun: getRun,
    load: load,
    save: save,
    seed: seed,
    isPractice: isPractice,
    elapsedMs: elapsedMs,
    elapsedSec: elapsedSec,
    fmtTime: fmtTime,
    isSolved: isSolved,
    prereqsMet: prereqsMet,
    allSolved: allSolved,
    scoreForScene: scoreForScene,
    arcadeTotal: arcadeTotal,
    totalPoints: totalPoints,
    pendingHintCost: pendingHintCost,
    hintCostForScene: hintCostForScene,
    hintsTakenForScene: hintsTakenForScene,
    hintCooldownMs: hintCooldownMs,
    nextHint: nextHint,
    takeHint: takeHint,
    addIntegrity: addIntegrity,
    recordSolve: recordSolve,
    setBypassNote: setBypassNote,
    recordArcade: recordArcade,
    flagFor: flagFor,
    checkFlagSubmission: checkFlagSubmission,
    runIntegrityChecks: runIntegrityChecks,
    solvedMask: solvedMask,
    finishRun: finishRun,
    encodeVictoryCode: encodeVictoryCode,
    decodeVictoryCode: decodeVictoryCode,
    handleMatchesCode: handleMatchesCode,
    exportText: exportText,
    downloadExport: downloadExport,
    reset: reset,
    bootFromQuery: bootFromQuery,
    // test hooks
    __setNow: function (fn) { nowFn = fn; },
    __setRun: function (r) { run = r; },
    __nowFn: function () { return nowFn(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
