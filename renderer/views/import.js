'use strict';
/** Import phiếu cân (4 bước) + Import danh mục xe + Cần kiểm tra + Lịch sử import. */
(() => {
  const { h, fmt, api, call, table, tag } = App;
  const FIELDS = [['so_phieu', 'Số phiếu *'], ['ngay_gio_can_1', 'Ngày giờ cân 1 *'], ['ngay_gio_can_2', 'Ngày giờ cân 2'], ['bien_so', 'Biển số *'], ['can_lan_1', 'Cân lần 1'], ['can_lan_2', 'Cân lần 2'], ['kl_hang_kg', 'KL hàng (kg) *'], ['noi_xuat', 'Nơi xuất *'], ['noi_den', 'Nơi đến']];
  const PHAN_LOAI = { NEW: 'green', EXACT_DUPLICATE: 'gray', KEY_CONFLICT: 'amber', IN_FILE_DUPLICATE: 'gray', ERROR: 'red' };

  App.register('import', {
    async render(v) {
      const S = { step: 1, open: null, info: null, mapping: {}, sheet: null, headerRow: 0, dotId: '', noiDenId: '', prev: null, filter: null, result: null };
      const root = h('div', {});
      const steps = () => h('div', { class: 'steps' }, ['1. Chọn file', '2. Sheet & cột', '3. Xem trước', '4. Kết quả'].map((t, i) => h('div', { class: 'step ' + (S.step === i + 1 ? 'on' : S.step > i + 1 ? 'done' : '') }, t)));
      const draw = () => { App.clear(root).append(steps()); ({ 1: s1, 2: s2, 3: s3, 4: s4 })[S.step](); };

      function s1() {
        root.append(h('div', { class: 'card' }, h('h3', {}, 'Chọn file phiếu cân (.xlsx / .csv)'),
          h('p', { class: 'muted' }, 'File Excel cũ (.xls) cần mở bằng Excel rồi "Lưu thành" .xlsx. Import lại cùng file không tạo phiếu trùng: phiếu giống hệt được bỏ qua, phiếu cùng số phiếu + nơi xuất nhưng khác dữ liệu vào "Cần kiểm tra".'),
          h('div', { class: 'row' }, h('button', { class: 'btn', 'data-act': 'pick', onclick: async () => {
            const f = await App.pickFile(); if (!f) return;
            const o = await call('import.open', f); if (!o) return;
            S.open = o; S.sheet = o.suggestedSheet; await loadSheet(); S.step = 2; draw();
          } }, '📂 Chọn file…'), h('button', { class: 'btn ghost', onclick: () => importVehicles() }, '🚛 Import danh mục xe (sheet "Số xe")…')),
          h('div', { class: 'row', style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed var(--line)' } }, h('span', { class: 'muted' }, 'Chưa có file? Tải file mẫu chuẩn rồi điền dữ liệu:'),
            h('button', { class: 'btn ghost sm', 'data-act': 'tpl-tickets', onclick: () => App.exportXlsx('template.tickets', {}) }, '⬇ File mẫu phiếu cân'),
            h('button', { class: 'btn ghost sm', 'data-act': 'tpl-vehicles', onclick: () => App.exportXlsx('template.vehicles', {}) }, '⬇ File mẫu danh sách xe'))));
      }
      async function loadSheet() { S.info = await api('import.sheetInfo', { token: S.open.token, sheetName: S.sheet, headerRow: null }); S.mapping = { ...S.info.mapping }; S.headerRow = S.info.headerRow; }

      async function s2() {
        const o = S.open;
        const dots = await api('catalog.options', { table: 'dot_van_chuyen' }); const dd = await api('catalog.options', { table: 'dia_diem' });
        // Kiểm tra NGAY khi ghép cột: thiếu cột bắt buộc, lỗi theo lý do, và đọc thử các dòng đầu để thấy máy hiểu gì
        const checkBox = h('div', { class: 'card', 'data-check': '1' }, h('h3', {}, 'Kiểm tra ngay…'));
        const previewBtn = h('button', { class: 'btn', 'data-act': 'preview', disabled: true, onclick: async () => {
          const r = await call('import.preview', { token: S.open.token, sheetName: S.sheet, headerRow: S.headerRow, mapping: S.mapping, dotId: S.dotId || null, noiDenId: S.noiDenId || null });
          if (!r) return; S.prev = r; S.filter = null; S.step = 3; draw();
        } }, 'Xem trước ›');
        const verdict = h('div', { class: 'chk-verdict', 'data-verdict': '1' }, 'Đang kiểm tra…');   // kết luận 1 dòng ngay cạnh các ô ghép cột
        const bad = (t) => h('span', { class: 'tag red' }, t), good = (t) => h('span', { class: 'tag green' }, t);
        const drawCheck = (r) => {
          previewBtn.disabled = r.blocking;
          const errs = r.problems.filter((x) => x.level === 'error'), warns = r.problems.filter((x) => x.level !== 'error');
          verdict.className = 'chk-verdict ' + (errs.length ? 'bad' : warns.length || r.summary.dong_loi ? 'warn' : 'ok');
          verdict.textContent = errs.length ? `✗ ${errs[0].text}${errs.length > 1 ? ` (+${errs.length - 1} lỗi nữa)` : ''}` : warns.length || r.summary.dong_loi
            ? `⚠ ${warns.length ? warns.length + ' cảnh báo' : ''}${warns.length && r.summary.dong_loi ? ' · ' : ''}${r.summary.dong_loi ? fmt.int(r.summary.dong_loi) + ' dòng có lỗi' : ''} — xem chi tiết bên dưới` : `✓ Đủ cột, đọc được ${fmt.int(r.summary.tong_dong)} dòng`;
          const kids = [h('h3', {}, 'Kiểm tra ngay — máy đọc file theo cách ghép cột hiện tại')];
          if (!r.problems.length) kids.push(h('p', { class: 'tag green' }, '✓ Đủ cột cần thiết'));
          r.problems.forEach((p) => kids.push(h('p', { class: 'chk ' + (p.level === 'error' ? 'bad' : 'warn') }, (p.level === 'error' ? '✗ ' : '⚠ ') + p.text)));
          const sm = r.summary;
          if (sm.tong_dong) {
            kids.push(h('p', { class: 'chk ' + (sm.dong_loi ? 'warn' : 'ok') }, `Đọc được ${fmt.int(sm.tong_dong)} dòng — ` + (sm.dong_loi ? `${fmt.int(sm.dong_loi)} dòng có lỗi (sẽ không được ghi)` : 'không có dòng lỗi')));
            if (sm.ly_do.length) kids.push(h('ul', { class: 'chk-list' }, sm.ly_do.map((x) => h('li', {}, `${fmt.int(x.so_dong)} dòng: ${x.text} (ví dụ dòng ${x.dong_dau})`))));
            kids.push(h('h3', { style: { marginTop: '12px' } }, `Đọc thử ${r.sample.length} dòng đầu`), table({ columns: [
              { key: 'source_row', label: 'Dòng', num: true }, { key: 'so_phieu', label: 'Số phiếu', mono: true },
              { key: 'ngay_gio_can_1', label: 'Cân 1', render: (x) => (x.ngay_gio_can_1 ? h('span', { class: 'mono' }, fmt.dt(x.ngay_gio_can_1)) : bad('không đọc được')) },
              { key: 'bien_so', label: 'Biển số', render: (x) => (x.bien_so ? h('span', { class: 'mono' }, x.bien_so, x.bien_so_goc && x.bien_so_goc !== x.bien_so ? h('small', { class: 'muted' }, ` ← ${x.bien_so_goc}`) : null) : bad('thiếu')) },
              { key: 'kl_hang_kg', label: 'KL (kg)', fmt: 'kg' },
              { key: 'noi_xuat_goc', label: 'Nơi xuất', render: (x) => (x.noi_xuat_nhan_dang ? good('✓ ' + x.noi_xuat_nhan_dang) : x.noi_xuat_goc ? bad(`chưa nhận ra “${x.noi_xuat_goc}”`) : h('span', { class: 'muted' }, '—')) },
              { key: 'errors', label: 'Lỗi', render: (x) => (x.errors.length ? h('span', { class: 'chk bad' }, x.errors.join('; ')) : h('span', { class: 'muted' }, '—')) }], rows: r.sample }));
          }
          App.clear(checkBox).append(...kids);
        };
        let tm = null;
        const runCheck = () => { clearTimeout(tm); tm = setTimeout(async () => {
          const r = await call('import.check', { token: S.open.token, sheetName: S.sheet, headerRow: S.headerRow, mapping: S.mapping });
          if (r && S.step === 2) drawCheck(r);
        }, 120); };
        root.append(
          h('div', { class: 'card' }, h('h3', {}, `${o.fileName}`), o.previouslyImported ? h('p', { class: 'tag amber' }, `File này đã import ở lô #${o.previouslyImported.batchId} (${fmt.dt(o.previouslyImported.at)}) — dòng trùng sẽ được bỏ qua`) : null,
            h('div', { class: 'form-grid' },
              h('label', { class: 'field' }, 'Sheet', h('select', { 'data-f': 'sheet', onchange: async (e) => { S.sheet = e.target.value; await loadSheet(); draw(); } }, o.sheets.map((s) => h('option', { value: s.name, selected: s.name === S.sheet }, `${s.name} (${s.rows} dòng)`)))),
              h('label', { class: 'field' }, 'Dòng tiêu đề (bắt đầu từ 1)', h('input', { type: 'number', min: 1, value: S.headerRow + 1, onchange: async (e) => { S.info = await api('import.sheetInfo', { token: o.token, sheetName: S.sheet, headerRow: Number(e.target.value) - 1 }); S.mapping = { ...S.info.mapping }; S.headerRow = S.info.headerRow; draw(); } })),
              h('label', { class: 'field' }, 'Gán vào đợt / tàu', h('select', { 'data-f': 'dot', onchange: (e) => (S.dotId = e.target.value) }, h('option', { value: '' }, '— không gán —'), dots.map((d) => h('option', { value: d.id, selected: String(S.dotId) === String(d.id) }, d.label)))),
              h('label', { class: 'field' }, 'Nơi đến mặc định (nếu file không có cột)', h('select', { 'data-f': 'noiden', onchange: (e) => (S.noiDenId = e.target.value) }, h('option', { value: '' }, '— không —'), dd.map((d) => h('option', { value: d.id, selected: String(S.noiDenId) === String(d.id) }, d.label)))))),
          h('div', { class: 'card' }, h('h3', {}, 'Ghép cột (tự nhận dạng — có thể sửa)'), verdict,
            h('div', { class: 'form-grid' }, FIELDS.map(([k, lbl]) => h('label', { class: 'field' }, lbl, h('select', { 'data-map': k, onchange: (e) => { if (e.target.value === '') delete S.mapping[k]; else S.mapping[k] = Number(e.target.value); runCheck(); } },
              h('option', { value: '' }, '— bỏ qua —'), S.info.headers.map((c) => h('option', { value: c.index, selected: S.mapping[k] === c.index }, `${c.index + 1}. ${c.text}`)))))),
            h('h3', { style: { marginTop: '14px' } }, 'Dữ liệu mẫu'), table({ columns: S.info.headers.map((c) => ({ key: String(c.index), label: c.text || `Cột ${c.index + 1}` })), rows: S.info.sample.map((r) => Object.fromEntries(r.map((x, i) => [String(i), x == null ? '' : String(x)]))) })),
          checkBox,
          h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => { S.step = 1; draw(); } }, '‹ Quay lại'), previewBtn));
        runCheck();
      }

      async function s3() {
        const c = S.prev.counts;
        const d = await api('import.previewRows', { token: S.open.token, filter: S.filter, offset: 0, limit: 300 });
        const chip = (key, label, n, cls = '') => h('div', { class: 'kpi click' + (cls ? ' ' + cls : ''), style: S.filter === key ? { outline: '2px solid var(--green)' } : null, onclick: () => { S.filter = S.filter === key ? null : key; draw(); } }, h('small', {}, label), h('b', {}, fmt.int(n)));
        // Đối chiếu khối lượng: tổng KL đọc được ↔ dòng "Tổng cộng" của file; tổng tạm tính của phiếu mới
        const T = S.prev.totals || {}; const kgf = (v) => `${fmt.kg(v)} kg (${fmt.tan(v / 1000)} tấn)`;
        const klCls = T.lech_kg === null || T.lech_kg === undefined ? 'ok' : T.lech_kg === 0 ? 'ok' : 'bad';
        root.append(h('div', { class: 'chk-verdict ' + klCls, 'data-kl-check': '1' },
          `Đọc ${fmt.int(T.so_dong)} dòng, tổng KL ${kgf(T.read_kg || 0)}. `,
          T.file_kg === null || T.file_kg === undefined ? 'File không có dòng "Tổng cộng" để đối chiếu. '
            : T.lech_kg === 0 ? `Khớp dòng "Tổng cộng" của file (dòng ${T.file_total_row}). ` : `LỆCH ${kgf(Math.abs(T.lech_kg))} so với dòng "Tổng cộng" của file (${kgf(T.file_kg)}) — có thể mất dòng, dòng bị loại hoặc sai đơn vị: kiểm tra trước khi import. `,
          `Phiếu mới: ${kgf(T.new_kg || 0)}, tạm tính trước VAT ${fmt.money(T.new_truoc_vat || 0)} đ.`));
        root.append(h('div', { class: 'grid g6', style: { marginBottom: '12px' } },
          chip(null, 'Tổng dòng', c.total), chip('new', 'Mới', c.new), chip('exact', 'Trùng hoàn toàn', c.exact), chip('conflict', 'Trùng khóa – khác', c.conflict, c.conflict ? 'warn' : ''), chip('inFile', 'Trùng trong file', c.inFile), chip('error', 'Lỗi', c.error, c.error ? 'warn' : '')),
        h('div', { class: 'grid g4', style: { marginBottom: '12px' } }, chip('unknownVehicle', 'Xe chưa xác định', c.unknownVehicle, c.unknownVehicle ? 'warn' : ''), chip('unknownLocation', 'Nơi xuất chưa rõ', c.unknownLocation, c.unknownLocation ? 'warn' : ''),
          chip('noPrice', 'Chưa có đơn giá', c.noPrice, c.noPrice ? 'warn' : ''), chip('multiplePrice', 'Xung đột giá', c.multiplePrice, c.multiplePrice ? 'warn' : '')),
        h('div', { class: 'card' }, table({
          columns: [{ key: 'idx', label: 'Dòng', render: (r) => r.source_row || r.idx + 1, num: true }, { key: 'phan_loai', label: 'Phân loại', render: (r) => h('span', { class: `tag ${PHAN_LOAI[r.phan_loai]}` }, App.STATUS_TAG[r.phan_loai][1]) },
            { key: 'so_phieu', label: 'Số phiếu', mono: true }, { key: 'ngay_gio_can_1', label: 'Cân 1', fmt: 'dt', mono: true }, { key: 'bien_so', label: 'Biển số', mono: true }, { key: 'noi_xuat', label: 'Nơi xuất' },
            { key: 'kl_hang_kg', label: 'KL (kg)', fmt: 'kg' }, { key: 'don_gia', label: 'Đơn giá', fmt: 'money' }, { key: 'tien_truoc_vat', label: 'Trước VAT', fmt: 'money' },
            { key: 'warnings', label: 'Ghi chú', render: (r) => h('span', {}, (r.errors || []).join('; '), (r.warnings || []).map((w) => h('span', { class: 'tag red', style: { marginRight: '3px' } }, (App.STATUS_TAG[w] || [0, w])[1]))) }],
          rows: d.rows, rowClass: (r) => (r.phan_loai === 'ERROR' ? 'err' : r.phan_loai === 'KEY_CONFLICT' ? 'flag' : r.phan_loai.includes('DUPLICATE') ? 'dup' : ''), wrapClass: 'tall' }),
        h('p', { class: 'muted' }, `Hiển thị ${d.rows.length}/${d.total} dòng.`)),
        h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => { S.step = 2; draw(); } }, '‹ Quay lại'),
          (c.error + c.conflict + c.unknownVehicle + c.unknownLocation + c.noPrice + c.multiplePrice) > 0 ? h('button', { class: 'btn ghost', 'data-act': 'issues', title: 'Excel liệt kê từng dòng cần xử lý kèm lý do và cách xử lý — sửa rồi import lại, dòng đã đúng không bị trùng', onclick: () => App.exportXlsx('import.issuesXlsx', { token: S.open.token }) }, '⬇ Tải các dòng cần xử lý (Excel)') : null,
          h('button', { class: 'btn', 'data-act': 'commit', disabled: c.new + c.conflict === 0, onclick: async () => {
            if (!(await App.confirmBox('Xác nhận import', `Ghi ${c.new} phiếu mới. ${c.conflict} dòng trùng khóa sẽ vào "Cần kiểm tra", ${c.exact + c.inFile} dòng trùng bị bỏ qua, ${c.error} dòng lỗi không được ghi. Hệ thống sẽ tự backup trước khi ghi.`, 'Import'))) return;
            const r = await call('import.commit', { token: S.open.token, dotId: S.dotId || null, noiDenId: S.noiDenId || null }); if (!r) return; S.result = r; S.step = 4; if (r.copyWarning) App.toast(r.copyWarning, true); draw();
          } }, `Import ${c.new} phiếu mới`)));
      }

      async function s4() {
        const r = S.result;
        const t = await api('workflow.todo').catch(() => null);
        // trùng khóa của CHÍNH lần import này còn chờ xử lý (đã xử lý xong thì biến mất, danh sách tự cập nhật)
        const conflictRows = (await api('import.pending').catch(() => [])).filter((x) => x.batch_id === r.batchId);
        const next = (n, text, btn, go, urgent) => h('div', { class: 'todo-row ' + (urgent ? 'open' : 'info') }, h('span', { class: 'todo-n' }, n), h('div', { class: 'todo-t' }, h('b', {}, text)), h('span', {}), h('button', { class: 'btn sm' + (urgent ? '' : ' ghost'), onclick: go }, btn));
        const steps = [];
        if (conflictRows.length) steps.push(next('1', `${fmt.int(conflictRows.length)} dòng trùng khóa nhưng khác nội dung — xử lý ở danh sách phía trên`, 'Mở màn Cần kiểm tra', () => App.go('review'), true));
        if (t && t.chua_tinh_gia) steps.push(next(String(steps.length + 1), `${fmt.int(t.chua_tinh_gia)} phiếu chưa tính được giá (thiếu xe, nơi xuất hoặc bảng giá)`, 'Xem phiếu cần hoàn thiện', () => App.go('tickets', { chua_tinh_gia: true }), true));
        steps.push(next(String(steps.length + 1), 'Kiểm tra số liệu rồi đối chiếu với đối tác', 'Đối chiếu', () => App.go('reconcile'), false));
        steps.push(next(String(steps.length + 1), 'Khi số liệu đã đúng: chốt kỳ để ký bảng kê', 'Chốt kỳ', () => App.go('lock'), false));
        root.append(h('div', { class: 'card', 'data-result': '1' }, h('h3', {}, '✅ Import hoàn tất'), h('div', { class: 'grid g4' },
          h('div', { class: 'kpi' }, h('small', {}, 'Phiếu mới'), h('b', {}, fmt.int(r.inserted))), h('div', { class: 'kpi' }, h('small', {}, 'Trùng bỏ qua'), h('b', {}, fmt.int(r.duplicate))),
          h('div', { class: 'kpi' + (r.conflict ? ' warn' : '') }, h('small', {}, 'Cần kiểm tra'), h('b', {}, fmt.int(r.conflict))), h('div', { class: 'kpi' }, h('small', {}, 'Đã tính giá'), h('b', {}, fmt.int(r.calculated)))),
          conflictRows.length ? h('h3', { style: { marginTop: '16px' } }, 'Cần kiểm tra — xử lý ngay tại đây') : null,
          conflictRows.length ? reviewCard(conflictRows, () => { App.refreshInfo(); draw(); }, { batchId: r.batchId }) : null,
          h('h3', { style: { marginTop: '16px' } }, 'Việc tiếp theo'), h('div', { class: 'todo' }, steps),
          h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { class: 'btn ghost', onclick: () => App.go('tickets') }, 'Xem phiếu cân'), h('button', { class: 'btn ghost', onclick: () => App.go('alerts') }, 'Xem cảnh báo'),
            h('button', { class: 'btn ghost', onclick: () => App.go('import') }, 'Import file khác'), h('span', { class: 'grow' }),
            r.inserted ? h('button', { class: 'btn ghost danger-t', 'data-act': 'undo', title: 'Gỡ toàn bộ phiếu của lần import này (ghi nhật ký, có thể import lại)', onclick: async () => {
              const reason = await App.promptBox('Hoàn tác lần import này', 'Lý do hoàn tác (bắt buộc)'); if (!reason) return;
              const u = await call('import.undo', { batchId: r.batchId, reason }, 'Đã hoàn tác lần import'); if (u) { App.refreshInfo(); App.go('import'); }
            } }, '↩ Hoàn tác lần import này') : null)));
      }
      v.append(App.pageHead('Import phiếu cân', 'Không ghi DB cho tới khi bạn xác nhận ở bước 3'), root); draw();
    },
  });

  async function importVehicles() {
    const f = await App.pickFile(); if (!f) return;
    const r = await call('vehicles.importPreview', f); if (!r) return;
    const flags = { createMissingCarriers: false };
    const lbl = { NEW: 'Xe mới', SAME: 'Không đổi', CHANGED_CARRIER: 'Đổi đơn vị', ASSIGN_CARRIER: 'Gán đơn vị', NEW_UNKNOWN_CARRIER: 'Xe mới – đơn vị chưa có', UNKNOWN_CARRIER: 'Đơn vị chưa có', INVALID_PLATE: 'Biển số sai', DUP_IN_FILE: 'Trùng trong file' };
    const cb = h('input', { type: 'checkbox', onchange: (e) => (flags.createMissingCarriers = e.target.checked) });
    const chg = h('input', { type: 'date', style: { width: '160px' } });
    App.modal({ title: `Import danh mục xe — sheet "${r.sheet}"`, wide: true,
      body: h('div', {}, h('p', {}, Object.entries(r.counts).map(([k, n]) => `${lbl[k] || k}: ${n}`).join(' · ')),
        r.missingCarriers.length ? h('label', { class: 'row gap-s' }, cb, `Tự tạo đơn vị chưa có: ${r.missingCarriers.join(', ')}`) : null,
        r.counts.CHANGED_CARRIER ? h('label', { class: 'field' }, 'Xe đổi đơn vị: áp dụng từ ngày (để trống = không đổi)', chg) : null,
        table({ columns: [{ key: 'bien_so', label: 'Biển số', mono: true }, { key: 'don_vi_ma', label: 'Đơn vị trong file' }, { key: 'don_vi_hien_tai', label: 'Hiện tại' }, { key: 'status', label: 'Kết quả', render: (x) => lbl[x.status] || x.status }], rows: r.rows.slice(0, 200), wrapClass: '' })),
      actions: [{ label: 'Hủy', primary: false }, { label: 'Ghi danh mục xe', onClick: async () => { const x = await call('vehicles.importCommit', { token: r.token, createMissingCarriers: flags.createMissingCarriers, changeFrom: chg.value || null }, 'Đã import danh mục xe'); if (x) App.reload(); } }] });
  }

  // ------------------------------------------------------------ Cần kiểm tra
  /**
   * Danh sách "Cần kiểm tra" dùng chung (màn riêng + ngay trong bước Kết quả của import): so sánh cũ/mới từng phiếu và xử lý từng dòng hoặc HÀNG LOẠT.
   * Không bao giờ tự ghi đè: mỗi lựa chọn là một hành động có chủ đích (cập nhật bắt buộc ghi lý do).
   */
  function reviewCard(rows, onDone, { batchId = null } = {}) {
    const FIELD = { ngay_gio_can_1: 'Cân 1', ngay_gio_can_2: 'Cân 2', bien_so: 'Biển số', can_lan_1: 'Cân lần 1', can_lan_2: 'Cân lần 2', kl_hang_kg: 'KL (kg)', noi_xuat: 'Nơi xuất' };
    const resolve = async (r, a, note) => call('import.resolve', { id: r.id, action: a, note });
    const act = (r, a, label, cls) => ({ label, cls, onClick: async () => {
      const note = a === 'UPDATE' ? await App.promptBox('Lý do cập nhật', 'Ghi chú') : '';
      if (a === 'UPDATE' && !note) return false;
      const x = await resolve(r, a, note); if (x) { App.toast('Đã xử lý'); onDone(); }
    } });
    const show = (r) => App.modal({ title: `Phiếu ${r.so_phieu}: so sánh dữ liệu cũ và mới`, wide: true,
      body: h('div', {}, r.chot_ky_id ? h('p', { class: 'tag purple' }, 'Phiếu đã chốt kỳ — không thể cập nhật') : null,
        table({ columns: [{ key: 'f', label: 'Trường' }, { key: 'o', label: 'Đang lưu', render: (x) => h('span', { class: 'diff-old' }, x.o) }, { key: 'n', label: 'File mới', render: (x) => h('span', { class: 'diff-new' }, x.n) }],
          rows: (r.diffs.length ? r.diffs : []).map((d) => ({ f: FIELD[d.field] || d.field, o: String(d.old ?? ''), n: String(d.new ?? '') })), empty: 'Không có chênh lệch chi tiết' })),
      actions: [{ label: 'Đóng', primary: false }, act(r, 'IGNORE', 'Bỏ qua dòng mới', 'ghost'), act(r, 'KEEP_OLD', 'Giữ dữ liệu cũ', ''), ...(r.chot_ky_id ? [] : [act(r, 'UPDATE', 'Cập nhật theo file mới', 'amber')])] });
    // hàng loạt: mỗi dòng một giao dịch ở máy chủ, KHÔNG dừng ở lỗi đầu; hiện kết quả từng phiếu (thành công / lý do lỗi)
    const bulk = async (a, label) => {
      const todo = rows;
      if (!todo.length) return App.toast('Không có dòng nào để xử lý', true);
      let note = '';
      if (a === 'UPDATE') { note = await App.promptBox('Lý do cập nhật hàng loạt', `Cập nhật ${todo.length} phiếu theo file mới — ghi chú`); if (!note) return; }
      if (!(await App.confirmBox(label, `${label}: ${todo.length} phiếu. Phiếu đã chốt kỳ/đợt khóa hoặc không còn hiệu lực sẽ được bỏ qua và nêu lý do. Có ghi nhật ký từng phiếu. Tiếp tục?`))) return;
      const res = await call('import.resolveMany', { ids: todo.map((r) => r.id), action: a, note, batchId });
      if (!res) return;
      const bad = res.results.filter((x) => !x.ok);
      App.toast(`Đã xử lý ${res.ok}/${res.total} phiếu${bad.length ? ` — ${bad.length} phiếu không xử lý được` : ''}`, !!bad.length);
      if (bad.length) App.modal({ title: `${bad.length} phiếu không xử lý được`, wide: true, actions: [{ label: 'Đóng', primary: false }],
        body: table({ columns: [{ key: 'so_phieu', label: 'Số phiếu', mono: true }, { key: 'reason', label: 'Lý do' }], rows: bad }), onClose: onDone });
      else onDone();
    };
    return h('div', { class: 'card', 'data-review': '1' },
      rows.length ? h('div', { class: 'row gap-s', style: { marginBottom: '10px' } }, h('b', {}, `${rows.length} phiếu cần kiểm tra`), h('span', { class: 'grow' }),
        h('button', { class: 'btn ghost sm', 'data-act': 'bulk-keep', onclick: () => bulk('KEEP_OLD', 'Giữ dữ liệu cũ cho tất cả') }, 'Giữ cũ tất cả'),
        h('button', { class: 'btn ghost sm', 'data-act': 'bulk-ignore', onclick: () => bulk('IGNORE', 'Bỏ qua tất cả dòng mới') }, 'Bỏ qua tất cả'),
        h('button', { class: 'btn amber sm', 'data-act': 'bulk-update', onclick: () => bulk('UPDATE', 'Cập nhật tất cả theo file mới') }, 'Cập nhật tất cả theo file mới')) : null,
      table({ columns: [{ key: 'so_phieu', label: 'Số phiếu', mono: true }, { key: 'bien_so', label: 'Biển số đang lưu', mono: true }, { key: 'kl_hang_kg', label: 'KL đang lưu', fmt: 'kg' }, { key: 'file_name', label: 'File nguồn' }, { key: 'source_row', label: 'Dòng', num: true },
        { key: 'diffs', label: 'Khác biệt', render: (r) => (r.diffs || []).map((d) => FIELD[d.field] || d.field).join(', ') }, { key: 'x', label: '', render: (r) => h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); show(r); } }, 'Xem & xử lý') }],
      rows, empty: '🎉 Không có phiếu nào cần kiểm tra', onRow: show }));
  }

  App.register('review', {
    async render(v) {
      const rows = await api('import.pending');
      v.append(App.pageHead('Cần kiểm tra', 'Phiếu cùng số phiếu + nơi xuất nhưng dữ liệu khác — không bao giờ tự ghi đè'), reviewCard(rows, () => { App.refreshInfo(); App.reload(); }));
    },
  });

  // ------------------------------------------------------------ Lịch sử import
  App.register('batches', {
    async render(v) {
      const rows = await api('import.batches');
      const rowsOf = async (b) => { const d = await api('import.batchRows', { batchId: b.id, limit: 300 }); App.modal({ title: `Lô #${b.id} — ${b.file_name}`, wide: true, actions: [{ label: 'Đóng', primary: false }],
        body: table({ columns: [{ key: 'source_row', label: 'Dòng', num: true }, { key: 'so_phieu', label: 'Số phiếu', mono: true }, { key: 'bien_so', label: 'Biển số', mono: true }, { key: 'hanh_dong', label: 'Hành động' }, { key: 'trang_thai_phieu', label: 'Phiếu', tag: true }], rows: d.rows }) }); };
      const undo = async (b) => { const reason = await App.promptBox('Hoàn tác lô import', 'Lý do hoàn tác'); if (!reason) return; const x = await call('import.undo', { batchId: b.id, reason }, 'Đã hoàn tác lô'); if (x) App.reload(); };
      v.append(App.pageHead('Lịch sử import', 'Mỗi lần import là một lô; có thể hoàn tác cả lô nếu chưa chốt kỳ'),
        h('div', { class: 'card' }, table({ columns: [{ key: 'id', label: 'Lô', num: true }, { key: 'import_time', label: 'Thời gian', fmt: 'dt' }, { key: 'file_name', label: 'File' }, { key: 'total_rows', label: 'Dòng', fmt: 'int' }, { key: 'inserted_rows', label: 'Mới', fmt: 'int' },
          { key: 'duplicate_rows', label: 'Trùng', fmt: 'int' }, { key: 'conflict_rows', label: 'Cần kiểm tra', fmt: 'int' }, { key: 'error_rows', label: 'Lỗi', fmt: 'int' }, { key: 'trang_thai', label: 'Trạng thái', tag: true },
          { key: 'x', label: '', render: (b) => h('span', { class: 'row gap-s' }, h('button', { class: 'btn ghost sm', onclick: () => rowsOf(b) }, 'Chi tiết'), b.trang_thai === 'COMMITTED' ? h('button', { class: 'btn danger sm', onclick: () => undo(b) }, 'Hoàn tác') : null) }], rows, empty: 'Chưa import lần nào' })));
    },
  });
})();
