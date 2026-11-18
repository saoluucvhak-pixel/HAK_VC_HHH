'use strict';
/**
 * Thanh lọc thông minh dùng chung (HAK Smart Filter) cho mọi màn hình — thay thanh lọc cũ.
 *  - Lọc nhanh: tìm không dấu · kỳ + từ/đến ngày (dd/mm/yyyy) · chọn NHIỀU đơn vị / đợt-tàu
 *  - Bộ lọc nâng cao (ngăn kéo): thêm nơi xuất, tuyến, trạng thái tính giá, bộ lọc đã lưu theo màn hình
 *  - Chip điều kiện đang áp dụng (bấm × để bỏ) + dòng "Hiển thị x / y dòng · Phạm vi: …" (cùng chuỗi phạm vi in trên Excel/PDF)
 * Trạng thái bộ lọc dùng chung toàn app nằm ở App.state.filter (mảng id cho các trường chọn nhiều).
 */
(() => {
  const { h, api, toast } = App;
  const SF = window.HAKCore.sf;

  const DEFS = {
    don_vi_id: { label: 'Đơn vị vận chuyển', table: 'don_vi_van_chuyen', quick: true },
    dot_id: { label: 'Đợt / Tàu', table: 'dot_van_chuyen', quick: true },
    noi_xuat_id: { label: 'Nơi xuất', table: 'dia_diem' },
    tuyen_id: { label: 'Tuyến', table: 'tuyen_van_chuyen' },
  };
  const PRICE_STATES = [
    { value: 'DA_TINH', label: 'Đã tính giá' }, { value: 'CHUA_TINH', label: 'Chưa tính giá (mọi lý do)' },
    { value: 'NO_PRICE', label: 'Thiếu bảng giá' }, { value: 'MULTIPLE_PRICE', label: 'Trùng bảng giá' },
    { value: 'UNKNOWN_VEHICLE', label: 'Xe chưa có trong danh mục' }, { value: 'UNKNOWN_CARRIER', label: 'Xe chưa gán đơn vị' },
    { value: 'UNKNOWN_LOCATION', label: 'Chưa nhận ra nơi xuất' }, { value: 'INVALID_WEIGHT', label: 'Khối lượng không hợp lệ' },
    { value: 'OK', label: 'Tính giá OK' }, { value: 'LOCKED', label: 'Đã chốt kỳ' },
  ];
  const DUYET_STATES = [{ value: 'NHAP', label: 'Nháp (chờ duyệt)' }, { value: 'DA_DUYET', label: 'Đã duyệt' }];
  const LIST_KEYS = Object.keys(DEFS);
  const list = (v) => (Array.isArray(v) ? v : v === '' || v == null ? [] : [v]).map(String);

  // ---- trạng thái chung ↔ trạng thái của Smart Filter
  const toSF = (flt) => ({
    q: flt.search || '', tu: flt.tu_ngay || '', den: flt.den_ngay || '', ky: flt.ky || '',
    sel: Object.fromEntries(LIST_KEYS.map((k) => [k, list(flt[k])]).filter(([, v]) => v.length)),
    one: flt.trang_thai ? { trang_thai: flt.trang_thai } : {}, flag: {},
  });
  const fromSF = (flt, s) => {
    flt.search = s.q || ''; flt.tu_ngay = s.tu || ''; flt.den_ngay = s.den || ''; flt.ky = s.ky || '';
    LIST_KEYS.forEach((k) => { flt[k] = s.sel[k] || []; });
    flt.trang_thai = (s.one && s.one.trang_thai) || '';
  };

  /** Bộ lọc gửi lên backend: bỏ giá trị rỗng, mảng id → số, trạng thái tính giá → cờ tương ứng. */
  const cleanFilter = (f) => {
    const out = {};
    for (const [k, v] of Object.entries(f)) {
      if (k === 'ky') continue;
      if (k === 'trang_thai') {
        if (v === 'NHAP' || v === 'DA_DUYET') { if (App.info && App.info.duyetBat) out.trang_thai_duyet = v; }   // duyệt đã tắt: bỏ bộ lọc Nháp còn lưu, tránh danh sách trống không rõ lý do
        else if (v === 'DA_TINH') out.da_tinh_gia = true; else if (v === 'CHUA_TINH') out.chua_tinh_gia = true; else if (v) out.trang_thai_tinh_gia = v;
        continue;
      }
      if (Array.isArray(v)) { if (v.length) out[k] = v.map(Number); } else if (v !== '' && v !== null && v !== undefined) out[k] = v;
    }
    return out;
  };
  /** Đúng một id được chọn → id đó (chuỗi); nhiều hoặc không chọn → ''. Dùng cho màn hình chỉ làm việc với MỘT đơn vị/đợt (bảng kê, biểu mẫu). */
  const one = (v) => { const a = list(v); return a.length === 1 ? a[0] : ''; };

  // ---- bộ chuyển đổi cho giao diện Smart Filter (h, btn, ô ngày dd/mm/yyyy, hỏi tên, lưu trên máy)
  const btn = (label, cls, onclick, title) => h('button', { type: 'button', class: 'btn ' + (cls === 'pri' ? 'pri' : 'ghost'), title: title || null, onclick }, label);
  const dateField = (value, attrs) => {
    const i = h('input', Object.assign({ type: 'text', inputmode: 'numeric', placeholder: 'dd/mm/yyyy', maxlength: '10', value: SF.fmtVN(value), class: 'sf-date' }, attrs || {}));
    i.addEventListener('input', () => {   // gõ số → tự chèn dấu "/"
      const d = i.value.replace(/\D/g, '').slice(0, 8);
      i.value = d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
    });
    return i;
  };
  const dateIso = (el) => { const v = el.value.trim(); if (!v) return ''; return SF.parseVN(v); };   // '' = trống; null = không hợp lệ
  const askText = (title, label, opts, cb) => { App.promptBox(title, label).then((v) => { if (v) cb(v); }); };
  const storage = () => { try { return window.localStorage; } catch (e) { return null; } };
  const UI = window.HAKUI.smartFilter.create({ h, btn, dateField, dateIso, askText, toast, storage });

  // Danh mục đọc mới mỗi lần dựng thanh lọc (rẻ — dữ liệu cục bộ) để luôn thấy đơn vị/đợt/nơi xuất vừa thêm
  const loadOptions = async () => Object.fromEntries(await Promise.all(LIST_KEYS.map(async (k) =>
    [k, (await api('catalog.options', { table: DEFS[k].table })).map((o) => ({ value: String(o.id), label: o.label }))])));
  const periodLabel = (ky) => `Tháng ${ky.slice(5)}/${ky.slice(0, 4)}`;

  /**
   * App.filterBar(onChange, { fields, filter }) — trả về phần tử thanh lọc.
   * fields: các trường hiện sẵn trên thanh lọc nhanh (mặc định kỳ/ngày + đơn vị + đợt/tàu); mọi trường còn lại nằm ở ngăn "Bộ lọc nâng cao".
   */
  async function filterBar(onChange, { fields = ['tu_ngay', 'den_ngay', 'dot_id', 'don_vi_id'], filter = App.state.filter, screenId = App.viewId() } = {}) {
    const [opts, periods] = await Promise.all([loadOptions(), api('tickets.periods').catch(() => [])]);
    let info = { kept: 0, total: 0 }, tb = null;
    const approvedOnly = screenId !== 'tickets';
    let countRequest = 0;
    const quick = ['q'];
    if (fields.some((f) => f === 'tu_ngay' || f === 'den_ngay' || f === 'period')) quick.push('period');
    LIST_KEYS.forEach((k) => { if (fields.includes(k)) quick.push(k); });
    const fieldCfg = LIST_KEYS.map((k) => ({ key: k, type: 'multi', label: DEFS[k].label, options: () => opts[k], withNone: false, match: () => true }));
    fieldCfg.push({ key: 'trang_thai', type: 'enum', label: 'Trạng thái tính giá', options: () => (App.info && App.info.duyetBat ? [...DUYET_STATES, ...PRICE_STATES] : PRICE_STATES), match: () => true });
    const refreshInfo = async () => {
      const request = ++countRequest;
      try {
        const result = await api('tickets.count', { filter: cleanFilter(filter), approvedOnly });
        if (request !== countRequest) return;
        info = result;
      } catch (e) { /* giữ số cũ */ }
      if (tb) tb.refresh();
    };
    const cfg = {
      screenId, fields: fieldCfg, quickFields: quick, advancedFields: ['q', 'period', ...LIST_KEYS, 'trang_thai'],
      searchPlaceholder: '🔍 Tìm số phiếu, biển số, nơi xuất…', qCommit: false,
      periods: () => periods.map((p) => ({ value: p.ky, label: periodLabel(p.ky) })), periodNoneLabel: 'Kỳ: tất cả',
      state: { get: () => toSF(filter), set: (s) => fromSF(filter, s) },
      onApply: () => { onChange(); refreshInfo(); },
      dataSource: () => info, scopeFallback: () => 'Tất cả (không lọc)',
      labelOf: (k) => (DEFS[k] ? DEFS[k].label : k),
    };
    tb = UI.mount(cfg);
    if (approvedOnly && App.info && App.info.duyetBat) tb.el.append(h('p', { class: 'muted small' }, 'Số liệu báo cáo và chứng từ chỉ gồm phiếu đã duyệt.'));
    refreshInfo();
    tb.el.refreshInfo = refreshInfo;   // màn hình gọi lại sau khi dữ liệu đổi (xóa/import…)
    return tb.el;
  }

  Object.assign(App, { filterBar, cleanFilter, one, filterDefs: DEFS });
})();
