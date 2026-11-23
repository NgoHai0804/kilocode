'use strict';

const FIELDS = [
  { v: 'spendVnd', label: 'Chi tiêu (VND)' },
  { v: 'spendUsd', label: 'Chi tiêu (USD)' },
  { v: 'contacts', label: 'Liên hệ nhắn tin' },
  { v: 'purchases', label: 'Lượt mua' },
  { v: 'comments', label: 'Bình luận' },
];

const OPS = ['>', '>=', '<', '<=', '='];

const TRASH =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>' +
  '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

const DEFAULT_RULES = [
  { on: true, logic: 'AND', conditions: [{ field: 'spendVnd', op: '>', value: 7000 }, { field: 'contacts', op: '<', value: 1 }] },
  { on: true, logic: 'AND', conditions: [{ field: 'spendVnd', op: '>', value: 14000 }, { field: 'contacts', op: '<', value: 2 }] },
  { on: true, logic: 'AND', conditions: [{ field: 'spendVnd', op: '>', value: 20000 }, { field: 'purchases', op: '<', value: 1 }] },
];

const DEFAULTS = { enabled: false, rate: 25000, intervalSec: 20, autoOff: true, revealPurchase: false, rules: DEFAULT_RULES };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.prototype.slice.call(root.querySelectorAll(sel));
const clone = (o) => JSON.parse(JSON.stringify(o));

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function fieldOptions(sel) {
  return FIELDS.map((f) => '<option value="' + f.v + '"' + (f.v === sel ? ' selected' : '') + '>' + f.label + '</option>').join('');
}
function opOptions(sel) {
  return OPS.map((o) => '<option value="' + o + '"' + (o === sel ? ' selected' : '') + '>' + o + '</option>').join('');
}

function condRow(c) {
  const row = el('div', 'cond');
  row.innerHTML =
    '<select class="cond-field">' + fieldOptions(c.field) + '</select>' +
    '<select class="cond-op">' + opOptions(c.op) + '</select>' +
    '<input class="cond-val" type="number" value="' + c.value + '" />' +
    '<button class="icon" title="Xoá điều kiện">' + TRASH + '</button>';
  $('.icon', row).addEventListener('click', () => row.remove());
  return row;
}

function ruleCard(r, idx) {
  const card = el('div', 'rule');
  card.innerHTML =
    '<div class="rule-top">' +
    '<label class="switch sm"><input type="checkbox" class="rule-on"' + (r.on ? ' checked' : '') + '><span class="slider"></span></label>' +
    '<span class="rule-title">Quy tắc <b>' + (idx + 1) + '</b></span>' +
    '<select class="rule-logic">' +
    '<option value="AND"' + (r.logic === 'AND' ? ' selected' : '') + '>Tất cả (VÀ)</option>' +
    '<option value="OR"' + (r.logic === 'OR' ? ' selected' : '') + '>Bất kỳ (HOẶC)</option>' +
    '</select>' +
    '<button class="icon" title="Xoá quy tắc">' + TRASH + '</button>' +
    '</div>' +
    '<div class="conds"></div>' +
    '<button class="ghost addcond">+ Thêm điều kiện</button>';
  const conds = $('.conds', card);
  (r.conditions || []).forEach((c) => conds.appendChild(condRow(c)));
  $('.addcond', card).addEventListener('click', () => conds.appendChild(condRow({ field: 'contacts', op: '<', value: 1 })));
  $('.rule-top .icon', card).addEventListener('click', () => {
    card.remove();
    renumber();
  });
  card.classList.toggle('off', !r.on);
  return card;
}

function renderRules(rules) {
  const host = $('#rules');
  host.innerHTML = '';
  rules.forEach((r, i) => host.appendChild(ruleCard(r, i)));
  renumber();
}

function renumber() {
  $$('#rules .rule').forEach((card, i) => {
    $('.rule-title b', card).textContent = String(i + 1);
  });
}

function toggleRuleState() {
  $$('#rules .rule').forEach((card) => {
    card.classList.toggle('off', !$('.rule-on', card).checked);
  });
}

function normalize(s) {
  const out = clone(DEFAULTS);
  if (!s) return out;
  ['enabled', 'rate', 'intervalSec', 'autoOff', 'revealPurchase'].forEach((k) => {
    if (s[k] !== undefined) out[k] = s[k];
  });
  let rules = s.rules;
  if (rules && !Array.isArray(rules)) {
    rules = ['r1', 'r2', 'r3']
      .filter((k) => rules[k])
      .map((k) => {
        const o = rules[k];
        const c = [];
        if (o.spend != null) c.push({ field: 'spendVnd', op: '>', value: o.spend });
        if (o.contactsLt != null) c.push({ field: 'contacts', op: '<', value: o.contactsLt });
        if (o.purchasesLt != null) c.push({ field: 'purchases', op: '<', value: o.purchasesLt });
        return { on: o.on !== false, logic: 'AND', conditions: c };
      });
  }
  if (Array.isArray(rules) && rules.length) out.rules = rules.map(sanitizeRule);
  return out;
}

function sanitizeRule(r) {
  return {
    on: !r || r.on !== false,
    logic: r && r.logic === 'OR' ? 'OR' : 'AND',
    conditions: (r && Array.isArray(r.conditions) ? r.conditions : []).map((c) => ({
      field: c && FIELDS.some((f) => f.v === c.field) ? c.field : 'spendVnd',
      op: c && OPS.indexOf(c.op) !== -1 ? c.op : '>',
      value: Number(c && c.value) || 0,
    })),
  };
}

function updateState() {
  $('#stateText').textContent = $('#enabled').checked ? 'Đang theo dõi' : 'Đang tạm dừng';
}

function collect() {
  const rules = $$('#rules .rule').map((card) => ({
    on: $('.rule-on', card).checked,
    logic: $('.rule-logic', card).value,
    conditions: $$('.cond', card).map((c) => ({
      field: $('.cond-field', c).value,
      op: $('.cond-op', c).value,
      value: Number($('.cond-val', c).value) || 0,
    })),
  }));
  return {
    enabled: $('#enabled').checked,
    rate: Number($('#rate').value) || 0,
    intervalSec: Math.max(5, Number($('#intervalSec').value) || 20),
    autoOff: $('#autoOff').checked,
    rules: rules,
  };
}

function load() {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    const cfg = normalize(s);
    $('#enabled').checked = !!cfg.enabled;
    $('#rate').value = cfg.rate;
    $('#intervalSec').value = cfg.intervalSec;
    $('#autoOff').checked = !!cfg.autoOff;
    renderRules(cfg.rules);
    updateState();
  });
}

$('#addRule').addEventListener('click', () => {
  const host = $('#rules');
  host.appendChild(ruleCard({ on: true, logic: 'AND', conditions: [{ field: 'spendVnd', op: '>', value: 0 }] }, host.children.length));
  renumber();
});

$('#rules').addEventListener('change', (e) => {
  if (e.target.classList.contains('rule-on')) toggleRuleState();
});

$('#save').addEventListener('click', () => {
  chrome.storage.sync.set(collect(), () => {
    $('#savedText').textContent = 'Đã lưu';
    setTimeout(() => {
      $('#savedText').textContent = '';
    }, 1500);
  });
});

$('#enabled').addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: $('#enabled').checked });
  updateState();
});

load();
