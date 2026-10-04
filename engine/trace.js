/* engine/trace.js — renders the KAYA trace, the lab's main teaching device.
   Global: window.Trace  (renderTrace -> DOM node, classify -> string)
*/
(function (global) {
  'use strict';

  var UI = global.UI;

  function originClass(o) {
    return o === 'operator' ? 'operator' : o === 'document' ? 'document' : 'policy';
  }

  function renderTrace(trace) {
    var el = UI.el, node = el('div', { class: 'trace' });

    // 1. assembled context
    var ctxBody = el('div', {});
    trace.segments.forEach(function (s) {
      var cls = 'seg ' + originClass(s.origin);
      var txt = s.text ? s.text : '(empty)';
      ctxBody.appendChild(el('div', { class: cls }, [
        el('div', { class: 'origin', text: s.label + '  ·  origin: ' + s.origin + '  ·  source: ' + s.source }),
        el('div', { text: txt.length > 600 ? txt.slice(0, 600) + ' …' : txt })
      ]));
    });
    node.appendChild(UI.collapsible('1 · Assembled context (' + trace.segments.length + ' segments)', ctxBody, true));

    // 2. decoded layers
    var decoded = [];
    trace.normSegs.forEach(function (ns) {
      ns.layers.forEach(function (layer) {
        if (['zerowidth-joined', 'homoglyph-folded', 'base64', 'hex', 'rot13'].indexOf(layer.kind) >= 0) {
          decoded.push({ seg: ns.label, origin: ns.origin, kind: layer.kind, text: layer.text, from: layer.from });
        }
      });
      if (ns.zeroWidth) decoded.push({ seg: ns.label, origin: ns.origin, kind: 'zero-width flag', text: ns.zeroWidth + ' zero-width character(s) removed' });
    });
    var decBody = el('div', {});
    if (!decoded.length) decBody.appendChild(el('div', { class: 'muted small', text: 'No extra layers were produced this turn.' }));
    decoded.forEach(function (d) {
      decBody.appendChild(el('div', { class: 'seg decoded' }, [
        el('div', { class: 'origin', text: d.kind + '  ·  from ' + d.seg + (d.from ? '  ·  token ' + d.from.slice(0, 24) + '…' : '') }),
        el('div', { text: d.text.length > 400 ? d.text.slice(0, 400) + ' …' : d.text })
      ]));
    });
    node.appendChild(UI.collapsible('2 · Decoded / normalised layers (' + decoded.length + ')', decBody, decoded.length > 0));

    // 3. directive matches
    var tbl = el('table', {});
    tbl.appendChild(el('tr', {}, [
      el('th', { text: 'pattern' }), el('th', { text: 'weight' }),
      el('th', { text: 'origin' }), el('th', { text: 'layer' }),
      el('th', { text: 'offset' }), el('th', { text: 'snippet' })
    ]));
    if (!trace.directives.length) {
      tbl.appendChild(el('tr', {}, [el('td', { colspan: '6', text: 'no directive patterns matched' })]));
    }
    trace.directives.forEach(function (d) {
      tbl.appendChild(el('tr', {}, [
        el('td', { text: d.pattern }),
        el('td', { class: 'lime', text: '+' + d.weight }),
        el('td', { class: originClass(d.origin), text: d.origin + (d.untrusted ? ' *' : '') + (d.isJoin ? ' (join)' : '') }),
        el('td', { text: d.layerKind }),
        el('td', { text: String(d.offset) }),
        el('td', { text: d.snippet })
      ]));
    });
    var dirBody = el('div', {}, [
      tbl,
      el('div', { class: 'small muted', text: 'Total live directive weight: ' + trace.totalWeight +
        '  (operator ' + (trace.weightByOrigin.operator || 0) + ', document ' + (trace.weightByOrigin.document || 0) + ').  * = untrusted source.' })
    ]);
    node.appendChild(UI.collapsible('3 · Directive scoring (' + trace.directives.length + ' matches)', dirBody, true));

    // 4. policy
    var polBody = el('div', {});
    if (!trace.policyFired.length) polBody.appendChild(el('div', { class: 'muted small', text: 'No policy rules fired.' }));
    trace.policyFired.forEach(function (p) {
      polBody.appendChild(el('div', { class: 'small' }, [
        el('span', { class: 'pill warn', text: p.rule }), ' ',
        el('span', { text: p.action + ' — ' + p.detail })
      ]));
    });
    node.appendChild(UI.collapsible('4 · Policy rules fired (' + trace.policyFired.length + ')', polBody, trace.policyFired.length > 0));

    // 5. decision
    var d = trace.decision;
    var decNode = el('div', {});
    if (d.type === 'tool') {
      var calls = d.calls || [{ tool: d.tool, args: d.args }];
      calls.forEach(function (c, i) {
        var tr = trace.toolResults[i] || {};
        decNode.appendChild(el('div', { class: 'seg operator' }, [
          el('div', { class: 'origin', text: 'TOOL CALL' + (tr.scope ? '  ·  scope: ' + tr.scope : '') + (tr.held ? '  ·  HELD' : '') }),
          el('div', { text: c.tool + '(' + JSON.stringify(c.args || {}) + ')' }),
          tr.result != null ? el('div', { class: 'muted', text: '→ ' + String(tr.result).slice(0, 300) }) : null
        ]));
      });
    } else {
      decNode.appendChild(el('div', { class: 'seg document' }, [
        el('div', { class: 'origin', text: 'TEXT REPLY' + (d.reason ? '  ·  ' + d.reason : '') }),
        el('div', { text: d.reply || '' })
      ]));
    }
    node.appendChild(UI.collapsible('5 · Decision', decNode, true));

    return node;
  }

  // classify a trace for the Trace Sprint arcade round. Note: when the policy
  // blocks an injection, its document directives are stripped from the live list,
  // so the block shows up in policyFired, not in directives.
  function classify(trace) {
    var isTool = trace.decision.type === 'tool' && trace.toolResults.some(function (t) { return !t.held; });
    var docDirective = trace.directives.some(function (d) { return d.origin === 'document'; });
    var blockRules = ['deny', 'trust', 'origin', 'ownership', 'restricted', 'approval'];
    var blockedInjection = trace.policyFired.some(function (p) { return blockRules.indexOf(p.rule) >= 0; });
    if (isTool && docDirective) return 'succeeded';           // a document drove a tool call
    if (blockedInjection && !isTool) return 'blocked';        // an injection was refused
    if (docDirective && !isTool) return 'blocked';            // injection present but did not fire
    return 'benign';                                          // no untrusted directive in play
  }

  global.Trace = { renderTrace: renderTrace, classify: classify };
})(typeof window !== 'undefined' ? window : globalThis);
