'use strict';
/** Phiếu cân (phân trang phía server) + Chi tiết theo xe (timeline). */
(() => {
  const { h, fmt, api, call, table, tag } = App;
  const FLAG_TXT = { LONG_WEIGH_DURATION: 'Cân quá lâu', SHORT_GAP: 'Hai chuyến sát nhau', REVERSE_WEIGHING: 'Cân ngược', INVALID_TIME: 'Thời gian lỗi', SHORT_WEIGH_DURATION: 'Cân quá nhanh', OVERLAP_PREVIOUS_TRIP: 'Chồng chuyến trước' };

  async function explain(id) {
    const e = await call('tickets.explain', { id });
    if (!e) return;
    const t = e.ticket; const r = e.rule;
    const kv = (k, val) => h('div', { class: 'row gap-s' }, h('span', { class: 'muted', style: { width: '170px' } }, k), h('b', {}, val ?? '—'));
    App.modal({ title: `Vì sao phiếu ${t.so_phieu} có giá này?`, wide: true, actions: [{ label: 'Xóa phiếu này', cls: 'danger', onClick: () => { setTimeout(() => delTickets([t.id], () => { App.refreshInfo(); App.reload(); }), 0); } }, { label: 'Đóng', primary: false }],
      body: h('div', {}, kv('Biển số', t.bien_so), t.tai_xe && kv('Tài xế', t.tai_xe), kv('Khối lượng', `${fmt.kg(t.kl_hang_kg)} kg`), kv('Trạng thái', App.STATUS_TAG[t.trang_thai_tinh_gia] ? App.STATUS_TAG[t.trang_thai_tinh_gia][1] : t.trang_thai_tinh_gia),
        kv('Đơn giá áp dụng', fmt.money(t.don_gia)), kv('Thành tiền trước VAT', fmt.money(t.tien_truoc_vat)), kv('VAT', `${t.ty_le_vat ?? ''}% = ${fmt.money(t.tien_vat)}`), kv('Tổng', fmt.money(t.tong_tien)),
        r ? h('div', { style: { marginTop: '10px' } }, h('h3', {}, 'Bảng giá áp dụng'), kv('Mã bảng giá', r.ma_bang_gia), kv('Hiệu lực', `${fmt.date(r.tu_ngay)} → ${r.den_ngay ? fmt.date(r.den_ngay) : 'nay'}`), kv('Phương thức', r.phuong_thuc),
          kv('Đơn giá gốc / điều chỉnh', `${fmt.money(r.don_gia_goc)} + ${fmt.money(r.don_gia_dieu_chinh)} = ${fmt.money(r.don_gia_ap_dung)}`),
          e.ky ? kv('Kỳ giá dầu', `${e.ky.ma_ky}: bình quân ${fmt.money(e.ky.gia_dau_binh_quan)} đ/lít`) : null,
          r.cong_thuc ? h('pre', { class: 'json' }, JSON.stringify(r.cong_thuc, null, 2)) : null) : h('p', { class: 'muted' }, 'Chưa gắn bảng giá.')) });
  }

  App.explainTicket = explain;

  /** Xóa phiếu (xóa mềm, có lý do + audit). Hiện xem trước: bao nhiêu phiếu xóa được / đã áp giá / bị chặn. */
  async function delTickets(ids, onDone) {
    if (!ids.length) return App.toast('Chưa có phiếu nào', true);
    const pv = await call('tickets.removePreview', { ids }); if (!pv) return;
    if (!pv.xoa_duoc) return App.modal({ title: 'Không có phiếu nào xóa được', actions: [{ label: 'Đóng', primary: false }],
      body: h('p', {}, `${fmt.int(pv.da_chot_ky)} phiếu đã chốt kỳ, ${fmt.int(pv.dot_khoa)} phiếu thuộc đợt đã khóa. Mở khóa kỳ/đợt trước rồi xóa lại.`) });
    const reason = h('input', { style: { width: '100%' }, placeholder: 'Ví dụ: nhập nhầm, phiếu trùng, hủy chuyến…' });
    App.modal({ title: `Xóa ${fmt.int(pv.xoa_duoc)} phiếu cân`, body: h('div', {},
      h('p', {}, `Sẽ xóa ${fmt.int(pv.xoa_duoc)} phiếu`, pv.da_tinh_gia ? `, trong đó ${fmt.int(pv.da_tinh_gia)} phiếu đã áp giá vận chuyển (tiền của các phiếu này sẽ biến khỏi Bảng kê/báo cáo).` : '.'),
      pv.da_chot_ky || pv.dot_khoa ? h('p', { class: 'tag red' }, `Không thể xóa: ${fmt.int(pv.da_chot_ky)} phiếu đã chốt kỳ, ${fmt.int(pv.dot_khoa)} phiếu thuộc đợt đã khóa — hãy bỏ chúng ra khỏi lựa chọn hoặc mở khóa trước.`) : null,
      h('p', { class: 'muted' }, 'Phiếu xóa được ghi vào nhật ký; có thể import lại file gốc nếu cần.'), h('label', { class: 'field' }, 'Lý do xóa', reason)),
    actions: [{ label: 'Hủy', primary: false }, { label: 'Xóa phiếu', cls: 'danger', disabled: !!(pv.da_chot_ky || pv.dot_khoa), onClick: async () => {
      if (!reason.value.trim()) { App.toast('Cần ghi lý do xóa', true); return false; }
      const r = await call('tickets.remove', { ids, reason: reason.value.trim() }, 'Đã xóa phiếu'); if (!r) return false; onDone(r); } }] });
  }

  App.register('tickets', {
    async render(v, params = {}) {
      Object.assign(App.state.filter, Object.fromEntries(Object.entries(params).filter(([k]) => ['tu_ngay', 'den_ngay', 'dot_id', 'noi_xuat_id', 'don_vi_id'].includes(k))));
      // Đi từ Dashboard/báo cáo sang: gán điều kiện vào bộ lọc dùng chung (hiện thành chip, không lọc ngầm)
      if (params.chua_tinh_gia) App.state.filter.trang_thai = params.trang_thai_tinh_gia || 'CHUA_TINH'; else if (params.trang_thai_tinh_gia) App.state.filter.trang_thai = params.trang_thai_tinh_gia;
      const st = { offset: 0, limit: 100, sort: 'ngay_gio_can_1', dir: 'asc' };
      const body = h('div', {}); const sel = new Set(); const vers = {};
      let currentRows = [];
      const selectPage = h('input', { type: 'checkbox', title: 'Chọn cả trang', 'aria-label': 'Chọn cả trang',
        onclick: (e) => e.stopPropagation(),
        onchange: (e) => {
          currentRows.forEach((r) => (e.target.checked ? sel.add(r.id) : sel.delete(r.id)));
          updateSelection();
          load();
        } });
      const ALL_COLS = [
        { key: '_sel', sticky: 'left', fixed: true, label: selectPage,
          render: (r) => h('input', { type: 'checkbox', checked: sel.has(r.id), 'aria-label': `Chọn phiếu ${r.so_phieu}`, onclick: (e) => e.stopPropagation(),
            onchange: (e) => {
              e.target.checked ? sel.add(r.id) : sel.delete(r.id);
              updateSelection();
            } }) },
        { key: 'so_phieu', sticky: 'left-2', fixed: true, label: 'Số phiếu', mono: true, sort: true },
        { key: 'ngay_gio_can_1', label: 'Ngày giờ cân 1', fmt: 'dt', mono: true, sort: true },
        { key: 'bien_so', label: 'Biển số', mono: true, sort: true },
        { key: 'don_vi', label: 'Đơn vị', sort: true },
        { key: 'noi_xuat', label: 'Nơi xuất', sort: true, render: (r) => r.noi_xuat || h('span', { class: 'muted' }, r.noi_xuat_goc || '') },
        { key: 'kl_hang_kg', label: 'KL (kg)', fmt: 'kg', sort: true },
        { key: 'don_gia', label: 'Đơn giá', fmt: 'money', sort: true },
        { key: 'tien_truoc_vat', label: 'Trước VAT', fmt: 'money', sort: true },
        { key: 'tong_tien', label: 'Tổng', fmt: 'money', sort: true },
        { key: 'dot', label: 'Đợt' },
        { key: 'trang_thai_tinh_gia', fixed: true, label: 'Trạng thái', render: (r) => h('span', {}, r.trang_thai_duyet === 'NHAP' ? h('span', { class: 'tag warn', title: 'Phiếu Nháp — chưa vào Dashboard/Bảng kê/báo cáo/chốt kỳ cho tới khi được duyệt' }, 'Nháp') : null, r.trang_thai_duyet === 'NHAP' ? ' ' : '', tag(r.trang_thai_tinh_gia), r.tu_duyet ? ' ' : '', r.tu_duyet ? h('span', { class: 'tag gray', 'data-tu-duyet': '1', title: 'Người nhập/sửa phiếu cũng là người duyệt (đã bật "Cho phép tự duyệt")' }, 'Tự duyệt') : null, r.xe_tra_ve ? ' ' : '', r.xe_tra_ve ? tag('KHAC', 'Trả về') : null) },
      ];
      const getVisibleCols = () => {
        try {
          const raw = localStorage.getItem('vc.tickets.columns');
          if (raw) return new Set(JSON.parse(raw));
        } catch (e) {}
        return new Set(ALL_COLS.map((c) => c.key));
      };
      let visibleCols = getVisibleCols();

      const openColConfig = () => {
        const cbs = {};
        const configBody = h('div', { class: 'grid g2' },
          ALL_COLS.filter((c) => !c.fixed).map((c) => {
            cbs[c.key] = h('input', { type: 'checkbox', checked: visibleCols.has(c.key) });
            return h('label', { class: 'row gap-s', style: { padding: '4px 0', cursor: 'pointer' } }, cbs[c.key], typeof c.label === 'string' ? c.label : c.key);
          }));
        App.modal({
          title: 'Tùy chọn cột hiển thị',
          body: h('div', {}, h('p', { class: 'muted' }, 'Chọn các cột bạn muốn hiển thị trên bảng phiếu cân:'), configBody),
          actions: [
            { label: 'Mặc định', cls: 'ghost', keepOpen: true, onClick: () => {
              ALL_COLS.forEach((c) => { if (cbs[c.key]) cbs[c.key].checked = true; });
            }},
            { label: 'Hủy', primary: false },
            { label: 'Lưu', onClick: () => {
              const next = new Set(ALL_COLS.filter((c) => c.fixed).map((c) => c.key));
              for (const [k, cb] of Object.entries(cbs)) if (cb.checked) next.add(k);
              visibleCols = next;
              try { localStorage.setItem('vc.tickets.columns', JSON.stringify([...next])); } catch (e) {}
              load();
            }},
          ],
        });
      };

      const flt = () => App.cleanFilter(App.state.filter);
      const load = App.latestRender(body, async (body) => {
        const d = await api('tickets.list', { filter: flt(), offset: st.offset, limit: st.limit, sort: st.sort, dir: st.dir });
        currentRows = d.rows;
        updateSelection();
        d.rows.forEach((r) => { vers[r.id] = r.ver; });
        const pages = Math.max(1, Math.ceil(d.total / st.limit)); const page = Math.floor(st.offset / st.limit) + 1;
        const activeCols = ALL_COLS.filter((c) => c.fixed || visibleCols.has(c.key));
        App.clear(body).append(h('div', { class: 'card tickets-table-card' },
          table({
            columns: activeCols, rows: d.rows, sort: { key: st.sort, dir: st.dir }, onSort: (k) => { st.dir = st.sort === k && st.dir === 'asc' ? 'desc' : 'asc'; st.sort = k; st.offset = 0; load(); },
            totalLabelColumn: 'so_phieu', totals: { kl_hang_kg: d.totals.tong_kg, tien_truoc_vat: d.totals.tien_truoc_vat, tong_tien: d.totals.tong_tien }, onRow: (r) => explain(r.id),
            rowClass: (r) => (['OK', 'LOCKED'].includes(r.trang_thai_tinh_gia) ? '' : 'err'), wrapClass: 'tickets-table',
          }),
          h('div', { class: 'pager' }, `${fmt.int(d.total)} phiếu`, h('button', { class: 'btn ghost sm', disabled: page <= 1, onclick: () => { st.offset -= st.limit; load(); } }, '‹'), `Trang ${page}/${pages}`,
            h('button', { class: 'btn ghost sm', disabled: page >= pages, onclick: () => { st.offset += st.limit; load(); } }, '›'))));
      });
      function updateSelection() {
        const selectedOnPage = currentRows.filter((row) => sel.has(row.id)).length;
        selectPage.checked = selectedOnPage > 0 && selectedOnPage === currentRows.length;
        selectPage.indeterminate = selectedOnPage > 0 && !selectPage.checked;
        selectPage.disabled = !currentRows.length;
        selBtn.textContent = sel.size ? `Xóa đã chọn (${fmt.int(sel.size)})` : 'Xóa đã chọn';
        selBtn.disabled = !sel.size;
        apvSel.disabled = !sel.size;
      }
      const reset = () => { st.offset = 0; sel.clear(); updateSelection(); load(); };
      const done = () => { App.refreshInfo(); App.reload(); };
      const selBtn = h('button', { class: 'btn danger', disabled: true, 'data-act': 'del-selected', onclick: () => delTickets([...sel], done) }, 'Xóa đã chọn');
      const allBtn = h('button', { class: 'btn ghost', 'data-act': 'del-filtered', title: 'Xóa mọi phiếu khớp bộ lọc hiện tại (kể cả các trang khác)', onclick: async () => { const ids = await api('tickets.ids', { filter: flt() }); delTickets(ids, done); } }, 'Xóa theo bộ lọc');
      const approve = async (ids, expectedVersions = vers) => {
        if (!ids.length) return App.toast('Không có phiếu Nháp nào để duyệt');
        if (!(await App.confirmBox('Duyệt phiếu Nháp', `Duyệt ${ids.length} phiếu Nháp? Phiếu được duyệt sẽ vào Dashboard, Bảng kê, báo cáo và chốt kỳ.`, 'Duyệt'))) return;
        const r = await App.call('tickets.approve', { ids, vers: Object.fromEntries(ids.filter((i) => expectedVersions[i] != null).map((i) => [i, expectedVersions[i]])) }, `Đã duyệt`);
        if (r && r.failed) App.toast(`Duyệt ${r.ok}/${r.total} phiếu. Không duyệt được ${r.failed}: ${r.results.filter((x) => !x.ok).slice(0, 3).map((x) => `${x.so_phieu || x.id} (${x.reason})`).join('; ')}`, 'warn');
        sel.clear(); await App.refreshInfo(); await App.reload();
      };
      const duyetOn = () => App.info && App.info.duyetBat && App.can('duyet');
      const apvSel = h('button', { class: 'btn', disabled: true, 'data-act': 'approve-selected', onclick: () => approve([...sel]) }, 'Duyệt đã chọn');
      const apvAll = h('button', { class: 'btn ghost', 'data-act': 'approve-filtered', title: 'Duyệt mọi phiếu Nháp khớp bộ lọc hiện tại', onclick: async () => { const data = await api('tickets.list', { filter: { ...flt(), trang_thai_duyet: 'NHAP' }, limit: 10_000_000 }); await approve(data.rows.map((r) => r.id), Object.fromEntries(data.rows.map((r) => [r.id, r.ver]))); } }, 'Duyệt phiếu Nháp theo lọc');
      const heading = h('header', { class: 'tickets-heading' },
        h('div', {}, h('h1', {}, 'Phiếu cân'), h('p', { class: 'sub' }, 'Chọn một dòng để xem cách tính giá.')),
        h('div', { class: 'tickets-actions' },
          h('button', { class: 'btn ghost', 'data-act': 'col-settings', onclick: openColConfig }, 'Cột hiển thị'),
          h('button', { class: 'btn', onclick: () => App.exportXlsx('export.tickets', { filter: flt() }) }, '↓ Xuất Excel')));
      const toolbar = h('div', { class: 'tickets-toolbar', role: 'group', 'aria-label': 'Thao tác với phiếu cân' },
        h('div', { class: 'tickets-actions' }, duyetOn() ? [apvSel, apvAll] : null),
        h('div', { class: 'tickets-actions tickets-remove' }, selBtn, allBtn));
      v.append(h('div', { class: 'tickets-page' }, heading, await App.filterBar(reset), toolbar, body));
      await load();
    },
  });

  App.register('vehicle', {
    async render(v, params = {}) {
      const xe = await api('catalog.list', { table: 'xe' });
      const sel = h('select', {}, h('option', { value: '' }, '— chọn xe —'), xe.map((x) => h('option', { value: x.bien_so_hien_thi, selected: x.bien_so_hien_thi === params.bien_so }, `${x.bien_so_hien_thi} · ${x.don_vi_hien_tai || '?'} · ${x.so_chuyen} chuyến`)));
      const body = h('div', {});
      const load = App.latestRender(body, async (body) => {
        App.clear(body);
        if (!sel.value) return body.append(h('div', { class: 'empty' }, 'Chọn một xe để xem lịch sử chuyến.'));
        const f = App.cleanFilter(App.state.filter);
        const rows = await api('reports.timeline', { bien_so: sel.value, tu_ngay: f.tu_ngay, den_ngay: f.den_ngay });
        const kg = rows.reduce((a, r) => a + r.kl_hang_kg, 0); const amt = rows.reduce((a, r) => a + (r.tien_truoc_vat || 0), 0);
        body.append(h('div', { class: 'grid g4', style: { marginBottom: '12px' } },
          h('div', { class: 'kpi' }, h('small', {}, 'Số chuyến'), h('b', {}, rows.length)), h('div', { class: 'kpi' }, h('small', {}, 'Khối lượng (tấn)'), h('b', {}, fmt.tan(kg / 1000))),
          h('div', { class: 'kpi' }, h('small', {}, 'Trước VAT'), h('b', {}, fmt.money(amt))), h('div', { class: 'kpi' + (rows.some((r) => r.flags.length) ? ' warn' : '') }, h('small', {}, 'Chuyến bất thường'), h('b', {}, rows.filter((r) => r.flags.length).length))),
        h('div', { class: 'card' }, table({
          columns: [{ key: 'stt', label: '#', num: true }, { key: 'so_phieu', label: 'Số phiếu', mono: true }, { key: 'ngay_gio_can_1', label: 'Ngày giờ cân 1', fmt: 'dt', mono: true }, { key: 'ngay_gio_can_2', label: 'Ngày giờ cân 2', fmt: 'dt', mono: true },
            { key: 'thoi_gian_can_phut', label: 'Thời gian cân', fmt: 'min' }, { key: 'khoang_cach_chuyen_phut', label: 'Cách chuyến trước', fmt: 'min' }, { key: 'noi_xuat', label: 'Nơi xuất' },
            { key: 'kl_hang_kg', label: 'KL (kg)', fmt: 'kg' }, { key: 'don_gia', label: 'Đơn giá', fmt: 'money' }, { key: 'tien_truoc_vat', label: 'Trước VAT', fmt: 'money' },
            { key: 'flags', label: 'Cảnh báo', render: (r) => h('span', {}, r.flags.map((x) => h('span', { class: 'tag amber', style: { marginRight: '3px' } }, FLAG_TXT[x] || x))) }],
          rows, rowClass: (r) => (r.flags.length ? 'flag' : ''), wrapClass: 'tall' }),
        h('p', { class: 'muted' }, 'Cảnh báo thời gian chỉ để kiểm tra — hệ thống không kết luận sai/đúng.')));
        if (rows.length) body.firstChild.before(h('div', { class: 'row', style: { marginBottom: '8px' } }, h('button', { class: 'btn ghost sm', onclick: () => App.exportXlsx('export.timeline', { bien_so: sel.value, tu_ngay: f.tu_ngay, den_ngay: f.den_ngay }) }, '⬇ Xuất Excel')));
      });
      sel.addEventListener('change', load);
      v.append(App.pageHead('Chi tiết theo xe', 'Lịch sử chuyến theo thời gian, cờ thời gian bất thường'), h('div', { class: 'card row' }, h('label', { class: 'field' }, 'Xe', sel)), await App.filterBar(load, { fields: ['tu_ngay', 'den_ngay'] }), body);
      await load();
    },
  });
})();
