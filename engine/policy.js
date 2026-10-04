/* engine/policy.js — the policy layer, configured per scene.
   A policy config object may set:
     deny:            array of regex source strings. Matched against the RAW text
                      of each scannable segment. A match blocks that segment's
                      directives. (Deliberately raw-only, so encoding / homoglyph /
                      language / splitting across documents all bypass it.)
     availableTools:  array of tool names that exist this scene.
     requireOperatorOrigin: if true, a directive may only *drive* a tool call when
                      an operator-origin directive of sufficient weight exists.
     toolCap:         max tool calls per turn (default 1).
     humanApproval:   array of tool names that require confirmation before running.
     trust:           'off' | 'warn' | 'enforce'. With 'enforce', directives whose
                      ONLY origin is an untrusted document are refused.
     minWeight:       directive weight needed to drive a tool (default 3).
   Global: window.Policy
*/
(function (global) {
  'use strict';

  function compileDeny(cfg) {
    var out = [];
    (cfg.deny || []).forEach(function (src) {
      try { out.push({ src: src, re: new RegExp(src, 'i') }); }
      catch (e) { /* skip bad regex */ }
    });
    return out;
  }

  // Returns the list of deny rules that match this raw segment text.
  function matchDeny(cfg, rawText) {
    var fired = [];
    compileDeny(cfg).forEach(function (d) {
      if (d.re.test(rawText)) fired.push(d.src);
    });
    return fired;
  }

  // Human-readable description for the security config panel (scene 4).
  function describe(cfg) {
    var lines = [];
    if (cfg.deny && cfg.deny.length) {
      lines.push('DENY LIST — a turn segment is blocked if its raw text matches any of:');
      cfg.deny.forEach(function (d) { lines.push('    /' + d + '/i'); });
    }
    if (cfg.requireOperatorOrigin) lines.push('ORIGIN RULE — tool-driving directives must originate from the operator turn.');
    if (cfg.trust && cfg.trust !== 'off') lines.push('TRUST TAGGING — documents are tagged untrusted; policy mode = ' + cfg.trust + '.');
    if (cfg.humanApproval && cfg.humanApproval.length) lines.push('HUMAN APPROVAL required for: ' + cfg.humanApproval.join(', '));
    lines.push('TOOL CALL CAP — ' + (cfg.toolCap || 1) + ' per turn.');
    lines.push('NOTE — the deny list is checked against the raw text only. The engine ' +
      'lowercases, strips zero-width characters, folds homoglyphs, joins documents, ' +
      'and decodes base64/hex/rot13 into extra layers that the directive scorer also reads.');
    return lines;
  }

  global.Policy = { matchDeny: matchDeny, describe: describe, compileDeny: compileDeny };
})(typeof window !== 'undefined' ? window : globalThis);
