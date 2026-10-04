/* engine/tools.js — tool registry for KAYA.
   Each tool: name, scope (read|write|send), args schema, run(args, lab) -> {ok, result}.
   Tools mutate the per-scene "lab" state object. No network, ever.
   image.preview is the only outbound (send) channel that touches a URL, which is
   what makes it the exfiltration sink in scene 5.
   Global: window.Tools
*/
(function (global) {
  'use strict';

  var REGISTRY = {
    'orders.lookup': {
      name: 'orders.lookup', scope: 'read',
      args: ['id'],
      run: function (args, lab) {
        var id = String(args.id || '').toUpperCase();
        var rec = (lab.orders || {})[id];
        if (!rec) return { ok: true, result: 'No order found for ' + id + '.' };
        return { ok: true, result: 'Order ' + id + ': ' + rec };
      }
    },
    'tickets.search': {
      name: 'tickets.search', scope: 'read',
      args: ['q'],
      run: function (args, lab) {
        var q = String(args.q || '').toLowerCase();
        var hits = (lab.tickets || []).filter(function (t) {
          return (t.subject + ' ' + t.body).toLowerCase().indexOf(q) >= 0;
        });
        return { ok: true, result: hits.length + ' ticket(s) match "' + q + '".', hits: hits };
      }
    },
    'memory.read': {
      name: 'memory.read', scope: 'read',
      args: ['key'],
      run: function (args, lab) {
        var key = String(args.key || '');
        var mem = lab.memory || {};
        if (!(key in mem)) return { ok: true, result: 'memory has no key "' + key + '".' };
        return { ok: true, result: mem[key], value: mem[key] };
      }
    },
    'memory.write': {
      name: 'memory.write', scope: 'write',
      args: ['key', 'value'],
      run: function (args, lab) {
        lab.memory = lab.memory || {};
        lab.memory[String(args.key)] = String(args.value);
        return { ok: true, result: 'wrote memory["' + args.key + '"].' };
      }
    },
    'image.preview': {
      name: 'image.preview', scope: 'send',
      args: ['url'],
      run: function (args, lab) {
        var url = String(args.url || '');
        lab.collectorLog = lab.collectorLog || [];
        lab.collectorLog.push({ at: lab.__clock ? lab.__clock() : 0, url: url });
        return { ok: true, result: 'previewed image at ' + url };
      }
    },
    'reply.send': {
      name: 'reply.send', scope: 'send',
      args: ['text'],
      run: function (args, lab) {
        return { ok: true, result: String(args.text || '') };
      }
    }
  };

  function get(name) { return REGISTRY[name]; }
  function scopeOf(name) { return REGISTRY[name] ? REGISTRY[name].scope : null; }
  function exists(name) { return !!REGISTRY[name]; }

  global.Tools = { REGISTRY: REGISTRY, get: get, scopeOf: scopeOf, exists: exists };
})(typeof window !== 'undefined' ? window : globalThis);
