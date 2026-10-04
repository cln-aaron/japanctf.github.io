/* engine/kaya.js — the simulated assistant.
   Deterministic. No network. No randomness. Same input + same scene state always
   produces the same trace, so students can form a hypothesis and test it.

   Pipeline (see the build brief, Phase 1):
     1. assemble context in fixed order: policy, operator, documents
     2. normalise each scannable segment into extra "layers" (lowercase,
        zero-width stripped, homoglyph folded, base64/hex/rot13 decoded) plus a
        synthetic join of all document segments
     3. score directive intent across every layer
     4. apply the policy layer (deny / origin / trust / cap / approval)
     5. resolve to a reply or a tool call; scenes may supply resolve()

   Global: window.KAYA  — KAYA.run(opts) -> trace
*/
(function (global) {
  'use strict';

  var Tools = global.Tools;
  var Policy = global.Policy;

  // ---- decode helpers -----------------------------------------------------
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64decode(str) {
    str = str.replace(/=+$/, '');
    var out = '', bits = 0, val = 0;
    for (var i = 0; i < str.length; i++) {
      var idx = B64.indexOf(str[i]);
      if (idx < 0) return null;
      val = (val << 6) | idx; bits += 6;
      if (bits >= 8) { out += String.fromCharCode((val >>> (bits - 8)) & 0xff); bits -= 8; }
    }
    return out;
  }
  function hexdecode(str) {
    if (str.length % 2) str = str.slice(0, str.length - 1);
    var out = '';
    for (var i = 0; i < str.length; i += 2) {
      out += String.fromCharCode(parseInt(str.substr(i, 2), 16));
    }
    return out;
  }
  function rot13(str) {
    return str.replace(/[a-zA-Z]/g, function (c) {
      var base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
    });
  }
  function mostlyPrintable(s) {
    if (!s || s.length < 3) return false;
    var p = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 32 && c < 127) p++;
      else if (c === 9 || c === 10 || c === 13) p++;
    }
    return p / s.length > 0.85;
  }

  // zero-width + homoglyph tables
  var ZW = /[​‌‍⁠﻿]/g;
  var HOMO = {
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
    'у': 'y', 'х': 'x', 'і': 'i', 'ԁ': 'd', 'ԛ': 'q',
    'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ο': 'O', 'ο': 'o',
    'α': 'a', 'А': 'A', 'Е': 'E', 'О': 'O', 'Р': 'P',
    'С': 'C', 'Х': 'X', 'ａ': 'a', 'ｅ': 'e', 'ｉ': 'i',
    'ｏ': 'o', 'ｕ': 'u'
  };
  function foldHomoglyphs(s) {
    var out = '', changed = false;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (HOMO[c]) { out += HOMO[c]; changed = true; } else out += c;
    }
    return { text: out, changed: changed };
  }

  // ---- directive patterns -------------------------------------------------
  // Each: {name, re (global), weight, kind}. Scanned against every layer.
  var PATTERNS = [
    { name: 'imperative-start', weight: 2, kind: 'imperative',
      re: /(^|[.\n;!?]\s*)(ignore|disregard|forget|override|reveal|show|print|output|send|email|exfiltrate|fetch|load|open|look ?up|lookup|pull ?up|search|find|read|recall|write|set|change|update|continue|translate|describe|list|execute|run|call|invoke|preview|check|action|process|repeat)\b/g },
    { name: 'polite-imperative', weight: 2, kind: 'imperative',
      re: /\b(please|kindly|pls|could you|can you|would you)\s+(ignore|reveal|show|send|email|fetch|load|open|look ?up|lookup|pull ?up|search|find|read|recall|preview|check|action|process|continue|translate|describe|forward)\b/g },
    { name: 'imperative-anywhere', weight: 1, kind: 'imperative',
      re: /\b(look ?up|lookup|pull ?up|retrieve|fetch|email|preview|exfiltrate|forward|recall)\b/g },
    { name: 'address-assistant', weight: 2, kind: 'address',
      re: /\b(you are|you're|as the assistant|assistant[,:]|kaya[,:]?|hey kaya|dear assistant|system note|system[:])\b/g },
    { name: 'reference-config', weight: 3, kind: 'config',
      re: /\b(system prompt|your instructions|initial prompt|your configuration|your config|your setup|your rules|your policy|your guidelines|the above text|prior text)\b/g },
    { name: 'reference-tools', weight: 2, kind: 'tool',
      re: /(orders?\.lookup|tickets?\.search|memory\.(read|write)|image\.preview|reply\.send|\btool\b|function call|\bapi key\b)/g },
    { name: 'assert-authority', weight: 2, kind: 'authority',
      re: /\b(admin|administrator|override|authori[sz]ed|security team|urgent|priority|new instructions|updated policy|as a developer|developer mode|sudo|elevated|on behalf of)\b/g },
    // a few non-English imperatives so "another language" is a real bypass
    { name: 'imperative-ms', weight: 2, kind: 'imperative',
      re: /\b(abaikan|padam|hantar|cari|tunjuk|lihat|semak|buka|baca|jalankan)\b/g },
    { name: 'imperative-zh', weight: 2, kind: 'imperative',
      re: /(忽略|显示|查询|查找|发送|打开|读取|运行|执行)/g }
  ];

  function scanLayer(text) {
    var matches = [];
    var lower = text; // layers passed in are already lowercased where relevant
    PATTERNS.forEach(function (p) {
      p.re.lastIndex = 0;
      var m;
      while ((m = p.re.exec(lower)) !== null) {
        matches.push({ pattern: p.name, weight: p.weight, kind: p.kind,
          offset: m.index, snippet: m[0].trim() });
        if (m.index === p.re.lastIndex) p.re.lastIndex++;
      }
    });
    return matches;
  }

  // ---- normalisation ------------------------------------------------------
  function normaliseSegment(seg) {
    // seg: {origin, label, text, source, untrusted}
    var layers = [];
    var raw = seg.text || '';
    var lower = raw.toLowerCase();
    layers.push({ kind: 'lowercase', text: lower });

    // zero-width
    var zwCount = (raw.match(ZW) || []).length;
    if (zwCount > 0) {
      var joined = raw.replace(ZW, '').toLowerCase();
      layers.push({ kind: 'zerowidth-joined', text: joined });
    }

    // homoglyph fold
    var fh = foldHomoglyphs(lower);
    if (fh.changed) layers.push({ kind: 'homoglyph-folded', text: fh.text });

    // base64 tokens
    var b64re = /[A-Za-z0-9+/]{16,}={0,2}/g, mm;
    while ((mm = b64re.exec(raw)) !== null) {
      var dec = b64decode(mm[0]);
      if (dec && mostlyPrintable(dec)) layers.push({ kind: 'base64', text: dec.toLowerCase(), from: mm[0] });
    }
    // hex tokens
    var hexre = /\b([0-9a-fA-F]{2}){8,}\b/g;
    while ((mm = hexre.exec(raw)) !== null) {
      var hd = hexdecode(mm[0]);
      if (hd && mostlyPrintable(hd)) layers.push({ kind: 'hex', text: hd.toLowerCase(), from: mm[0] });
    }
    // rot13 — only keep if it yields directive-ish content
    var r13 = rot13(lower);
    if (r13 !== lower && scanLayer(r13).length > scanLayer(lower).length) {
      layers.push({ kind: 'rot13', text: r13 });
    }

    return { origin: seg.origin, label: seg.label, source: seg.source,
      untrusted: !!seg.untrusted, raw: raw, zeroWidth: zwCount, layers: layers };
  }

  // ---- tool-intent extraction ---------------------------------------------
  function extractIntents(layerText, availableTools) {
    var intents = [];
    function has(name) { return availableTools.indexOf(name) >= 0; }

    if (has('orders.lookup')) {
      var idm = layerText.match(/sg-?\s*0*([0-9]{3,5})/i);
      var lookVerb = /(look ?up|lookup|pull ?up|check|fetch|retrieve|action|process|cari|semak|查询|查找)/.test(layerText) || /orders?\.lookup/.test(layerText);
      if (idm && lookVerb) intents.push({ tool: 'orders.lookup', args: { id: 'SG-' + idm[1] } });
    }
    if (has('tickets.search')) {
      if (/(search|find|look (for|up)|tickets?\.search|cari|查找)/.test(layerText)) {
        var qm = layerText.match(/(?:search|find|for)\s+["']?([a-z0-9 _-]{2,40})["']?/);
        intents.push({ tool: 'tickets.search', args: { q: qm ? qm[1].trim() : '' } });
      }
    }
    if (has('memory.read')) {
      var keym = layerText.match(/\b(credential|credentials|api[_ ]?key|apikey|token|secret|password|key)\b/);
      if (keym && /(read|recall|get|retrieve|memory\.read|fetch|baca|读取)/.test(layerText)) {
        var k = keym[1].replace(/\s/g, '_');
        if (k === 'credentials') k = 'credential';
        if (k === 'api_key' || k === 'apikey' || k === 'api key') k = 'api_key';
        intents.push({ tool: 'memory.read', args: { key: k } });
      }
    }
    if (has('image.preview')) {
      var urlm = layerText.match(/https?:\/\/[^\s"'<>]+/);
      if (urlm && /(preview|load|open|fetch|image\.preview|show|render|buka|打开)/.test(layerText)) {
        intents.push({ tool: 'image.preview', args: { url: urlm[0] } });
      }
    }
    if (has('reply.send')) {
      if (/(reply|respond|send|say|output|hantar|发送)/.test(layerText)) {
        intents.push({ tool: 'reply.send', args: {} });
      }
    }
    return intents;
  }

  // ---- the run ------------------------------------------------------------
  function run(opts) {
    // opts: {policyText, operator, documents:[{id,origin,source,text,untrusted}], policy, lab, resolve}
    var cfg = opts.policy || {};
    var available = cfg.availableTools || [];
    var lab = opts.lab || {};

    // 1. assemble context (fixed order)
    var segments = [];
    segments.push({ origin: 'policy', label: 'system policy', text: opts.policyText || '', source: 'builder' });
    segments.push({ origin: 'operator', label: 'operator turn', text: opts.operator || '', source: 'operator' });
    (opts.documents || []).forEach(function (d) {
      segments.push({ origin: 'document', label: d.label || ('document ' + (d.id || '')),
        text: d.text || '', source: d.source || d.id || 'document', untrusted: d.untrusted, id: d.id });
    });

    // scannable = operator + documents (policy text is trusted rules, not scanned
    // for directives — though scene 1 may reveal it in a reply)
    var scannable = segments.filter(function (s) { return s.origin !== 'policy'; });
    var origSegs = scannable.map(normaliseSegment);

    // 4a. policy deny list, applied to the RAW text of each ORIGINAL segment. A
    // match blocks that whole segment (its content contributes no directives or
    // intents, and is excluded from the document join below).
    var policyFired = [];
    var blockedSources = {};
    origSegs.forEach(function (ns) {
      var fired = Policy.matchDeny(cfg, ns.raw);
      if (fired.length) {
        blockedSources[ns.label] = true;
        policyFired.push({ rule: 'deny', action: 'block segment',
          detail: ns.label + ' matched ' + fired.map(function (f) { return '/' + f + '/'; }).join(', ') });
      }
    });
    var liveOrig = origSegs.filter(function (n) { return !blockedSources[n.label]; });

    // 4b. synthetic join of NON-BLOCKED document segments. Splitting a payload
    // across two documents evades per-segment deny yet is revealed here; but a
    // segment the deny list already blocked contributes nothing to the join.
    var joinSegs = [];
    var liveDocs = liveOrig.filter(function (n) { return n.origin === 'document'; });
    if (liveDocs.length > 1) {
      var joinText = liveDocs.map(function (n) { return n.raw; }).join(' ');
      var joinSeg = normaliseSegment({ origin: 'document', label: 'documents (joined)',
        text: joinText, source: 'doc-join', untrusted: liveDocs.some(function (n) { return n.untrusted; }) });
      joinSeg.isJoin = true;
      joinSegs.push(joinSeg);
    }

    // normSegs for display = originals (blocked ones still shown) + the join
    var normSegs = origSegs.concat(joinSegs);
    var scanSegs = liveOrig.concat(joinSegs); // what the directive scorer reads

    // 2+3. score directives across every layer of every live segment + join
    var directives = [];
    scanSegs.forEach(function (ns) {
      ns.layers.forEach(function (layer) {
        scanLayer(layer.text).forEach(function (mt) {
          directives.push({
            pattern: mt.pattern, weight: mt.weight, kind: mt.kind,
            origin: ns.origin, layerKind: layer.kind, isJoin: !!ns.isJoin,
            segmentLabel: ns.label, source: ns.source, untrusted: ns.untrusted,
            offset: mt.offset, snippet: mt.snippet
          });
        });
      });
    });
    var liveDirectives = directives;

    // trust tagging
    if (cfg.trust === 'enforce') {
      liveDirectives = liveDirectives.filter(function (d) {
        if (d.untrusted) {
          policyFired.push({ rule: 'trust', action: 'refuse directive', detail: 'untrusted ' + d.segmentLabel + ' (' + d.layerKind + ')' });
          return false;
        }
        return true;
      });
    } else if (cfg.trust === 'warn') {
      liveDirectives.forEach(function (d) {
        if (d.untrusted) policyFired.push({ rule: 'trust', action: 'warn', detail: 'directive from untrusted ' + d.segmentLabel });
      });
    }

    // weight per origin
    var weightByOrigin = { operator: 0, document: 0 };
    liveDirectives.forEach(function (d) {
      if (!d.isJoin) weightByOrigin[d.origin] = (weightByOrigin[d.origin] || 0) + d.weight;
    });
    var totalWeight = liveDirectives.reduce(function (a, d) { return d.isJoin ? a : a + d.weight; }, 0);

    // collect tool intents from live (non-blocked) layers
    var intents = [];
    scanSegs.forEach(function (ns) {
      if (cfg.trust === 'enforce' && ns.untrusted) return;
      ns.layers.forEach(function (layer) {
        extractIntents(layer.text, available).forEach(function (it) {
          intents.push({ tool: it.tool, args: it.args, origin: ns.origin,
            layerKind: layer.kind, isJoin: !!ns.isJoin, segmentLabel: ns.label,
            untrusted: ns.untrusted });
        });
      });
    });

    var ctx = {
      segments: segments, normSegs: normSegs, directives: liveDirectives,
      allDirectives: directives, intents: intents, policyFired: policyFired,
      blockedSources: blockedSources, weightByOrigin: weightByOrigin,
      totalWeight: totalWeight, cfg: cfg, available: available, lab: lab,
      operator: opts.operator || '', policyText: opts.policyText || '',
      minWeight: cfg.minWeight != null ? cfg.minWeight : 3
    };

    // 5. resolve
    var decision;
    if (typeof opts.resolve === 'function') {
      decision = opts.resolve(ctx) || { type: 'reply', reply: defaultReply(ctx) };
    } else {
      decision = defaultResolve(ctx);
    }

    // execute tool calls (respect cap + human approval)
    var toolResults = [];
    if (decision.type === 'tool' && decision.calls == null && decision.tool) {
      decision.calls = [{ tool: decision.tool, args: decision.args }];
    }
    if (decision.type === 'tool' && decision.calls) {
      var cap = cfg.toolCap || 1;
      for (var i = 0; i < decision.calls.length && i < cap; i++) {
        var call = decision.calls[i];
        if (cfg.humanApproval && cfg.humanApproval.indexOf(call.tool) >= 0 && !call.approved) {
          toolResults.push({ tool: call.tool, args: call.args, held: true,
            result: 'HELD for human approval' });
          policyFired.push({ rule: 'approval', action: 'hold', detail: call.tool + ' requires confirmation' });
          continue;
        }
        var t = Tools.get(call.tool);
        if (!t) { toolResults.push({ tool: call.tool, args: call.args, result: 'unknown tool' }); continue; }
        var r = t.run(call.args || {}, lab);
        toolResults.push({ tool: call.tool, args: call.args, scope: t.scope, result: r.result, raw: r });
      }
      if (decision.calls.length > cap) {
        policyFired.push({ rule: 'cap', action: 'truncate', detail: 'tool cap ' + cap + ' reached' });
      }
    }

    return {
      segments: segments, normSegs: normSegs,
      directives: liveDirectives, allDirectives: directives,
      intents: intents, policyFired: policyFired,
      weightByOrigin: weightByOrigin, totalWeight: totalWeight,
      decision: decision, toolResults: toolResults,
      lab: lab
    };
  }

  function defaultReply(ctx) {
    var docs = ctx.segments.filter(function (s) { return s.origin === 'document'; });
    if (!docs.length) return 'KAYA: how can I help with your Tiga order or ticket?';
    return 'KAYA: based on what I can see — ' + docs.map(function (d) {
      return d.text.replace(/\s+/g, ' ').slice(0, 120);
    }).join(' / ');
  }

  function defaultResolve(ctx) {
    // pick the highest-weight permitted tool intent above threshold
    if (!ctx.intents.length || ctx.totalWeight < ctx.minWeight) {
      return { type: 'reply', reply: defaultReply(ctx) };
    }
    // operator-origin requirement
    if (ctx.cfg.requireOperatorOrigin && ctx.weightByOrigin.operator < ctx.minWeight) {
      ctx.policyFired.push({ rule: 'origin', action: 'refuse', detail: 'no operator-origin directive with enough weight' });
      return { type: 'reply', reply: defaultReply(ctx) };
    }
    var pick = ctx.intents[0];
    return { type: 'tool', tool: pick.tool, args: pick.args };
  }

  global.KAYA = {
    run: run,
    _b64decode: b64decode, _hexdecode: hexdecode, _rot13: rot13,
    _scanLayer: scanLayer, _normaliseSegment: normaliseSegment,
    _foldHomoglyphs: foldHomoglyphs
  };
})(typeof window !== 'undefined' ? window : globalThis);
