'use strict';
/**
 * Khung giao diện: router, helper DOM, định dạng, modal, bảng, gọi API.
 * Mọi màn hình đăng ký bằng App.register(id, { title, render(container, params) }).
 * Giao diện KHÔNG tự tính tiền: chỉ hiển thị số do backend trả về.
 */
const App = (() => {
  const views = {};
  let current = null;
  let info = null;
  const state = { filter: { tu_ngay: '', den_ngay: '', dot_id: '', noi_xuat_id: '', tuyen_id: '', don_vi_id: '' } };

  // ---------------------------------------------------------------- DOM
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    if (tag === 'input' && attrs && (attrs.type === 'number' || attrs.inputmode === 'decimal' || attrs['data-num'])) bindNum(e);
    return e;
  }
  // ---------------------------------------------------------------- ô nhập số kiểu Việt Nam: 1.234.567,89 (tự ngăn cách hàng nghìn khi gõ)
  const VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const rawToVN = (raw) => {
    const s = String(raw ?? '').trim(); if (s === '') return '';
    const neg = s.startsWith('-'); const [i, d] = s.replace(/[^0-9.]/g, '').split('.');
    const g = (i || '').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + (g || (d !== undefined ? '0' : '')) + (d !== undefined ? ',' + d : '');
  };
  const vnToRaw = (txt) => { const s = String(txt ?? '').trim(); if (!s) return ''; const neg = s.startsWith('-'); const r = s.replace(/[^0-9,]/g, '').replace(',', '.'); return r === '' && !neg ? '' : (neg ? '-' : '') + r; };
  function bindNum(inp) {
    if (inp._numBound) return; inp._numBound = true;
    if (inp.type === 'number') inp.type = 'text';
    inp.setAttribute('inputmode', 'decimal'); inp.style.textAlign = 'right';
    const initial = VALUE.get.call(inp);
    Object.defineProperty(inp, 'value', { configurable: true,
      get() { return vnToRaw(VALUE.get.call(inp)); },
      set(v) { VALUE.set.call(inp, v === null || v === undefined ? '' : rawToVN(v)); } });
    VALUE.set.call(inp, rawToVN(initial));
    inp.addEventListener('input', () => {
      const t = VALUE.get.call(inp); const pos = inp.selectionStart ?? t.length;
      const digitsBefore = t.slice(0, pos).replace(/[^0-9,]/g, '').length;
      let clean = t.replace(/[^0-9,\-]/g, ''); const k = clean.indexOf(','); if (k >= 0) clean = clean.slice(0, k + 1) + clean.slice(k + 1).replace(/,/g, '');
      const neg = clean.startsWith('-'); clean = clean.replace(/-/g, '');
      const [i, d] = clean.split(','); const g = (i || '').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      const out = (neg ? '-' : '') + g + (d !== undefined ? ',' + d : '');
      VALUE.set.call(inp, out);
      let n = 0, c = 0; for (; c < out.length && n < digitsBefore; c++) if (/[0-9,]/.test(out[c])) n++;
      try { inp.setSelectionRange(c, c); } catch (e) { /* bỏ qua */ }
    });
  }
  const clear = (e) => { while (e.firstChild) e.removeChild(e.firstChild); return e; };

  // ---------------------------------------------------------------- định dạng
  // Định dạng số: một bản chuẩn dùng chung HAK_ACCOUNTING_REPORT_STANDARD (vendor/hak-report-standard) — số âm làm tròn về 0 hiển thị "0", không "-0".
  const R = window.HAKReport;
  const blank = (v) => v === null || v === undefined || v === '' || !Number.isFinite(Number(v));
  const num = (v, d, max) => (blank(v) ? '' : R.formatNumber(Number(v), { minDecimals: d, maxDecimals: max === undefined ? d : max }));
  const fmt = {
    int: (v) => num(v, 0),
    money: (v) => num(v, 0),
    money2: (v) => num(v, 2),
    kg: (v) => num(v, 0),
    kgDecimal: (v) => num(v, 0, 3),
    tan: (v) => num(v, 3),
    pct: (v) => (blank(v) ? '' : num(v, 0, 2) + '%'),
    date: (v) => (v ? `${String(v).slice(8, 10)}/${String(v).slice(5, 7)}/${String(v).slice(0, 4)}` : ''),
    dt: (v) => (v ? `${String(v).slice(8, 10)}/${String(v).slice(5, 7)}/${String(v).slice(0, 4)} ${String(v).slice(11, 16)}` : ''),
    dts: (v) => (v ? `${String(v).slice(8, 10)}/${String(v).slice(5, 7)}/${String(v).slice(0, 4)} ${String(v).slice(11, 19)}` : ''),
    min: (v) => {
      if (v === null || v === undefined) return '';
      const a = Math.abs(Math.round(v)); const hh = Math.floor(a / 60); const mm = a % 60;
      return `${v < 0 ? '−' : ''}${hh ? hh + 'g ' : ''}${mm}p`;
    },
  };

  const STATUS_TAG = {
    OK: ['green', 'Đã tính giá'], CHUA_TINH: ['gray', 'Chưa tính'], NO_PRICE: ['red', 'Chưa có đơn giá'], MULTIPLE_PRICE: ['red', 'Xung đột bảng giá'],
    UNKNOWN_VEHICLE: ['red', 'Xe chưa xác định'], UNKNOWN_CARRIER: ['red', 'Chưa có đơn vị VC'], AMBIGUOUS_VEHICLE: ['red', 'Xe thuộc >1 đơn vị'],
    UNKNOWN_LOCATION: ['red', 'Nơi xuất/tuyến chưa rõ'], INVALID_WEIGHT: ['red', 'KL không hợp lệ'], INVALID_TIME: ['red', 'Thời gian lỗi'], NO_VAT_RATE: ['red', 'Thiếu VAT'],
    LOCKED: ['purple', 'Đã chốt'], ACTIVE: ['green', 'Đang dùng'], INACTIVE: ['gray', 'Ngừng'], NHAP: ['amber', 'Nháp'], MO: ['green', 'Đang mở'], KHOA: ['purple', 'Đã khóa'],
    NEW: ['green', 'Mới'], EXACT_DUPLICATE: ['gray', 'Trùng hoàn toàn'], KEY_CONFLICT: ['amber', 'Trùng khóa – khác dữ liệu'], IN_FILE_DUPLICATE: ['gray', 'Trùng trong file'], ERROR: ['red', 'Lỗi'],
    CHUA_DOI_CHIEU: ['gray', 'Chưa đối chiếu'], KHOP: ['green', 'Khớp'], LECH: ['red', 'Lệch'],
    MOI: ['red', 'Mới'], DANG_XU_LY: ['amber', 'Đang xử lý'], DA_XU_LY: ['green', 'Đã xử lý'], BO_QUA: ['gray', 'Bỏ qua'],
    CAO: ['red', 'Cao'], TRUNG_BINH: ['amber', 'Trung bình'], THAP: ['gray', 'Thấp'], DA_DUYET: ['green', 'Đã duyệt'], HUY: ['gray', 'Hủy'],
    NHA_MAY: ['blue', 'Nhà máy'], CANG: ['blue', 'Cảng'], KHO: ['blue', 'Kho'], KHAC: ['gray', 'Khác'],
    CO_DINH: ['gray', 'Cố định'], DIEU_CHINH_DAU: ['amber', 'Điều chỉnh theo dầu'], DONG_TAN: ['gray', 'đ/tấn'], DONG_CHUYEN: ['gray', 'đ/chuyến'],
  };
  const tag = (code, label) => { const [c, t] = STATUS_TAG[code] || ['gray', code]; return h('span', { class: `tag ${c}` }, label || t); };

  // ---------------------------------------------------------------- API
  async function api(channel, args) {
    let r;
    if (window.vcApi) r = await window.vcApi.invoke(channel, args || {});
    else {
      const res = await fetch(`/api/${channel}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) });
      r = await res.json();
    }
    if (!r.ok) { if (r.type === 'AuthRequired' && channel !== 'auth.login') showLogin(r.error); const e = new Error(r.error || 'Lỗi không xác định'); e.type = r.type; throw e; }
    return r.data;
  }
  /** Gọi API, lỗi → toast, trả null. */
  /** Như call(), nhưng nếu máy chủ trả "cần xác nhận" (ConfirmRequired) thì hỏi người dùng rồi gọi lại với xac_nhan=true. */
  async function callConfirm(channel, args, okMsg, title = 'Cần xác nhận') {
    try { const d = await api(channel, args); if (okMsg) toast(okMsg); return d; }
    catch (e) {
      if (e.type !== 'ConfirmRequired') { toast(e.message, true); return null; }
      if (!(await confirmBox(title, e.message, 'Vẫn tiếp tục'))) return null;
      try { const d = await api(channel, { ...(args || {}), xac_nhan: true }); if (okMsg) toast(okMsg); return d; } catch (e2) { toast(e2.message, true); return null; }
    }
  }
  async function call(channel, args, okMsg) {
    try { const d = await api(channel, args); if (okMsg) toast(okMsg); return d; } catch (e) { toast(e.message, true); return null; }
  }

  /** Chọn file: Electron → đường dẫn; trình duyệt (dev/test) → base64. Trả {filePath} | {base64,fileName} | null */
  function pickFile(accept = '.xlsx,.xls,.csv') {
    if (window.vcApi && window.vcApi.isElectron) return window.vcApi.openFile({}).then((p) => (p ? { filePath: p } : null));
    return new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
      inp.addEventListener('cancel', () => { inp.remove(); resolve(null); });
      inp.addEventListener('change', () => {
        const f = inp.files[0]; inp.remove(); if (!f) return resolve(null);
        const rd = new FileReader();
        rd.onload = () => resolve({ base64: String(rd.result).split(',')[1], fileName: f.name });
        rd.onerror = () => { toast('Không đọc được file đã chọn', true); resolve(null); };
        rd.readAsDataURL(f);
      });
      document.body.append(inp); inp.click();
    });
  }

  async function saveExport(r) {
    if (!r) return;
    if (r.path && window.vcApi) {
      const dst = await window.vcApi.saveExport({ path: r.path, fileName: r.fileName });
      if (dst) { toast(`Đã lưu: ${dst}`); window.vcApi.showItem(dst); } else toast(`Đã xuất vào: ${r.path}`);
    } else if (r.base64) {
      const mime = /\.pdf$/i.test(r.fileName) ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const a = h('a', { href: `data:${mime};base64,${r.base64}`, download: r.fileName });
      document.body.append(a); a.click(); a.remove(); toast(`Đã xuất ${r.fileName}`);
    } else if (r.path) toast(`Đã xuất: ${r.path}`);
  }
  async function exportXlsx(channel, args) { const r = await call(channel, args); if (r) await saveExport(r); }

  // ---------------------------------------------------------------- toast & modal
  function toast(msg, err = false) {
    const t = h('div', { class: 'toast' + (err ? ' err' : '') }, msg);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), err ? 7000 : 3500);
  }
  const modalStack = [];
  /** Modal: chỉ đóng khi bấm đúng lớp nền (e.target === overlay) hoặc nút Đóng. */
  function modal({ title, body, actions = [], wide = false, onClose = null }) {
    const close = () => {
      const idx = modalStack.indexOf(close);
      if (idx >= 0) modalStack.splice(idx, 1);
      ov.remove();
      if (onClose) onClose();
    };
    modalStack.push(close);
    const box = h('div', { class: 'modal' + (wide ? ' wide' : '') }, h('h2', {}, title), body,
      h('div', { class: 'actions' }, actions.map((a) => h('button', {
        class: 'btn ' + (a.cls || (a.primary === false ? 'ghost' : '')), disabled: a.disabled,
        onclick: async (e) => {
          const btn = e.currentTarget; if (btn.dataset.busy) return;            // bấm lặp: bỏ qua lần bấm khi thao tác trước chưa xong
          btn.dataset.busy = '1'; btn.disabled = true; btn.classList.add('busy');
          try { const keep = a.onClick ? await a.onClick(close) : undefined; if (!a.keepOpen && keep !== false) close(); }
          finally { delete btn.dataset.busy; btn.disabled = !!a.disabled; btn.classList.remove('busy'); }
        },
      }, a.label))));
    const ov = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === ov) ov._down = true; }, onmouseup: (e) => { if (e.target === ov && ov._down) close(); ov._down = false; } }, box);
    document.body.append(ov);
    return { close, box };
  }
  const confirmBox = (title, text, okLabel = 'Đồng ý', cls = '') => new Promise((res) => {
    modal({ title, body: h('p', {}, text), actions: [{ label: 'Hủy', primary: false, onClick: () => res(false) }, { label: okLabel, cls, onClick: () => res(true) }], onClose: () => res(false) });
  });
  const promptBox = (title, label, dflt = '') => new Promise((res) => {
    const inp = h('input', { value: dflt, style: { width: '100%' } });
    modal({ title, body: h('label', { class: 'field' }, label, inp), actions: [{ label: 'Hủy', primary: false, onClick: () => res(null) }, { label: 'Đồng ý', onClick: () => { if (!inp.value.trim()) { toast('Cần nhập nội dung', true); return false; } res(inp.value.trim()); } }], onClose: () => res(null) });
    setTimeout(() => inp.focus(), 30);
  });

  // ---------------------------------------------------------------- bảng
  /**
   * table({columns:[{key,label,fmt,cls,render,sort}], rows, totals, onRow, rowClass, sort:{key,dir}, onSort})
   * fmt: 'money'|'int'|'kg'|'tan'|'date'|'dt'|'pct'|'min' | function
   */
  function table({ columns, rows, totals = null, totalLabelColumn = columns[0]?.key, onRow = null, rowClass = null, sort = null, onSort = null, empty = 'Không có dữ liệu', wrapClass = '' }) {
    const num = (c) => ['money', 'money2', 'int', 'kg', 'tan', 'min', 'pct'].includes(c.fmt) || c.num;
    const dat = (c) => ['date', 'dt', 'dts'].includes(c.fmt) || c.date;
    const stCls = (c) => c.sticky ? (c.sticky === 'left' ? 'col-sticky-left-1 ' : c.sticky === 'left-2' ? 'col-sticky-left-2 ' : 'col-sticky-right ') : '';
    const thead = h('thead', {}, h('tr', {}, columns.map((c) => h('th', {
      class: stCls(c) + (num(c) ? 'r ' : dat(c) ? 'c ' : '') + (c.sort && onSort ? 'sortable ' : '') + (c.cls || ''),
      onclick: c.sort && onSort ? () => onSort(c.sort === true ? c.key : c.sort) : null,
    }, c.label, sort && (sort.key === (c.sort === true ? c.key : c.sort)) ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''))));
    const cell = (c, r) => {
      if (c.render) { const v = c.render(r); return h('td', { class: stCls(c) + (num(c) ? 'num ' : dat(c) ? 'ctr ' : '') + (c.cls || '') }, v); }
      let v = r[c.key];
      if (typeof c.fmt === 'function') v = c.fmt(v, r); else if (c.fmt && fmt[c.fmt]) v = fmt[c.fmt](v);
      if (c.tag) return h('td', { class: stCls(c) }, v === null || v === undefined || v === '' ? '' : tag(r[c.key]));
      return h('td', { class: stCls(c) + (num(c) ? 'num ' : dat(c) ? 'ctr ' : '') + (c.mono ? 'mono ' : '') + (c.cls || '') }, v === null || v === undefined ? '' : v);
    };
    const tbody = h('tbody', {}, rows.length ? rows.map((r) => h('tr', { class: rowClass ? rowClass(r) : '', onclick: onRow ? () => onRow(r) : null, style: onRow ? { cursor: 'pointer' } : null }, columns.map((c) => cell(c, r))))
      : h('tr', {}, h('td', { colspan: columns.length, class: 'empty' }, empty)));
    const tfoot = totals ? h('tfoot', {}, h('tr', {}, columns.map((c) => {
      const v = totals[c.key]; let t = '';
      if (v !== undefined && v !== null) t = typeof c.fmt === 'function' ? c.fmt(v, totals) : (c.fmt && fmt[c.fmt] ? fmt[c.fmt](v) : v);
      return h('td', { class: stCls(c) + (num(c) ? 'num' : dat(c) ? 'ctr' : '') }, c.key === totalLabelColumn && (v === undefined || v === null) ? 'Tổng cộng' : t);
    }))) : null;
    return h('div', { class: 'tbl-wrap ' + wrapClass }, h('table', { class: 't' }, thead, tbody, tfoot));
  }

  // ---------------------------------------------------------------- filter dùng chung

  // ---------------------------------------------------------------- điều hướng
  // Menu theo LUỒNG CÔNG VIỆC: nhập & kiểm tra → giá & tính cước → đối chiếu & chốt kỳ → bảng kê & báo cáo
  // ---------------------------------------------------------------- giao diện sáng / tối / theo hệ thống (lưu trên máy)
  const THEME_KEY = 'vc.theme', THEMES = { auto: '🌓 Theo hệ thống', light: '☀ Sáng', dark: '🌙 Tối' };
  const themePref = () => { try { const v = localStorage.getItem(THEME_KEY); return THEMES[v] ? v : 'auto'; } catch (e) { return 'auto'; } };
  const prefersDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  function applyTheme() { document.documentElement.setAttribute('data-theme', themePref() === 'dark' || (themePref() === 'auto' && prefersDark()) ? 'dark' : 'light'); }
  function cycleTheme() { const order = ['auto', 'light', 'dark']; const next = order[(order.indexOf(themePref()) + 1) % 3]; try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* không lưu được: vẫn đổi cho phiên này */ document.documentElement.setAttribute('data-theme', next === 'dark' ? 'dark' : 'light'); } applyTheme(); renderNav(); }
  applyTheme();
  if (window.matchMedia) { try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themePref() === 'auto') applyTheme(); }); } catch (e) { /* trình duyệt cũ */ } }

  // ---------------------------------------------------------------- phân quyền (tùy chọn)
  // Tắt (mặc định): 1 người dùng, không đăng nhập. Bật: đăng nhập + quyền theo vai trò (máy chủ là nơi quyết định; giao diện chỉ ẩn mục không dùng được).
  let auth = { enabled: false, user: null, perms: [], roles: {} };
  const PERMS = ['xem', 'nhap', 'duyet', 'admin'];
  window.__canWarnings = [];
  /** can() chỉ nhận TÊN QUYỀN. Chuỗi lạ (vd tên kênh API) → cảnh báo + trả false, để lỗi truyền sai lộ ra thay vì ẩn nút âm thầm. */
  const can = (perm) => {
    if (!PERMS.includes(perm)) { const m = `App.can("${perm}"): chỉ nhận ${PERMS.join('|')}`; console.warn(m); window.__canWarnings.push(m); return false; }
    return !auth.enabled || auth.perms.includes(perm);
  };
  /** Quyền bảng giá/giá dầu cao hơn các bảng khác (máy chủ khai báo, giao diện chỉ đọc). */
  const canWrite = (table) => can((auth.tablePerm && Object.hasOwn(auth.tablePerm, table) && auth.tablePerm[table]) || 'nhap');
  const NAV_NEED = { import: 'nhap', review: 'duyet', settings: 'admin' };
  /** Phím tắt và điều hướng phải tôn trọng cùng bảng NAV_NEED như menu (máy chủ vẫn kiểm tra khi gọi API). */
  const navAllowed = (id) => !NAV_NEED[id] || can(NAV_NEED[id]);
  /**
   * Bảng NÚT → KÊNH API dùng chung. Mức quyền lấy từ máy chủ (auth.channelPerm = permissions.js), không khai lại ở đây.
   * Nút có data-act trong bảng này bị ẩn khi vai trò không đủ quyền; máy chủ vẫn kiểm tra khi gọi.
   */
  const ACTION_CHANNEL = {
    'approve-selected': 'tickets.approve', 'approve-filtered': 'tickets.approve', 'del-selected': 'tickets.remove', 'del-filtered': 'tickets.remove',
    commit: 'import.commit', preview: 'import.preview', 'bulk-update': 'import.resolveMany', 'bulk-keep': 'import.resolveMany', 'bulk-ignore': 'import.resolveMany',
    'undo': 'import.undo', 'undo-batch': 'import.undo', 'lock-create': 'lock.create', 'lock-unlock': 'lock.unlock',
    newversion: 'price.createVersion', apply: 'price.applySheet', delprice: 'price.remove', newperiod: 'price.createFuelPeriod', delperiod: 'price.removeFuelPeriod',
    importfuel: 'fuel.importCommit', delfuel: 'catalog.remove', addfuel: 'catalog.create', recalc: 'cost.recalc', backup: 'backup.now', 'export-backup': 'backup.export', 'restore-backup': 'backup.restore',
    run: 'recon.run', 'alert-set': 'alerts.setStatus', 'tpl-tickets': 'template.tickets', 'tpl-vehicles': 'template.vehicles',
    seed: 'seed.loadSample', initial: 'initial.load', 'add-user': 'auth.createUser', 'disable-auth': 'auth.disable', 'save-rounding': 'settings.set', 'save-kl': 'settings.set',
    'save-duyet': 'settings.set', 'save-ngay-can-cu': 'settings.set', 'save-company': 'settings.set', 'save-backup': 'settings.set',
  };
  const RANK = Object.fromEntries(PERMS.map((p, i) => [p, i]));
  /** Nút gọi catalog.* có thể khai data-table: quyền theo bảng (auth.tablePerm, vd gia_dau = duyet) được ưu tiên nếu cao hơn quyền kênh. */
  const actionAllowed = (act, table = null) => {
    if (!auth.enabled) return true; const ch = ACTION_CHANNEL[act]; if (!ch) return true;
    let need = (auth.channelPerm || {})[ch];
    const tp = table && auth.tablePerm && Object.hasOwn(auth.tablePerm, table) ? auth.tablePerm[table] : null;
    if (tp && (!need || RANK[tp] > RANK[need])) need = tp;
    return !need || can(need);
  };
  const elAllowed = (el) => actionAllowed(el.getAttribute('data-act'), el.getAttribute('data-table'));
  /** Ẩn mọi nút ghi dữ liệu mà vai trò hiện tại không đủ quyền (gọi lại mỗi khi DOM đổi). */
  function applyPerms(root = document) {
    if (!auth.enabled) return;
    root.querySelectorAll('[data-act]').forEach((el) => { if (!elAllowed(el)) { el.hidden = true; el.style.display = 'none'; el.setAttribute('aria-hidden', 'true'); } });
  }
  new MutationObserver((muts) => { if (!auth.enabled) return; for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.hasAttribute('data-act') && !elAllowed(n)) { n.hidden = true; n.style.display = 'none'; } applyPerms(n); } })
    .observe(document.documentElement, { childList: true, subtree: true });
  async function refreshAuth() { try { auth = await api('auth.status'); } catch (e) { /* bỏ qua */ } return auth; }
  let loginOpen = false;
  function showLogin(msg) {
    if (loginOpen) return; loginOpen = true;
    const user = h('input', { name: 'ten', autocomplete: 'username', placeholder: 'Tên đăng nhập' }), pw = h('input', { name: 'mk', type: 'password', autocomplete: 'current-password', placeholder: 'Mật khẩu' });
    const err = h('p', { class: 'tag red', style: { display: msg ? '' : 'none' } }, msg || '');
    const submit = async () => {
      try { auth = await api('auth.login', { ten_dang_nhap: user.value.trim(), mat_khau: pw.value }); ov.remove(); loginOpen = false; await refreshInfo(); go(current || 'dashboard'); }
      catch (e) { err.textContent = e.message; err.style.display = ''; pw.value = ''; pw.focus(); }
    };
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const ov = h('div', { class: 'overlay login', 'data-login': '1' }, h('div', { class: 'modal' }, h('h2', {}, 'Đăng nhập VC Cost'),
      h('p', { class: 'muted' }, 'Phân quyền đang bật. Nhập tài khoản được cấp.'), err, h('label', { class: 'field' }, 'Tên đăng nhập', user), h('label', { class: 'field' }, 'Mật khẩu', pw),
      h('div', { class: 'actions' }, h('button', { class: 'btn', 'data-act': 'login', onclick: submit }, 'Đăng nhập'))));
    document.body.append(ov); user.focus();
  }
  async function logout() { try { await api('auth.logout'); } catch (e) { /* bỏ qua */ } await refreshAuth(); clear(document.getElementById('view')); showLogin(); renderNav(); }

  const NAV = [
    ['TỔNG QUAN', [['dashboard', '📊', 'Dashboard · việc cần làm']]],
    ['① NHẬP & KIỂM TRA', [['import', '📥', 'Import phiếu cân'], ['review', '🔍', 'Cần kiểm tra', 'pending'], ['tickets', '🧾', 'Phiếu cân', 'duyet'], ['vehicle', '🚛', 'Chi tiết theo xe']]],
    ['② GIÁ & TÍNH CƯỚC', [['prices', '💲', 'Bảng giá'], ['fuel', '⛽', 'Giá dầu'], ['pricecalc', '🧮', 'Bảng tính đơn giá']]],
    ['③ ĐỐI CHIẾU & CHỐT KỲ', [['reconcile', '⚖️', 'Đối chiếu'], ['lock', '🔒', 'Chốt kỳ']]],
    ['④ BẢNG KÊ & BÁO CÁO', [['statements', '📄', 'Bảng kê thanh toán'], ['forms', '🖨', 'Biểu mẫu in ký 2 bên'], ['rp:vehicle', '📋', 'Theo xe'], ['rp:carrier', '📋', 'Theo đơn vị'], ['rp:origin', '📋', 'Theo nơi xuất'], ['rp:date', '📋', 'Theo thời gian'], ['rp:dot', '📋', 'Theo tàu']]],
    ['DANH MỤC', [['cat:xe', '🚛', 'Xe'], ['cat:don_vi_van_chuyen', '🏢', 'Đơn vị vận chuyển'], ['cat:hop_dong', '📑', 'Hợp đồng vận chuyển'], ['cat:dia_diem', '📍', 'Địa điểm'], ['cat:tuyen_van_chuyen', '🛣', 'Tuyến'], ['cat:dot_van_chuyen', '🚢', 'Đợt / Tàu']]],
    ['HỆ THỐNG', [['alerts', '🔔', 'Trung tâm cảnh báo', 'alerts'], ['batches', '🕘', 'Lịch sử import'], ['audit', '📜', 'Audit log'], ['backup', '💾', 'Backup'], ['users', '👥', 'Người dùng & phân quyền'], ['settings', '⚙️', 'Cài đặt']]],
  ];
  function renderNav() {
    const sb = clear(document.getElementById('sidebar'));
    sb.append(h('div', { class: 'brand' }, h('i', {}, '🚚'), h('div', {}, h('b', {}, 'VC Cost'), h('small', {}, 'Chi phí vận chuyển · Offline'))));
    for (const [group, items] of NAV) {
      sb.append(h('div', { class: 'nav-group' }, group));
      for (const [id, ic, label, bk] of items) {
        if (NAV_NEED[id] && !can(NAV_NEED[id])) continue;
        const n = bk && info ? (bk === 'pending' ? info.pendingReviews : bk === 'duyet' ? info.choDuyet : info.alertsOpen) : 0;
        const tip = id === 'import' ? ' (Alt+I)' : id === 'review' ? ' (Alt+D)' : id === 'statements' ? ' (Alt+B)' : '';
        sb.append(h('div', { class: 'nav-item' + (current === id ? ' active' : ''), 'data-nav': id, title: label + tip, onclick: () => go(id) },
          h('span', { class: 'ic' }, ic), label, n ? h('span', { class: 'badge' + (bk === 'alerts' ? ' red' : '') }, n) : null));
      }
    }
    sb.append(h('button', { class: 'theme-toggle', 'data-act': 'theme', title: 'Đổi giao diện: theo hệ thống → sáng → tối', onclick: cycleTheme }, 'Giao diện: ' + THEMES[themePref()]));
    if (auth.enabled && auth.user) sb.append(h('div', { class: 'user-chip', 'data-user': auth.user.ten_dang_nhap }, h('b', {}, auth.user.ho_ten), h('small', {}, auth.roles[auth.user.vai_tro] || auth.user.vai_tro), h('button', { class: 'btn ghost sm', 'data-act': 'logout', onclick: logout }, 'Đăng xuất')));
    sb.append(h('div', { class: 'foot' }, info ? `v${info.version} · ${info.counts.phieu} phiếu · ${info.counts.xe} xe` : ''));
  }
  async function refreshInfo() { try { info = await api('app.info'); } catch (e) { /* bỏ qua */ } renderNav(); }

  function register(id, def) { views[id] = def; }
  function resolve(id) {
    if (views[id]) return [views[id], {}];
    const [kind, arg] = id.split(':');
    if (views[kind]) return [views[kind], { arg }];
    return [null, {}];
  }
  // Các lần đổi lọc cùng màn dựng riêng, chỉ kết quả mới nhất được gắn vào trang.
  function latestRender(target, render) {
    let sequence = 0;
    return async () => {
      const request = ++sequence;
      const host = h('div');
      clear(target).append(h('div', { class: 'empty' }, 'Đang tải…'));
      await render(host);
      if (request === sequence) clear(target).append(host);
    };
  }
  let navSeq = 0;
  async function go(id, params = {}) {
    current = id; renderNav();
    const seq = ++navSeq;                     // mỗi lần chuyển màn là một "phiên": phản hồi về chậm của màn cũ không được ghi đè màn mới
    const [v, p] = resolve(id);
    const view = clear(document.getElementById('view'));
    if (!v) { view.append(h('div', { class: 'empty' }, `Chưa có màn hình "${id}"`)); return; }
    view.append(h('div', { class: 'empty' }, 'Đang tải…'));
    const host = h('div', { class: 'view-host' });      // màn dựng trong host riêng; chỉ gắn vào trang nếu vẫn là phiên mới nhất
    let failed = null;
    try { await v.render(host, { ...p, ...params }); } catch (e) { failed = e; }
    if (seq !== navSeq) return;                 // đã chuyển sang màn khác: bỏ kết quả này
    clear(view);
    if (failed) view.append(h('div', { class: 'card' }, h('h3', {}, 'Lỗi hiển thị'), h('pre', { class: 'json' }, failed.stack || failed.message)));
    else view.append(host);                      // host vẫn là vùng chứa của màn (màn có thể vẽ tiếp vào đó sau khi tương tác)
    document.getElementById('main').scrollTop = 0;
    refreshInfo();
  }
  const reload = () => go(current);
  const pageHead = (title, subtitle, ...actions) => h('div', { class: 'row', style: { marginBottom: '12px' } }, h('div', { class: 'grow' }, h('h1', {}, title), subtitle ? h('p', { class: 'sub', style: { margin: 0 } }, subtitle) : null), ...actions);

  async function start() { await refreshAuth(); if (auth.enabled && !auth.user) { renderNav(); showLogin(); return; } await refreshInfo(); await go('dashboard'); }

  // ---------------------------------------------------------------- phím tắt toàn cục
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const popovers = document.querySelectorAll('.fpop, .sfd-mask');
      if (popovers.length) {
        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        return;
      }
      if (modalStack.length) {
        e.preventDefault();
        const top = modalStack[modalStack.length - 1];
        top();
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      const q = document.querySelector('[data-sf-q] input, input.search, .sf input[type="text"]');
      if (q) {
        e.preventDefault();
        q.focus();
        if (typeof q.select === 'function') q.select();
      }
    }
    if (e.altKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      if (navAllowed('review')) go('review');
    }
    if (e.altKey && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      if (navAllowed('import')) go('import');
    }
    if (e.altKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      if (navAllowed('statements')) go('statements');
    }
  });

  return { h, clear, bindNum, fmt, tag, api, call, callConfirm, pickFile, canWrite, applyPerms, actionAllowed, saveExport, exportXlsx, toast, modal, confirmBox, promptBox, table, register, latestRender, viewId: () => current, go, reload, start, refreshInfo, refreshAuth, can, get auth() { return auth; }, logout, state, pageHead, STATUS_TAG, get info() { return info; } };
})();
