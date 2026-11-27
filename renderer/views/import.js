'use strict';
/** Import phiếu cân (4 bước) + Import danh mục xe + Cần kiểm tra + Lịch sử import. */
(() => {
  const { h, fmt, api, call, table, tag } = App;
  const { FIELDS, units, trial } = App.excelTemplates;
  const templateName = (config) => config?.name || 'Tự nhận diện';
  const readingBadge = (name) => h('p', { 'data-import-reading': '1' }, 'Cách đọc đang dùng ', h('strong', { class: 'tag green' }, name));
  const PHAN_LOAI = { NEW: 'green', EXACT_DUPLICATE: 'gray', KEY_CONFLICT: 'amber', IN_FILE_DUPLICATE: 'gray', ERROR: 'red' };

  App.register('import', {
    async render(v) {
      const config = (await api('settings.all')).excel_import_templates;
      const defaultName = () => templateName(config?.templates.find((item) => item.id === config.defaultId));
      const S = { step: 1, open: null, info: null, mapping: {}, sheet: null, headerRow: 0, headerRows: 1, templateId: null, strict: false, fallbackUnit: '', dotId: '', noiDenId: '', prev: null, filter: null, result: null, readAfterTotal: false };
      const root = h('div', {});
      const steps = () => h('div', { class: 'steps' }, ['1. Chọn file', '2. Sheet & cột', '3. Xem trước', '4. Kết quả'].map((t, i) => h('div', { class: 'step ' + (S.step === i + 1 ? 'on' : S.step > i + 1 ? 'done' : '') }, t)));
      const draw = () => { App.clear(root).append(steps()); ({ 1: s1, 2: s2, 3: s3, 4: s4 })[S.step](); };

      function makeProgressBar(title) {
        const fill = h('div', { style: { width: '25%', height: '100%', background: 'linear-gradient(90deg, var(--brand), var(--champ))', transition: 'width .2s ease' } });
        const pct = h('span', { class: 'mono' }, '25%');
        const stText = h('span', {}, title);
        const el = h('div', { class: 'card', style: { padding: '12px 16px', marginBottom: '12px', borderLeft: '4px solid var(--brand)' } },
          h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '6px' } },
            h('b', { style: { color: 'var(--brand)' } }, stText),
            pct
          ),
          h('div', { style: { background: 'var(--line)', borderRadius: '999px', height: '8px', overflow: 'hidden' } }, fill)
        );
        return {
          el,
          update(step, text) {
            const p = Math.min(100, step * 25);
            fill.style.width = p + '%';
            pct.textContent = p + '%';
            stText.textContent = text;
          },
          remove() { el.remove(); },
        };
      }

      async function handleFileChosen(f) {
        if (!f) return;
        const o = await call('import.open', f); if (!o) return;
        if (S.open) await call('import.cancel', { token: S.open.token });
        S.open = o; S.sheet = o.suggestedSheet; S.templateId = o.defaultId;
        S.strict = false; S.fallbackUnit = ''; S.headerRows = 1; S.readAfterTotal = false; S.dotId = ''; S.noiDenId = '';
        await loadSheet();

        // 1-Click Smart Import: Nếu file hợp lệ và đủ cột chuẩn mà không có lỗi mapping, nhảy thẳng tới Bước 3 (Xem trước)
        try {
          const checkRes = await api('import.check', readOptions());
          if (checkRes && !checkRes.blocking && checkRes.summary.tong_dong > 0 && !checkRes.summary.dong_loi) {
            const prev = await api('import.preview', previewOptions());
            if (prev) {
              S.prev = prev;
              S.filter = null;
              S.step = 3;
              draw();
              App.toast(`✓ Nhận diện thông minh: đọc thành công ${fmt.int(prev.counts.total)} phiếu từ sheet "${S.sheet}"`);
              return;
            }
          }
        } catch (e) {
          // Nếu tự nhận diện không đủ điều kiện thì chuyển sang Bước 2 để người dùng xem/chỉnh
        }

        S.step = 2; draw();
      }

      function s1() {
        const dropzone = h('div', { class: 'dropzone', 'data-act': 'dropzone', role: 'button', tabindex: '0', 'aria-label': 'Chọn file phiếu cân',
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dropzone.click(); } },
          ondragover: (e) => { e.preventDefault(); dropzone.classList.add('dragover'); },
          ondragleave: () => dropzone.classList.remove('dragover'),
          ondrop: async (e) => {
            e.preventDefault(); dropzone.classList.remove('dragover');
            const file = e.dataTransfer?.files?.[0];
            if (file) {
              const payload = await App.fileToPayload(file);
              handleFileChosen(payload);
            }
          },
          onclick: async () => {
            const f = await App.pickFile();
            handleFileChosen(f);
          }
        },
          h('span', { class: 'dropzone-icon' }, '📂'),
          h('p', { class: 'dropzone-text' }, h('b', {}, 'Kéo & thả file Excel / CSV vào đây'), ' hoặc bấm để chọn file'),
          h('p', { class: 'dropzone-sub' }, 'Hỗ trợ .xlsx và .csv · Tự động nhận diện cấu trúc và đọc thẳng Bước 3 nếu khớp mẫu')
        );

        root.append(h('div', { class: 'card' }, h('h3', {}, 'Chọn file phiếu cân (.xlsx / .csv)'),
          h('p', { class: 'muted' }, 'Mẫu mặc định ', h('strong', {}, defaultName())),
          h('p', { class: 'muted' }, 'File Excel cũ (.xls) cần mở bằng Excel rồi "Lưu thành" .xlsx. Import lại cùng file không tạo phiếu trùng: phiếu giống hệt được bỏ qua, phiếu cùng số phiếu + nơi xuất nhưng khác dữ liệu vào "Cần kiểm tra".'),
          dropzone,
          h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: () => importVehicles() }, '🚛 Import danh mục xe (sheet "Số xe")…')),
          h('div', { class: 'row', style: { marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed var(--line)', flexWrap: 'wrap', gap: '8px', alignItems: 'center' } },
            h('span', { class: 'muted', style: { fontWeight: '600' } }, '📥 Tải file mẫu chuẩn doanh nghiệp:'),
            h('button', { class: 'btn ghost sm', 'data-act': 'tpl-tickets', onclick: () => App.exportTemplate('template.tickets', {}) }, '⬇ Mẫu Phiếu cân (chuẩn)'),
            h('button', { class: 'btn ghost sm', 'data-act': 'tpl-vehicles', onclick: () => App.exportTemplate('template.vehicles', {}) }, '⬇ Mẫu Danh sách xe'),
            h('button', { class: 'btn ghost sm', 'data-act': 'tpl-partner', onclick: () => App.exportTemplate('template.partner', {}) }, '⬇ Mẫu Bảng kê đối tác'),
            h('button', { class: 'btn ghost sm', 'data-act': 'tpl-fuel', onclick: () => App.exportTemplate('template.fuel', {}) }, '⬇ Mẫu Giá dầu'),
            h('button', { class: 'btn ghost sm', onclick: () => { App.state.settingsTab = 'excel'; App.go('settings'); } }, '⚙ Quản lý mẫu Excel…'))));
      }
      const selectedTemplate = () => S.open?.templates.find((item) => item.id === S.templateId);
      const activeName = () => selectedTemplate()?.name || (S.strict ? 'Ghép thủ công' : 'Tự nhận diện');
      const readOptions = () => ({
        token: S.open.token, sheetName: S.sheet, headerRow: S.headerRow, headerRows: S.headerRows,
        mapping: S.mapping, templateId: S.templateId, fallbackUnit: S.fallbackUnit, strict: S.strict, readAfterTotal: S.readAfterTotal,
      });
      const previewOptions = () => ({ ...readOptions(), dotId: S.dotId || null, noiDenId: S.noiDenId || null });
      async function loadSheet(headerRow = null) {
        if (!S.sheet) {
          S.info = { headers: [], sample: [] };
          S.mapping = {};
          S.headerRow = 0;
          return;
        }
        const info = await api('import.sheetInfo', { token: S.open.token, sheetName: S.sheet, headerRow,
          templateId: S.templateId, headerRows: S.headerRows });
        S.info = info;
        S.mapping = { ...info.mapping };
        S.headerRow = info.headerRow;
        S.headerRows = info.headerRows;
      }

      async function s2() {
        const o = S.open;
        const dots = await api('catalog.options', { table: 'dot_van_chuyen' }); const dd = await api('catalog.options', { table: 'dia_diem' });
        // Kiểm tra NGAY khi ghép cột: thiếu cột bắt buộc, lỗi theo lý do, và đọc thử các dòng đầu để thấy máy hiểu gì
        const checkBox = h('div', { class: 'card', 'data-check': '1' }, h('h3', {}, 'Kiểm tra ngay…'));
        const previewBtn = h('button', { class: 'btn', 'data-act': 'preview', disabled: true, onclick: async () => {
          previewBtn.disabled = true;
          const prog = makeProgressBar('Bước 1/4: Đọc file Excel vào bộ nhớ…');
          checkBox.before(prog.el);
          try {
            await new Promise((res) => setTimeout(res, 50));
            prog.update(2, 'Bước 2/4: Phân tích cú pháp & chuẩn hóa dữ liệu…');
            await new Promise((res) => setTimeout(res, 50));
            prog.update(3, 'Bước 3/4: Kiểm tra trùng lặp & tính thử chi phí…');
            const r = await call('import.preview', previewOptions());
            if (!r) return;
            prog.update(4, 'Bước 4/4: Hoàn tất xem trước');
            S.prev = r; S.filter = null; S.step = 3; draw();
          } finally {
            prog.remove();
            if (S.step === 2 && previewBtn.isConnected) runCheck();
          }
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
          const ignoredWarn = r.problems.find((x) => x.text && x.text.includes('DƯỚI dòng "Tổng cộng"'));
          if (ignoredWarn) {
            kids.push(h('div', { class: 'card', style: { borderColor: 'var(--amber)', background: 'var(--warnBg, rgba(237,161,0,.1))', marginTop: '10px' } },
              h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
                h('div', {},
                  h('b', { style: { color: 'var(--amber)' } }, '⚠ Phát hiện nhiều khối dữ liệu con trong file:'),
                  h('p', { style: { margin: '4px 0 0', fontSize: '13px' } }, ignoredWarn.text)
                ),
                h('button', { class: 'btn sm ' + (S.readAfterTotal ? 'ghost' : 'amber'), 'data-act': 'toggle-multi-block', onclick: () => {
                  S.readAfterTotal = !S.readAfterTotal;
                  const cb = root.querySelector('[data-f="multi-block"]');
                  if (cb) cb.checked = !!S.readAfterTotal;
                  runCheck();
                } }, S.readAfterTotal ? '✓ Đang đọc tất cả các khối' : 'Đọc tiếp toàn bộ các khối phía dưới')
              )
            ));
          }
          const sm = r.summary;
          if (sm.tong_dong) {
            kids.push(h('p', { class: 'chk ' + (sm.dong_loi ? 'warn' : 'ok') }, `Đọc được ${fmt.int(sm.tong_dong)} dòng — ` + (sm.dong_loi ? `${fmt.int(sm.dong_loi)} dòng có lỗi (sẽ không được ghi)` : 'không có dòng lỗi')));
            if (sm.ly_do.length) kids.push(h('ul', { class: 'chk-list' }, sm.ly_do.map((x) => h('li', {}, `${fmt.int(x.so_dong)} dòng: ${x.text} (ví dụ dòng ${x.dong_dau})`))));
            kids.push(h('h3', { style: { marginTop: '12px' } }, `Đọc thử ${r.sample.length} dòng đầu`), table({ columns: [
              { key: 'source_row', label: 'Dòng', num: true }, { key: 'so_phieu', label: 'Số phiếu', mono: true },
              { key: 'ngay_gio_can_1', label: 'Ngày giờ cân 1', render: (x) => (x.ngay_gio_can_1 ? h('span', { class: 'mono' }, fmt.dt(x.ngay_gio_can_1)) : bad('không đọc được')) },
              { key: 'bien_so', label: 'Biển số', render: (x) => (x.bien_so ? h('span', { class: 'mono' }, x.bien_so, x.bien_so_goc && x.bien_so_goc !== x.bien_so ? h('small', { class: 'muted' }, ` ← ${x.bien_so_goc}`) : null) : bad('thiếu')) },
              { key: 'kl_hang_kg', label: 'KL (kg)', fmt: 'kg' },
              { key: 'noi_xuat_goc', label: 'Nơi xuất', render: (x) => (x.noi_xuat_nhan_dang ? good('✓ ' + x.noi_xuat_nhan_dang) : x.noi_xuat_goc ? bad(`chưa nhận ra “${x.noi_xuat_goc}”`) : h('span', { class: 'muted' }, '—')) },
              { key: 'errors', label: 'Lỗi', render: (x) => (x.errors.length ? h('span', { class: 'chk bad' }, x.errors.join('; ')) : h('span', { class: 'muted' }, '—')) }], rows: r.sample }));
          }
          App.clear(checkBox).append(...kids);
        };
        let tm = null, revision = 0;
        const runCheck = () => {
          clearTimeout(tm);
          previewBtn.disabled = true;
          const version = ++revision;
          if (!S.sheet) {
            const choices = S.open.ambiguousSheets || [];
            App.clear(checkBox).append(h('p', { class: 'chk warn' }, choices.length
              ? `Nhiều sheet khớp mẫu: ${choices.join(', ')}. Hãy chọn sheet cần nhập.`
              : 'Hãy chọn sheet cần nhập.'));
            return;
          }
          tm = setTimeout(async () => {
            if (!checkBox.isConnected) return;
            const r = await call('import.check', readOptions());
            if (r && version === revision && S.step === 2 && checkBox.isConnected) drawCheck(r);
          }, 120);
        };
        const tpl = selectedTemplate();
        const mode = h('select', { 'data-import-template': '1', onchange: async (event) => {
          S.templateId = event.target.value || null;
          S.strict = false; S.fallbackUnit = ''; S.headerRows = 1;
          await loadSheet();
          draw();
        } }, h('option', { value: '', selected: !tpl && !S.strict }, 'Tự nhận diện'),
          S.strict && h('option', { value: 'manual', selected: true, disabled: true }, 'Ghép thủ công'),
          o.templates.map((item) => h('option', { value: item.id, selected: item.id === S.templateId },
            item.name + (item.id === o.defaultId ? ' (mặc định)' : ''))));
        root.append(
          h('div', { class: 'card' }, h('h3', {}, o.fileName), readingBadge(activeName()),
            o.previouslyImported ? h('p', { class: 'tag amber' }, `File này đã import ở lô #${o.previouslyImported.batchId} (${fmt.dt(o.previouslyImported.at)}) — dòng trùng sẽ được bỏ qua`) : null,
            h('div', { class: 'form-grid' },
              h('label', { class: 'field' }, 'Mẫu nhập', mode),
              h('label', { class: 'field' }, 'Sheet', h('select', { 'data-f': 'sheet', onchange: async (e) => { S.sheet = e.target.value; await loadSheet(S.strict ? S.headerRow : null); draw(); } }, !S.sheet && h('option', { value: '', disabled: true, selected: true }, '— Chọn sheet —'), o.sheets.map((s) => h('option', { value: s.name, selected: s.name === S.sheet }, `${s.name} (${s.rows} dòng)`)))),
              h('label', { class: 'field' }, 'Dòng cuối của tiêu đề (từ 1)', h('input', { type: 'number', min: S.headerRows, disabled: !!tpl, value: S.headerRow + 1,
                onchange: async (e) => { await loadSheet(Number(e.target.value) - 1); draw(); } })),
              h('label', { class: 'field' }, 'Số dòng tiêu đề', h('select', { disabled: !!tpl, onchange: async (event) => {
                S.headerRows = Number(event.target.value);
                await loadSheet(Math.max(S.headerRow, S.headerRows - 1)); draw();
              } }, [1, 2, 3].map((count) => h('option', { value: count, selected: count === S.headerRows }, `${count} dòng`)))),
              h('label', { class: 'field' }, 'Đơn vị dự phòng', h('select', { disabled: !!tpl, onchange: (e) => { S.fallbackUnit = e.target.value; runCheck(); } },
                units(tpl?.fallbackUnit ?? S.fallbackUnit))),
              h('label', { class: 'field' }, 'Gán vào đợt / tàu', h('select', { 'data-f': 'dot', onchange: (e) => (S.dotId = e.target.value) }, h('option', { value: '' }, '— không gán —'), dots.map((d) => h('option', { value: d.id, selected: String(S.dotId) === String(d.id) }, d.label)))),
              h('label', { class: 'field' }, 'Nơi đến mặc định (nếu file không có cột)', h('select', { 'data-f': 'noiden', onchange: (e) => (S.noiDenId = e.target.value) }, h('option', { value: '' }, '— không —'), dd.map((d) => h('option', { value: d.id, selected: String(S.noiDenId) === String(d.id) }, d.label)))))),
          h('div', { class: 'card' }, h('h3', {}, 'Ghép cột'), verdict,
            h('p', { class: 'muted' }, 'Ngày và giờ ở hai cột: ghép cột ngày vào Ngày giờ cân và cột giờ vào Giờ cân (cột riêng) của cùng lần cân.'),
            tpl && h('button', { class: 'btn ghost sm', 'data-import-edit-mapping': '1', onclick: () => {
              S.fallbackUnit = tpl.fallbackUnit; S.strict = true; S.templateId = null; draw();
            } }, 'Sửa cách ghép cho lần nhập này'),
            h('div', { class: 'form-grid' }, FIELDS.map(([k, lbl]) => h('label', { class: 'field' }, lbl, h('select', { 'data-map': k, disabled: !!tpl, onchange: (e) => { if (e.target.value === '') delete S.mapping[k]; else S.mapping[k] = Number(e.target.value); runCheck(); } },
              h('option', { value: '', selected: S.mapping[k] == null }, '— bỏ qua —'), S.info.headers.map((c) => h('option', { value: c.index, selected: S.mapping[k] === c.index }, `${c.index + 1}. ${c.text}`)))))),
            h('h3', { style: { marginTop: '14px' } }, 'Dữ liệu mẫu'), table({ columns: S.info.headers.map((c) => ({ key: String(c.index), label: c.text || `Cột ${c.index + 1}` })), rows: S.info.sample.map((r) => Object.fromEntries(r.map((x, i) => [String(i), x == null ? '' : String(x)]))) })),
          h('div', { class: 'card' }, h('label', { class: 'row gap-s', style: { alignItems: 'center' } }, h('input', { type: 'checkbox', 'data-f': 'multi-block', checked: !!S.readAfterTotal, onchange: (e) => { S.readAfterTotal = e.target.checked; runCheck(); } }),
            h('span', {}, h('b', {}, 'File có nhiều khối (mỗi khối một dòng "Tổng cộng"): đọc tất cả các khối'), h('small', { class: 'muted', style: { display: 'block' } }, 'Mặc định chỉ đọc đến dòng "Tổng cộng" đầu tiên (dữ liệu bên dưới được báo là chưa đọc). Bật tùy chọn này để đọc tiếp các khối sau; tổng đối chiếu = tổng các dòng "Tổng cộng".')))),
          checkBox,
          h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => { S.step = 1; draw(); } }, '‹ Quay lại'), previewBtn));
        runCheck();
      }

      async function s3() {
        const c = S.prev.counts;
        const [d, carriers] = await Promise.all([
          api('import.previewRows', { token: S.open.token, filter: S.filter, offset: 0, limit: 300 }),
          api('catalog.options', { table: 'don_vi_van_chuyen' }),
        ]);

        const quickAssignVehicle = (bienSo) => {
          let selCarrier = '';
          const body = h('div', {},
            h('p', {}, 'Biển số: ', h('b', { class: 'mono' }, bienSo)),
            h('p', { class: 'muted' }, 'Xe này chưa có trong danh mục hoặc chưa phân bổ nhà xe. Chọn đơn vị vận chuyển để thêm xe và tính cước ngay:'),
            h('label', { class: 'field' }, 'Đơn vị vận chuyển *',
              h('select', { onchange: (e) => (selCarrier = e.target.value) },
                h('option', { value: '' }, '— Chọn đơn vị —'),
                carriers.map((cr) => h('option', { value: cr.id }, cr.label))
              )
            )
          );
          App.modal({
            title: `Phân bổ nhanh nhà xe: ${bienSo}`,
            body,
            actions: [
              { label: 'Hủy', primary: false },
              { label: 'Lưu & Tính cước ngay', primary: true, onClick: async () => {
                if (!selCarrier) { App.toast('Chưa chọn đơn vị vận chuyển', true); return false; }
                const res = await call('vehicles.quickAssign', { bien_so: bienSo, don_vi_van_chuyen_id: selCarrier });
                if (res && res.ok) {
                  App.toast(`Đã gán xe ${bienSo} vào đơn vị vận chuyển!`);
                  const newPrev = await call('import.preview', previewOptions());
                  if (newPrev) { S.prev = newPrev; draw(); }
                  return true;
                }
                return false;
              } }
            ]
          });
        };

        const chip = (key, label, n, cls = '') => h('div', { class: 'kpi click' + (cls ? ' ' + cls : ''), style: S.filter === key ? { outline: '2px solid var(--green)' } : null, onclick: () => { S.filter = S.filter === key ? null : key; draw(); } }, h('small', {}, label), h('b', {}, fmt.int(n)));
        // Đối chiếu khối lượng: tổng KL đọc được ↔ dòng "Tổng cộng" của file; tổng tạm tính của phiếu mới
        const T = S.prev.totals || {}; const kgf = (v) => `${fmt.kg(v)} kg (${fmt.tan(v / 1000)} tấn)`;
        const klCls = (T.ignored_below_total > 0) || (T.lech_kg !== null && T.lech_kg !== undefined && T.lech_kg !== 0) ? 'bad' : 'ok';
        if (T.ignored_below_total > 0) {
          root.append(h('div', { class: 'card', style: { borderColor: 'var(--amber)', background: 'var(--warnBg, rgba(237,161,0,.1))', marginBottom: '12px' } },
            h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
              h('div', {},
                h('b', { style: { color: 'var(--amber)' } }, `⚠ Còn ${fmt.int(T.ignored_below_total)} dòng dữ liệu nằm dưới dòng "Tổng cộng" (dòng ${T.ignored_first_row}). File có thể chứa nhiều khối dữ liệu con.`),
                h('p', { class: 'muted', style: { margin: '4px 0 0', fontSize: '13px' } }, 'Bấm nút bên cạnh để đọc tiếp toàn bộ các khối phía dưới mà không cần quay lại cấu hình.')
              ),
              h('button', { class: 'btn amber sm', 'data-act': 'read-multi-block', onclick: async () => {
                S.readAfterTotal = true;
                const r = await call('import.preview', previewOptions());
                if (r) { S.prev = r; S.filter = null; draw(); }
              } }, 'Đọc tiếp toàn bộ các khối phía dưới')
            )
          ));
        }
        root.append(readingBadge(activeName()),
          h('div', { class: 'row gap-s', 'data-import-destination': '1' },
            h('span', {}, S.prev.selectedDot ? `Đợt: ${S.prev.selectedDot.ma_dot}` : 'Chưa gán đợt'),
            S.prev.suggestedDotId && h('button', { class: 'btn ghost sm', 'data-act': 'accept-dot', onclick: async () => {
              const next = await call('import.preview', { ...previewOptions(), dotId: S.prev.suggestedDotId });
              if (next) { S.dotId = next.selectedDot.id; S.prev = next; S.filter = null; draw(); }
            } }, `Dùng đợt gợi ý ${S.prev.suggestedDotCode}`),
            S.prev.noiDenId && h('span', {}, `Nơi đến mặc định: ${S.prev.noiDenName}`)),
          h('div', { class: 'chk-verdict ' + klCls, 'data-kl-check': '1' },
          `Đọc ${fmt.int(T.so_dong)} dòng, tổng KL ${kgf(T.read_kg || 0)}. `,
          T.ignored_below_total > 0 ? `CÒN ${fmt.int(T.ignored_below_total)} dòng giống phiếu cân dưới dòng "Tổng cộng" (từ dòng ${T.ignored_first_row}) CHƯA được đọc — file có nhiều khối? `
            : '',
          T.file_kg === null || T.file_kg === undefined ? (T.file_total_row ? `Tổng công bố (dòng ${T.file_total_row}) không đọc được nên chưa thể đối chiếu. ` : 'File không có dòng "Tổng cộng" để đối chiếu. ')
            : T.lech_kg === 0 ? `Khớp dòng "Tổng cộng" của file (dòng ${T.file_total_row}). ` : `LỆCH ${kgf(Math.abs(T.lech_kg))} so với dòng "Tổng cộng" của file (${kgf(T.file_kg)}) — có thể mất dòng, dòng bị loại hoặc sai đơn vị: kiểm tra trước khi import. `,
          `Phiếu mới: ${kgf(T.new_kg || 0)}, tạm tính trước VAT ${fmt.money(T.new_truoc_vat || 0)} đ.`));
        root.append(h('div', { class: 'grid g6', style: { marginBottom: '12px' } },
          chip(null, 'Tổng dòng', c.total), chip('new', 'Mới', c.new), chip('exact', 'Trùng hoàn toàn', c.exact), chip('conflict', 'Trùng khóa – khác', c.conflict, c.conflict ? 'warn' : ''), chip('inFile', 'Trùng trong file', c.inFile), chip('error', 'Lỗi', c.error, c.error ? 'warn' : '')),
        h('div', { class: 'grid g6', style: { marginBottom: '12px' } }, chip('pendingAlready', 'Đã chờ kiểm tra (không mở thêm)', c.pendingAlready, ''), chip('unknownVehicle', 'Xe chưa xác định', c.unknownVehicle, c.unknownVehicle ? 'warn' : ''), chip('unknownLocation', 'Nơi xuất chưa rõ', c.unknownLocation, c.unknownLocation ? 'warn' : ''),
          chip('noPrice', 'Chưa có đơn giá', c.noPrice, c.noPrice ? 'warn' : ''), chip('multiplePrice', 'Xung đột giá', c.multiplePrice, c.multiplePrice ? 'warn' : '')),
        h('div', { class: 'card' }, table({
          columns: [{ key: 'idx', label: 'Dòng', render: (r) => r.source_row || r.idx + 1, num: true }, { key: 'phan_loai', label: 'Phân loại', render: (r) => h('span', { class: `tag ${PHAN_LOAI[r.phan_loai]}` }, App.STATUS_TAG[r.phan_loai][1]) },
            { key: 'so_phieu', label: 'Số phiếu', mono: true }, { key: 'ngay_gio_can_1', label: 'Ngày giờ cân 1', fmt: 'dt', mono: true },
            { key: 'bien_so', label: 'Biển số', mono: true, render: (r) => {
              const hasWarn = (r.warnings || []).some((w) => w === 'UNKNOWN_VEHICLE' || w === 'UNKNOWN_CARRIER');
              if (hasWarn && r.bien_so) {
                return h('span', { class: 'row gap-xs', style: { alignItems: 'center' } },
                  h('span', { class: 'mono' }, r.bien_so),
                  h('button', { class: 'btn sm ghost brand', style: { padding: '1px 6px', fontSize: '11px' }, title: 'Gán nhanh nhà xe cho biển số này ngay tại đây', onclick: (e) => { e.stopPropagation(); quickAssignVehicle(r.bien_so); } }, '+ Gán nhà xe')
                );
              }
              return h('span', { class: 'mono' }, r.bien_so);
            } },
            { key: 'noi_xuat', label: 'Nơi xuất' }, { key: 'noi_den_ten', label: 'Nơi đến' },
            ...(S.mapping.tai_xe != null ? [{ key: 'tai_xe', label: 'Tài xế' }] : []),
            { key: 'kl_hang_kg', label: 'KL (kg)', fmt: 'kg' }, { key: 'don_gia', label: 'Đơn giá', fmt: 'money' }, { key: 'tien_truoc_vat', label: 'Trước VAT', fmt: 'money' },
            { key: 'warnings', label: 'Ghi chú', render: (r) => h('span', {}, (r.errors || []).join('; '), (r.warnings || []).map((w) => h('span', { class: 'tag red', style: { marginRight: '3px' } }, (App.STATUS_TAG[w] || [0, w])[1]))) }],
          rows: d.rows, rowClass: (r) => (r.phan_loai === 'ERROR' ? 'err' : r.phan_loai === 'KEY_CONFLICT' ? 'flag' : r.phan_loai.includes('DUPLICATE') ? 'dup' : ''), wrapClass: 'tall' }),
        h('p', { class: 'muted' }, `Hiển thị ${d.rows.length}/${d.total} dòng.`)),
        h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => { S.step = 2; draw(); } }, '‹ Quay lại'),
          (c.error + c.conflict + c.unknownVehicle + c.unknownLocation + c.noPrice + c.multiplePrice) > 0 ? h('button', { class: 'btn ghost', 'data-act': 'issues', title: 'Excel liệt kê từng dòng cần xử lý kèm lý do và cách xử lý — sửa rồi import lại, dòng đã đúng không bị trùng', onclick: () => App.exportXlsx('import.issuesXlsx', { token: S.open.token }) }, '⬇ Tải các dòng cần xử lý (Excel)') : null,
          h('button', { class: 'btn', 'data-act': 'commit', disabled: c.new + c.conflict === 0, onclick: async () => {
            if (!(await App.confirmBox('Xác nhận import', `Ghi ${c.new} phiếu mới. ${c.conflict} dòng trùng khóa sẽ vào "Cần kiểm tra"${c.pendingAlready ? `, ${c.pendingAlready} dòng đã chờ kiểm tra từ lô trước (không mở thêm)` : ''}, ${c.exact + c.inFile} dòng trùng bị bỏ qua, ${c.error} dòng lỗi không được ghi. Hệ thống sẽ tự backup trước khi ghi.`, 'Import'))) return;
            const prog = makeProgressBar('Bước 1/4: Tạo bản sao lưu an toàn trước khi ghi…');
            root.prepend(prog.el);
            try {
              await new Promise((res) => setTimeout(res, 40));
              prog.update(2, 'Bước 2/4: Kiểm tra toàn vẹn các phiếu cân…');
              await new Promise((res) => setTimeout(res, 40));
              prog.update(3, 'Bước 3/4: Ghi nhận dữ liệu vào CSDL (Transaction)…');
              const r = await call('import.commit', { token: S.open.token });
              if (!r) return;
              prog.update(4, 'Bước 4/4: Hoàn tất import!');
              S.result = r; S.step = 4; if (r.copyWarning) App.toast(r.copyWarning, true); draw();
            } finally {
              prog.remove();
            }
          } }, `Import ${c.new} phiếu mới`)));
      }

      async function s4() {
        root.append(readingBadge(activeName()));
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
    // Nhóm theo phiếu: nhiều dòng chờ (số liệu khác nhau) cho cùng một phiếu đứng liền nhau và đánh dấu "k/n"
    const nOf = {}; rows.forEach((r) => { nOf[r.phieu_can_id] = (nOf[r.phieu_can_id] || 0) + 1; });
    const seq = {};
    rows = [...rows].sort((a, b) => (a.phieu_can_id - b.phieu_can_id) || (a.id - b.id)).map((r) => ({ ...r, _n: nOf[r.phieu_can_id], _k: (seq[r.phieu_can_id] = (seq[r.phieu_can_id] || 0) + 1) }));
    const FIELD = { noi_den_id: 'Nơi đến', ngay_gio_can_1: 'Ngày giờ cân 1', ngay_gio_can_2: 'Ngày giờ cân 2', bien_so: 'Biển số', can_lan_1: 'Cân lần 1', can_lan_2: 'Cân lần 2', kl_hang_kg: 'KL (kg)', noi_xuat: 'Nơi xuất' };
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
    const bulk = async (a, label, subset = null) => {
      const todo = subset || rows;
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

    const klConflictRows = rows.filter((r) => (r.diffs || []).some((d) => d.field === 'kl_hang_kg' || d.field === 'can_lan_1' || d.field === 'can_lan_2'));
    const timeOnlyConflictRows = rows.filter((r) => (r.diffs || []).length > 0 && !(r.diffs || []).some((d) => d.field === 'kl_hang_kg' || d.field === 'can_lan_1' || d.field === 'can_lan_2'));

    return h('div', { class: 'card', 'data-review': '1' },
      rows.length ? h('div', { class: 'row gap-s', style: { marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' } },
        h('b', {}, `${rows.length} phiếu cần kiểm tra`),
        h('span', { class: 'grow' }),
        klConflictRows.length && klConflictRows.length !== rows.length ? h('button', { class: 'btn sm ghost amber-t', title: `Chỉ xử lý ${klConflictRows.length} phiếu có chênh lệch khối lượng cân`, onclick: () => bulk('UPDATE', `Chỉ cập nhật ${klConflictRows.length} phiếu lệch khối lượng`, klConflictRows) }, `⚡ Cập nhật ${klConflictRows.length} phiếu lệch KL`) : null,
        timeOnlyConflictRows.length ? h('button', { class: 'btn sm ghost', title: `Bỏ qua ${timeOnlyConflictRows.length} phiếu chỉ lệch giờ/ngày cân (không đổi khối lượng)`, onclick: () => bulk('IGNORE', `Bỏ qua ${timeOnlyConflictRows.length} phiếu chỉ lệch giờ cân`, timeOnlyConflictRows) }, `Bỏ qua ${timeOnlyConflictRows.length} phiếu chỉ lệch giờ`) : null,
        h('button', { class: 'btn ghost sm', 'data-act': 'bulk-keep', onclick: () => bulk('KEEP_OLD', 'Giữ dữ liệu cũ cho tất cả') }, 'Giữ cũ tất cả'),
        h('button', { class: 'btn ghost sm', 'data-act': 'bulk-ignore', onclick: () => bulk('IGNORE', 'Bỏ qua tất cả dòng mới') }, 'Bỏ qua tất cả'),
        h('button', { class: 'btn amber sm', 'data-act': 'bulk-update', onclick: () => bulk('UPDATE', 'Cập nhật tất cả theo file mới') }, 'Cập nhật tất cả theo file mới')) : null,
      table({ columns: [{ key: 'so_phieu', label: 'Số phiếu', mono: true }, { key: '_n', label: 'Nhóm', render: (r) => (r._n > 1 ? h('span', { class: 'tag amber', 'data-group': String(r.phieu_can_id), title: 'Nhiều dòng file cùng nhắm vào một phiếu — xử lý lần lượt' }, `${r._k}/${r._n} cùng phiếu`) : '') }, { key: 'bien_so', label: 'Biển số đang lưu', mono: true }, { key: 'kl_hang_kg', label: 'KL đang lưu', fmt: 'kg' }, { key: 'file_name', label: 'File nguồn' }, { key: 'source_row', label: 'Dòng', num: true },
        { key: 'diffs', label: 'Khác biệt (Cũ → Mới)', render: (r) => {
          const diffs = r.diffs || [];
          if (!diffs.length) return h('span', { class: 'muted' }, '—');
          return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, diffs.map((d) => {
            const fieldName = FIELD[d.field] || d.field;
            const isKL = d.field === 'kl_hang_kg';
            return h('span', { style: { fontSize: '12px' } },
              h('b', { style: { color: isKL ? 'var(--amber)' : 'inherit' } }, fieldName), ': ',
              h('span', { class: 'diff-old' }, String(d.old ?? '—')), ' → ',
              h('span', { class: 'diff-new' }, String(d.new ?? '—'))
            );
          }));
        } }, { key: 'x', label: '', render: (r) => h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); show(r); } }, 'Xem & xử lý') }],
      rows, empty: '🎉 Không có phiếu nào cần kiểm tra', onRow: show }));
  }

  App.register('review', {
    async render(v) {
      const groups = await api('import.pendingGroups'); const rows = groups.flatMap((g) => g.rows);
      v.append(App.pageHead('Cần kiểm tra', 'Phiếu cùng số phiếu + nơi xuất nhưng dữ liệu khác — không bao giờ tự ghi đè'), reviewCard(rows, () => { App.refreshInfo(); App.reload(); }));
    },
  });

  // ------------------------------------------------------------ Lịch sử import
  App.register('batches', {
    async render(v) {
      const rows = await api('import.batches');
      const rowsOf = async (b) => {
        const d = await api('import.batchRows', { batchId: b.id, limit: 300 });
        const saved = JSON.parse(b.mapping_json || 'null');
        const config = saved?.version === 1 ? saved : null;
        const reading = h('div', {}, readingBadge(config ? templateName(config) : 'Cách ghép của lô cũ'),
          h('p', { class: 'muted' }, `Sheet ${b.sheet_name || '—'} · Dòng tiêu đề ${b.header_row || '—'}`,
            config ? ` · ${config.headerRows} dòng · Đơn vị dự phòng ${config.fallbackUnit === 't' ? 'tấn' : config.fallbackUnit || 'theo file'}` : ''),
          config && h('p', { class: 'muted' }, Object.entries(config.columns).map(([key, title]) => `${FIELDS.find(([field]) => field === key)?.[1] || key} → ${title}`).join(' · ')),
          saved && App.can('nhap') && h('button', { class: 'btn ghost sm', 'data-batch-read': '1', onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
              const file = await App.pickFile();
              if (!file) return;
              const result = await call('import.batchRead', { batchId: b.id, ...file });
              if (result) App.modal({ title: `Đọc lại file của lô #${b.id}`, wide: true, body: trial(result), actions: [{ label: 'Đóng' }] });
            } finally { button.disabled = false; }
          } }, 'Đọc lại file nguồn theo cách đọc của lô…'));
        App.modal({ title: `Lô #${b.id} — ${b.file_name}`, wide: true, actions: [{ label: 'Đóng', primary: false }],
          body: h('div', {}, reading, table({ columns: [{ key: 'source_row', label: 'Dòng', num: true }, { key: 'so_phieu', label: 'Số phiếu', mono: true }, { key: 'bien_so', label: 'Biển số', mono: true }, { key: 'hanh_dong', label: 'Hành động' }, { key: 'trang_thai_phieu', label: 'Phiếu', tag: true }], rows: d.rows })) });
      };
      const undo = async (b) => { const reason = await App.promptBox('Hoàn tác lô import', 'Lý do hoàn tác'); if (!reason) return; const x = await call('import.undo', { batchId: b.id, reason }, 'Đã hoàn tác lô'); if (x) App.reload(); };
      v.append(App.pageHead('Lịch sử import', 'Mỗi lần import là một lô; có thể hoàn tác cả lô nếu chưa chốt kỳ'),
        h('div', { class: 'card' }, table({ columns: [{ key: 'id', label: 'Lô', num: true }, { key: 'import_time', label: 'Thời gian', fmt: 'dt' }, { key: 'file_name', label: 'File' }, { key: 'total_rows', label: 'Dòng', fmt: 'int' }, { key: 'inserted_rows', label: 'Mới', fmt: 'int' },
          { key: 'duplicate_rows', label: 'Trùng', fmt: 'int' }, { key: 'conflict_rows', label: 'Cần kiểm tra', fmt: 'int' }, { key: 'error_rows', label: 'Lỗi', fmt: 'int' }, { key: 'trang_thai', label: 'Trạng thái', tag: true },
          { key: 'x', label: '', render: (b) => h('span', { class: 'row gap-s' }, h('button', { class: 'btn ghost sm', onclick: () => rowsOf(b) }, 'Chi tiết'), b.trang_thai === 'COMMITTED' ? h('button', { class: 'btn danger sm', 'data-act': 'undo-batch', onclick: () => undo(b) }, 'Hoàn tác') : null) }], rows, empty: 'Chưa import lần nào' })));
    },
  });
})();
