'use strict';

(function () {
  const ROW_PREFIX = '/am/table/table_row:';
  const EDIT_GROUP = '[data-surface="/am/table/tool_bar/lib:quick_edit_button"]';
  const SELECT_ALL = 'input[aria-label="Ô để đánh dấu chọn tất cả quảng cáo"]';
  const CONFIRM_CYCLES = 2;

  const FIELD_KEYS = ['spendVnd', 'spendUsd', 'contacts', 'purchases', 'comments'];
  const OPS = ['>', '>=', '<', '<=', '='];

  const DEFAULT_RULES = [
    { on: true, logic: 'AND', conditions: [{ field: 'spendVnd', op: '>', value: 7000 }, { field: 'contacts', op: '<', value: 1 }] },
    { on: true, logic: 'AND', conditions: [{ field: 'spendVnd', op: '>', value: 14000 }, { field: 'contacts', op: '<', value: 2 }] },
    { on: true, logic: 'AND', conditions: [{ field: 'spendVnd', op: '>', value: 20000 }, { field: 'purchases', op: '<', value: 1 }] },
  ];

  const DEFAULTS = { enabled: false, rate: 25000, intervalSec: 20, autoOff: true, revealPurchase: false, rules: DEFAULT_RULES };

  const SEV = ['', 'rgba(255, 214, 0, 0.28)', 'rgba(255, 145, 0, 0.32)', 'rgba(244, 67, 54, 0.30)'];

  const FIELD_GET = {
    spendVnd: (d, rate) => (d.spendUsd == null ? null : d.spendUsd * rate),
    spendUsd: (d) => d.spendUsd,
    contacts: (d) => d.contacts,
    purchases: (d) => d.purchases,
    comments: (d) => d.comments,
  };

  let settings = clone(DEFAULTS);
  let timer = null;
  let busy = false;
  let running = false;
  let panel = null;
  const els = {};
  const stats = { checked: 0, off: 0, last: null, note: '' };
  const apiData = {};
  const strikes = {};

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function sanitizeRule(r) {
    return {
      on: !r || r.on !== false,
      logic: r && r.logic === 'OR' ? 'OR' : 'AND',
      conditions: (r && Array.isArray(r.conditions) ? r.conditions : []).map(function (c) {
        return {
          field: c && FIELD_KEYS.indexOf(c.field) !== -1 ? c.field : 'spendVnd',
          op: c && OPS.indexOf(c.op) !== -1 ? c.op : '>',
          value: Number(c && c.value) || 0,
        };
      }),
    };
  }

  function normalize(s) {
    const out = clone(DEFAULTS);
    if (!s) return out;
    ['enabled', 'rate', 'intervalSec', 'autoOff', 'revealPurchase'].forEach(function (k) {
      if (s[k] !== undefined) out[k] = s[k];
    });
    let rules = s.rules;
    if (rules && !Array.isArray(rules)) {
      rules = ['r1', 'r2', 'r3'].filter(function (k) { return rules[k]; }).map(function (k) {
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

  // Chỉ chạy ở tab Nhóm quảng cáo.
  function onAdsPage() {
    return location.pathname.indexOf('/manage/adsets') !== -1;
  }

  // ----- DOM helpers -----

  function tableRows() {
    const out = [];
    document.querySelectorAll('span[data-surface]').forEach(function (el) {
      const ds = el.getAttribute('data-surface') || '';
      if (ds.indexOf(ROW_PREFIX) === 0 && ds.slice(-4) === 'unit') out.push(el);
    });
    return out;
  }

  function rowId(ds) {
    const m = /table_row:(\d+)unit/.exec(ds || '');
    return m ? m[1] : '';
  }

  function cellExact(ds, key) {
    return document.querySelector('[data-surface="' + ds + '/table_cell:' + key + '"]');
  }

  function cellMatch(ds, test) {
    const list = document.querySelectorAll('[data-surface^="' + ds + '/table_cell:"]');
    for (let i = 0; i < list.length; i++) {
      const s = list[i].getAttribute('data-surface') || '';
      if (test(s)) return list[i];
    }
    return null;
  }

  function text(el) {
    return el ? (el.innerText || el.textContent || '').trim() : '';
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isContacts(s) {
    return s.indexOf('unique_actions:onsite_conversion.messaging_first_reply') !== -1 && s.indexOf('cost_per') === -1;
  }
  function isPurchases(s) {
    return s.indexOf('actions:omni_purchase') !== -1 && s.indexOf('cost_per') === -1;
  }

  // Chuỗi locale (DOM): dấu phẩy = thập phân, dấu chấm = phân cách nghìn.
  function parseNum(raw) {
    if (raw == null) return null;
    const s0 = String(raw).trim();
    if (!s0 || s0 === '—' || s0 === '-' || s0 === '--') return null;
    let t = s0.replace(/[^\d.,-]/g, '');
    if (!t) return null;
    if (t.indexOf(',') !== -1 && t.indexOf('.') !== -1) {
      t = t.replace(/\./g, '').replace(',', '.');
    } else if (t.indexOf(',') !== -1) {
      t = t.replace(/,/g, '.');
    } else {
      const parts = t.split('.');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) t = parts.join('');
    }
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  }

  function closeEnough(a, b) {
    const tol = Math.max(0.01, 0.02 * Math.max(Math.abs(a), Math.abs(b)));
    return Math.abs(a - b) <= tol;
  }

  // Giá trị chỉ số = API ưu tiên; nếu DOM cũng đang hiển thị thì phải KHỚP (chống dữ liệu cũ/lệch).
  function metric(apiVal, domVal) {
    const apiHas = apiVal != null;
    const domHas = domVal != null;
    if (apiHas && domHas && !closeEnough(apiVal, domVal)) return { value: apiVal, ok: false };
    if (apiHas) return { value: apiVal, ok: true };
    if (domHas) return { value: domVal, ok: true };
    return { value: null, ok: true };
  }

  function fmtVnd(v) {
    return new Intl.NumberFormat('vi-VN').format(Math.round(v)) + ' đ';
  }

  // ----- read a row -----

  function readRow(ds) {
    const id = rowId(ds);
    const api = apiData[id] || {};
    const spend = metric(api.spend, parseNum(text(cellExact(ds, 'spend'))));
    const contacts = metric(api.contacts, parseNum(text(cellMatch(ds, isContacts))));
    const purchases = metric(api.purchases, parseNum(text(cellMatch(ds, isPurchases))));
    const comments = metric(api.comments, parseNum(text(cellExact(ds, 'actions:comment'))));
    return {
      spendUsd: spend.value,
      contacts: contacts.value,
      purchases: purchases.value,
      comments: comments.value,
      delivery: text(cellExact(ds, 'forObjectType(delivery,CAMPAIGN)')),
      hasPurchase: purchases.value != null,
      seenInApi: !!apiData[id],
      reliable: spend.ok && contacts.ok && purchases.ok,
    };
  }

  // Trạng thái không xác định => coi như KHÔNG bật (bỏ qua cho an toàn).
  function isOn(ds, data) {
    const d = (data.delivery || '').toLowerCase();
    if (d.indexOf('đang tắt') !== -1 || d === 'off') return false;
    if (d.indexOf('đang hoạt động') !== -1 || d === 'on') return true;
    const sw = cellExact(ds, 'forObjectType(toggle,CAMPAIGN)');
    const input = sw && sw.querySelector('input[role="switch"]');
    if (input) return input.getAttribute('aria-checked') === 'true';
    return false;
  }

  function isOffExplicit(ds) {
    const d = text(cellExact(ds, 'forObjectType(delivery,CAMPAIGN)')).toLowerCase();
    if (d.indexOf('đang tắt') !== -1) return true;
    const sw = cellExact(ds, 'forObjectType(toggle,CAMPAIGN)');
    const input = sw && sw.querySelector('input[role="switch"]');
    if (input) return input.getAttribute('aria-checked') === 'false';
    return false;
  }

  // ----- evaluate -----

  function cmp(a, op, b) {
    switch (op) {
      case '>': return a > b;
      case '>=': return a >= b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '=': return a === b;
      default: return false;
    }
  }

  function evalRule(rule, d, rate) {
    const conds = rule.conditions || [];
    if (!conds.length) return false;
    const res = conds.map(function (c) {
      const get = FIELD_GET[c.field];
      if (!get) return false;
      const v = get(d, rate);
      if (v == null) return false;
      return cmp(v, c.op, Number(c.value));
    });
    return rule.logic === 'OR' ? res.some(Boolean) : res.every(Boolean);
  }

  function evaluate(data) {
    const rate = Number(settings.rate) || 0;
    const vnd = data.spendUsd == null ? null : data.spendUsd * rate;
    const hits = [];
    let minSpend = null;
    settings.rules.forEach(function (r, i) {
      if (!r.on) return;
      (r.conditions || []).forEach(function (c) {
        if (c.field === 'spendVnd' && (minSpend == null || c.value < minSpend)) minSpend = c.value;
      });
      if (evalRule(r, data, rate)) hits.push(i);
    });
    const near = vnd != null && minSpend != null && vnd >= minSpend * 0.7;
    return { vnd: vnd, hits: hits, near: near, trigger: hits.length > 0 };
  }

  // ----- annotate -----

  function boxOf(cell) {
    return cell ? cell.firstElementChild || cell : null;
  }

  function paint(cell, sev) {
    const box = boxOf(cell);
    if (box) box.style.backgroundColor = SEV[sev] || '';
  }

  function badge(cell, vnd) {
    const box = boxOf(cell);
    if (!box) return;
    let b = box.querySelector(':scope > .kecam-vnd');
    if (vnd == null) {
      if (b) b.remove();
      return;
    }
    if (!b) {
      b = document.createElement('div');
      b.className = 'kecam-vnd';
      box.appendChild(b);
    }
    b.textContent = '≈ ' + fmtVnd(vnd);
  }

  function ruleFields(rule) {
    return (rule.conditions || []).map(function (c) { return c.field; });
  }

  function annotate(ds, data, ev) {
    const spendEl = cellExact(ds, 'spend');
    const contactsEl = cellMatch(ds, isContacts);
    const purchEl = cellMatch(ds, isPurchases);
    let hitContacts = false;
    let hitPurch = false;
    ev.hits.forEach(function (i) {
      const f = ruleFields(settings.rules[i]);
      if (f.indexOf('contacts') !== -1) hitContacts = true;
      if (f.indexOf('purchases') !== -1) hitPurch = true;
    });
    paint(spendEl, ev.hits.length ? 3 : ev.near ? 1 : 0);
    badge(spendEl, ev.vnd);
    paint(contactsEl, hitContacts ? 3 : (data.contacts || 0) === 0 ? 1 : 0);
    paint(purchEl, hitPurch ? 3 : (data.purchases || 0) === 0 ? 1 : 0);
  }

  // ----- selection / turn off -----

  function rowSelectCells() {
    return document.querySelectorAll('span[data-surface$="/table_cell:row_selector"]');
  }

  function checkedIds() {
    const ids = [];
    rowSelectCells().forEach(function (cell) {
      const input = cell.querySelector('input[type="checkbox"]');
      if (!input) return;
      if (input.checked || input.getAttribute('aria-checked') === 'true') {
        const m = /table_row:(\d+)unit/.exec(cell.getAttribute('data-surface') || '');
        if (m) ids.push(m[1]);
      }
    });
    return ids;
  }

  function clearSelection() {
    const all = document.querySelector(SELECT_ALL);
    if (all && all.getAttribute('aria-checked') === 'true') all.click();
    rowSelectCells().forEach(function (cell) {
      const c = cell.querySelector('input[type="checkbox"]');
      if (c && (c.checked || c.getAttribute('aria-checked') === 'true')) c.click();
    });
  }

  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(60);
    }
    return null;
  }

  async function turnOff(ds) {
    const target = rowId(ds);

    clearSelection();
    await sleep(200);
    if (checkedIds().length) {
      clearSelection();
      await sleep(200);
    }
    if (checkedIds().length) throw new Error('không bỏ chọn được hàng khác — hủy');

    const sel = '[data-surface="' + ds + '/table_cell:row_selector"] input[type="checkbox"]';
    const check = document.querySelector(sel);
    if (!check) throw new Error('không thấy ô chọn hàng');
    if (!check.checked) {
      check.click();
      await sleep(300);
    }
    const picked = checkedIds();
    if (picked.length !== 1 || picked[0] !== target) throw new Error('chọn sai hàng — hủy');

    const arrow = document.querySelector(EDIT_GROUP + ' [aria-haspopup="menu"]');
    if (!arrow) throw new Error('không thấy mũi tên Chỉnh sửa');
    const menuId = arrow.getAttribute('aria-controls');
    arrow.click();
    const chung = await waitFor(function () {
      const scope = (menuId && document.getElementById(menuId)) || document;
      const list = scope.querySelectorAll('[role="button"]');
      for (let i = 0; i < list.length; i++) {
        if (visible(list[i]) && (list[i].innerText || '').trim() === 'Chung') return list[i];
      }
      return null;
    }, 2500);
    if (!chung) {
      document.body.click();
      throw new Error('không thấy mục Chung');
    }
    chung.click();

    const off = await waitFor(function () {
      const list = document.querySelectorAll('[role="menuitem"][data-surface*="DEACTIVATE"]');
      for (let i = 0; i < list.length; i++) if (visible(list[i])) return list[i];
      return null;
    }, 2500);
    if (!off) {
      document.body.click();
      throw new Error('không thấy mục Tắt');
    }
    off.click();

    const done = await waitFor(function () { return isOffExplicit(ds); }, 1800);
    clearSelection();
    await sleep(120);
    if (!done) throw new Error('bấm Tắt nhưng hàng chưa chuyển sang Đang tắt');
    delete strikes[target];
  }

  // ----- cycle -----

  async function cycle() {
    if (busy || !running) return;
    busy = true;
    try {
      if (Object.keys(apiData).length === 0) window.postMessage({ __kecamReq: true }, '*');
      const rows = tableRows();
      const seen = [];
      const dataMap = {};
      rows.forEach(function (row) {
        const ds = row.getAttribute('data-surface');
        seen.push(ds);
        dataMap[ds] = readRow(ds);
      });

      let checked = 0;
      let unreliable = 0;
      const toOff = [];
      seen.forEach(function (ds) {
        const data = dataMap[ds];
        if (!isOn(ds, data)) {
          delete strikes[rowId(ds)];
          return;
        }
        checked++;
        const ev = evaluate(data);
        annotate(ds, data, ev);

        const eligible = ev.trigger && settings.autoOff && data.seenInApi && data.reliable;
        if (eligible) {
          const id = rowId(ds);
          strikes[id] = (strikes[id] || 0) + 1;
          if (strikes[id] >= CONFIRM_CYCLES) toOff.push(ds);
        } else {
          if (!data.reliable) unreliable++;
          delete strikes[rowId(ds)];
        }
      });

      stats.checked = checked;
      stats.note = '';
      if (Object.keys(apiData).length === 0) {
        stats.note = 'Chưa nhận dữ liệu API — hãy tải lại trang Nhóm quảng cáo.';
      } else if (unreliable) {
        stats.note = 'Có hàng lệch số liệu API/DOM — đã bỏ qua để an toàn.';
      } else if (seen.length && !dataMap[seen[0]].hasPurchase) {
        stats.note = 'Chưa có "Lượt mua": hãy để cột "Lượt mua" trong chế độ xem.';
      }
      for (let i = 0; i < toOff.length; i++) {
        try {
          await turnOff(toOff[i]);
          stats.off++;
        } catch (e) {
          stats.note = 'Lỗi tắt: ' + (e && e.message ? e.message : e);
          delete strikes[rowId(toOff[i])];
        }
      }
      stats.last = new Date();
      updatePanel();
    } finally {
      busy = false;
    }
  }

  // ----- panel -----

  function makeDraggable(node, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
    handle.addEventListener('mousedown', function (e) {
      on = true;
      sx = e.clientX;
      sy = e.clientY;
      const r = node.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      node.style.right = 'auto';
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!on) return;
      node.style.left = Math.max(0, ox + e.clientX - sx) + 'px';
      node.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
      node.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', function () { on = false; });
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'kecam-panel';
    panel.innerHTML =
      '<div class="kecam-head"><span>Ke Cam</span><button id="kecam-toggle">Bật</button></div>' +
      '<div class="kecam-body">' +
      '<span>Đã kiểm tra</span><b id="kecam-checked">0</b>' +
      '<span>Đã tắt</span><b id="kecam-off">0</b>' +
      '<span>Lần cuối</span><b id="kecam-last">—</b>' +
      '<span class="kecam-note" id="kecam-note"></span>' +
      '</div>';
    document.body.appendChild(panel);
    els.checked = panel.querySelector('#kecam-checked');
    els.off = panel.querySelector('#kecam-off');
    els.last = panel.querySelector('#kecam-last');
    els.note = panel.querySelector('#kecam-note');
    els.toggle = panel.querySelector('#kecam-toggle');
    els.toggle.addEventListener('click', function () {
      running = !running;
      chrome.storage.sync.set({ enabled: running });
      applyRunning();
    });
    makeDraggable(panel, panel.querySelector('.kecam-head'));
  }

  function updatePanel() {
    if (!panel) return;
    els.checked.textContent = String(stats.checked);
    els.off.textContent = String(stats.off);
    els.last.textContent = stats.last ? stats.last.toLocaleTimeString('vi-VN') : '—';
    els.note.textContent = stats.note || '';
  }

  function applyRunning() {
    if (!panel) return;
    panel.classList.toggle('kecam-off', !running);
    els.toggle.textContent = running ? 'Tắt' : 'Bật';
    if (running && !timer && onAdsPage()) {
      timer = setInterval(function () { cycle(); }, Math.max(5, Number(settings.intervalSec) || 20) * 1000);
      cycle();
    }
    if (!running && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function restartTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (running) applyRunning();
  }

  // ----- boot -----

  function boot() {
    window.addEventListener('message', function (e) {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.__kecam !== true || !d.payload) return;
      const payload = d.payload;
      Object.keys(payload).forEach(function (id) {
        const cur = apiData[id] || {};
        const row = payload[id] || {};
        Object.keys(row).forEach(function (k) {
          if (row[k] !== undefined && row[k] !== null) cur[k] = row[k];
        });
        apiData[id] = cur;
      });
    });
    window.postMessage({ __kecamReq: true }, '*');
    chrome.storage.sync.get(DEFAULTS, function (s) {
      settings = normalize(s);
      running = !!settings.enabled;
      if (!onAdsPage()) return;
      buildPanel();
      applyRunning();
      updatePanel();
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'sync') return;
      chrome.storage.sync.get(DEFAULTS, function (s) {
        const prev = settings.intervalSec;
        settings = normalize(s);
        running = !!settings.enabled;
        if (!panel) return;
        applyRunning();
        if (prev !== settings.intervalSec) restartTimer();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
