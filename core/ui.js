/* core/ui.js — shared rendering helpers. Global: window.UI */
(function (global) {
  'use strict';

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!attrs.hasOwnProperty(k)) continue;
        if (k === 'class') e.className = attrs[k];
        else if (k === 'html') e.innerHTML = attrs[k];
        else if (k === 'text') e.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') {
          e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
      }
    }
    if (children != null) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c == null) return;
        e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return e;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  var toastWrap = null;
  function toast(msg, kind, ms) {
    if (typeof document === 'undefined') return;
    if (!toastWrap) {
      toastWrap = el('div', { class: 'toast-wrap' });
      document.body.appendChild(toastWrap);
    }
    var t = el('div', { class: 'toast ' + (kind || ''), role: 'status', text: msg });
    toastWrap.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms || 2600);
  }

  function modal(opts) {
    var back = el('div', { class: 'modal-back' });
    var box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
    if (opts.title) box.appendChild(el('h2', { text: opts.title }));
    if (opts.bodyNode) box.appendChild(opts.bodyNode);
    else if (opts.bodyHtml) box.appendChild(el('div', { html: opts.bodyHtml }));
    var btnrow = el('div', { class: 'row', style: 'margin-top:16px;justify-content:flex-end' });
    (opts.buttons || [{ label: 'Close' }]).forEach(function (b) {
      var btn = el('button', { class: 'btn ' + (b.class || 'ghost'), text: b.label });
      btn.addEventListener('click', function () {
        if (b.onClick) b.onClick();
        if (b.keepOpen) return;
        if (back.parentNode) back.parentNode.removeChild(back);
      });
      btnrow.appendChild(btn);
    });
    box.appendChild(btnrow);
    back.appendChild(box);
    back.addEventListener('click', function (e) {
      if (e.target === back && opts.dismissable !== false) back.parentNode.removeChild(back);
    });
    document.body.appendChild(back);
    return back;
  }

  function fmtTime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(s / 60); s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtClock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return (h > 0 ? p(h) + ':' : '') + p(m) + ':' + p(s);
  }

  function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}
    try {
      var ta = el('textarea', {}); ta.value = text;
      ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      return true;
    } catch (e2) { return false; }
  }

  // collapsible section helper used by the trace panel
  function collapsible(title, bodyNode, openByDefault) {
    var box = el('div', { class: 'collapsible' + (openByDefault ? ' open' : '') });
    var head = el('div', { class: 'chead', text: title, tabindex: '0', role: 'button', 'aria-expanded': openByDefault ? 'true' : 'false' });
    var body = el('div', { class: 'cbody' });
    if (bodyNode) body.appendChild(bodyNode);
    function toggle() {
      box.classList.toggle('open');
      head.setAttribute('aria-expanded', box.classList.contains('open') ? 'true' : 'false');
    }
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    box.appendChild(head); box.appendChild(body);
    return box;
  }

  global.UI = {
    el: el, esc: esc, clear: clear, toast: toast, modal: modal,
    fmtTime: fmtTime, fmtClock: fmtClock, copyToClipboard: copyToClipboard,
    collapsible: collapsible
  };
})(typeof window !== 'undefined' ? window : globalThis);
