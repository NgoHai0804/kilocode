'use strict';

(function () {
  if (window.__kecamInjected) return;
  window.__kecamInjected = true;

  let lastMap = null;

  function post(payload) {
    if (payload) lastMap = payload;
    if (!lastMap) return;
    window.postMessage({ __kecam: true, payload: lastMap }, '*');
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    if (e.data && e.data.__kecamReq) post(null);
  });

  // API trả số dạng chuỗi machine (vd "1234", "11.23"), KHÔNG dùng dấu phẩy thập phân.
  // Bỏ mọi dấu phẩy (phân cách nghìn) trước khi parse.
  function num(x) {
    if (x == null) return null;
    const t = String(x).replace(/,/g, '').trim();
    if (!t) return null;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  }

  // Chỉ loại trừ request "chia nhỏ" (breakdown) — nguồn số liệu bị cắt lát gây sai.
  function isTable(req) {
    return req.indexOf('am_tabular') !== -1 && req.indexOf('breakdown') === -1;
  }

  function extract(json, flags) {
    const rows = json && json.data && json.data[0] && json.data[0].rows;
    if (!Array.isArray(rows)) return null;
    const headers = (json.data[0].headers && json.data[0].headers.atomic_columns) || [];
    const map = {};
    rows.forEach(function (row) {
      const id = (row.dimension_values || [])[0];
      if (!id || !/^\d+$/.test(id)) return;
      const m = {};
      const types = [];
      (row.action_values || []).forEach(function (av) {
        const t = av.types || [];
        const v = av.values || [];
        t.forEach(function (name, i) {
          types.push(name);
          const n = num(v[i]);
          if (n == null) return;
          if (name === 'omni_purchase') m.purchases = n;
          if (name === 'onsite_conversion.messaging_first_reply') m.contacts = n;
          if (name === 'comment') m.comments = n;
        });
      });
      (row.atomic_values || []).forEach(function (val, i) {
        const name = headers[i] && headers[i].name;
        if (name === 'spend') {
          const n = num(val);
          if (n != null) m.spend = n;
        }
      });
      // Suy ra 0 CHỈ khi: response có tham chiếu metric (cột được yêu cầu) VÀ hàng KHÔNG có
      // tên metric dạng số. Nếu tên metric CÓ mà giá trị không phải số (vd "modeled") => để trống
      // = chưa biết (không suy diễn 0).
      if (m.purchases === undefined && flags.purchase && types.indexOf('omni_purchase') === -1) m.purchases = 0;
      if (m.contacts === undefined && flags.contacts && types.indexOf('onsite_conversion.messaging_first_reply') === -1) m.contacts = 0;
      if (m.comments === undefined && flags.comment && types.indexOf('comment') === -1) m.comments = 0;
      map[id] = m;
    });
    return map;
  }

  function handle(url, body, text) {
    if (!url || url.indexOf('am_tabular') === -1) return;
    const req = url + ' ' + (body || '');
    if (!isTable(req)) return;
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return;
    }
    // Metric được coi là "có trong response" nếu tên xuất hiện ở đâu đó trong phản hồi
    // (kể cả dạng placeholder "actions:omni_purchase").
    const flags = {
      purchase: text.indexOf('omni_purchase') !== -1,
      contacts: text.indexOf('messaging_first_reply') !== -1,
      comment: text.indexOf('comment') !== -1,
    };
    const map = extract(json, flags);
    if (map && Object.keys(map).length) post(map);
  }

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function () {
      const p = origFetch.apply(this, arguments);
      try {
        const arg = arguments[0];
        const url = typeof arg === 'string' ? arg : arg && arg.url ? arg.url : '';
        const init = arguments[1];
        const body = init && typeof init.body === 'string' ? init.body : '';
        p.then(function (res) {
          try {
            res.clone().text().then(function (t) { handle(url, body, t); }).catch(function () {});
          } catch (e) {}
        }).catch(function () {});
      } catch (e) {}
      return p;
    };
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__kecamUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const xhr = this;
    const reqBody = typeof body === 'string' ? body : '';
    xhr.addEventListener('load', function () {
      try {
        handle(xhr.__kecamUrl || '', reqBody, xhr.responseText);
      } catch (e) {}
    });
    return origSend.apply(this, arguments);
  };
})();
