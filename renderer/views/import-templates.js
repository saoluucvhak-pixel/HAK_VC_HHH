'use strict';
(() => {
  const { h, fmt, table, call } = App;
  const FIELDS = [
    ['so_phieu', 'Số phiếu'], ['bien_so', 'Biển số *'], ['ngay_gio_can_1', 'Ngày giờ cân 1 *'],
    ['gio_can_1', 'Giờ cân 1 (cột riêng)'], ['ngay_gio_can_2', 'Ngày giờ cân 2'], ['gio_can_2', 'Giờ cân 2 (cột riêng)'], ['kl_hang_kg', 'KL hàng'], ['can_lan_1', 'Cân lần 1'],
    ['can_lan_2', 'Cân lần 2'], ['weight_unit', 'Đơn vị khối lượng'], ['noi_xuat', 'Kho / nơi xuất'],
    ['noi_den', 'Nơi đến'], ['cong_ty_vc', 'Đơn vị vận chuyển (nguồn)'], ['ghi_chu', 'Ghi chú'],
  ];
  const field = (label, control) => h('label', { class: 'field' }, label, control);
  const option = (value, label, selected) => h('option', { value, selected }, label);
  const units = (value) => [
    option('', 'Theo tiêu đề / dữ liệu', !value), option('kg', 'kg', value === 'kg'), option('t', 'tấn', value === 't'),
  ];
  const titleKey = (value) => HAKCore.sf.fold(value).replace(/\s+/g, ' ');
  const kg = (value) => fmt.kgDecimal(value) + ' kg';

  function trial(result) {
    const { sample, summary, readKg, fileKg, deltaKg, totalRow, problems } = result;
    const weights = [
      ['can_lan_1', 'Cân lần 1 (kg)'], ['can_lan_2', 'Cân lần 2 (kg)'],
    ].filter(([key]) => sample.some((row) => row[key] != null))
      .map(([key, label]) => ({ key, label, num: true, render: (row) => fmt.kgDecimal(row[key]) }));
    const hasCan2 = result.readConfig?.mapping?.ngay_gio_can_2 != null;
    const hasDestination = result.readConfig?.mapping?.noi_den != null;
    return h('div', { 'data-template-trial': '1' },
      h('h3', {}, 'Kết quả đọc thử & Ghép dữ liệu'),
      h('p', { class: 'chk ' + (summary.dong_loi ? 'warn' : 'ok') },
        `${fmt.int(summary.tong_dong)} phiếu · ${kg(readKg)} · ${fmt.int(summary.dong_loi)} dòng có lỗi`),
      totalRow && h('p', { class: deltaKg ? 'chk warn' : 'muted' }, fileKg === null
        ? `Dòng Excel ${totalRow} có tổng công bố nhưng không đọc được giá trị.`
        : `Tổng công bố (dòng Excel ${totalRow}) ${kg(fileKg)} · Chênh lệch (đọc − công bố) ${kg(deltaKg)}`),
      problems.map((problem) => h('p', { class: 'chk ' + (problem.level === 'error' ? 'bad' : 'warn') }, problem.text)),
      summary.ly_do.length > 0 && h('ul', { class: 'chk-list' }, summary.ly_do.map((reason) => h('li', {},
        `${reason.text} · ${reason.so_dong} dòng, bắt đầu tại dòng Excel ${reason.dong_dau}`))),
      sample.length > 0 && table({ columns: [
        { key: 'source_row', label: 'Dòng Excel', num: true }, { key: 'so_phieu', label: 'Số phiếu', mono: true },
        { key: 'ngay_gio_can_1', label: 'Ngày giờ cân 1', fmt: 'dt' },
        ...(hasCan2 ? [{ key: 'ngay_gio_can_2', label: 'Ngày giờ cân 2', fmt: 'dt' }] : []),
        { key: 'bien_so', label: 'Biển số' },
        { key: 'kl_hang_kg', label: 'KL (kg)', num: true, render: (row) => fmt.kgDecimal(row.kl_hang_kg) },
        ...weights, { key: 'noi_xuat_goc', label: 'Kho' },
        ...(hasDestination ? [{ key: 'noi_den_nhan_dang', label: 'Nơi đến', render: (row) => row.noi_den_nhan_dang || row.noi_den_goc }] : []),
        ...(sample.some((row) => row.cong_ty_vc_nguon) ? [{ key: 'cong_ty_vc_nguon', label: 'Đơn vị vận chuyển' }] : []),
        { key: 'ghi_chu', label: 'Ghi chú' },
      ], rows: sample }));
  }

  function card(initial) {
    let config = initial || { defaultId: null, templates: [] };
    let draft = null, opened = null, info = null, sheet = null, mapping = {}, result = null;
    let busy = false;
    let overrides = new Map(), columnIssues = new Map();
    const root = h('section', { class: 'card', 'data-excel-templates': '1' });
    const btn = (label, onclick, attrs = {}) => h('button', { class: 'btn ghost sm', onclick, disabled: busy, ...attrs }, label);
    const act = async (options) => {
      const response = await call('import.templates.update', options);
      if (response) config = response;
      return response;
    };
    async function clearFile() {
      if (opened) await call('import.cancel', { token: opened.token });
      opened = null;
      info = null;
      result = null;
    }
    async function edit(item, copy = false) {
      await clearFile();
      draft = item ? { ...item, id: copy ? undefined : item.id, name: copy ? `${item.name} (bản sao)`.slice(0, 120) : item.name }
        : { name: '', headerRow: null, headerRows: 1, fallbackUnit: '', columns: {} };
      overrides = new Map(Object.entries(draft.columns));
      columnIssues.clear();
      draw();
      root.querySelector('[data-template-editor]')?.scrollIntoView({ block: 'nearest' });
    }
    async function loadSheet() {
      info = await call('import.sheetInfo', { token: opened.token, sheetName: sheet,
        headerRow: draft.headerRow, headerRows: draft.headerRows, templateId: null });
      mapping = { ...info?.mapping };
      columnIssues.clear();
      result = null;
      if (!info) return;
      draft.headerRow = info.headerRow;
      for (const [name, title] of overrides) {
        delete mapping[name];
        if (title === null) continue;
        const matches = info.headers.filter((col) => titleKey(col.text) === titleKey(title));
        if (matches.length === 1) mapping[name] = matches[0].index;
        else columnIssues.set(name, matches.length ? `Cột “${title}” bị trùng` : `Thiếu cột “${title}”`);
      }
    }
    function draftConfig() {
      const columns = {};
      for (const [key, index] of Object.entries(mapping)) columns[key] = info.headers[index].text;
      return { name: draft.name.trim(), headerRow: draft.headerRow, headerRows: draft.headerRows, fallbackUnit: draft.fallbackUnit, columns,
        layout: { sheetName: sheet, positions: { ...mapping } } };
    }
    const lock = (fn) => async (...args) => {
      if (busy) return;
      busy = true;
      try { await fn(...args); } finally { busy = false; draw(); }
    };
    function draw() {
      const defaultName = config.templates.find((item) => item.id === config.defaultId)?.name || 'Tự nhận diện';
      App.clear(root).append(h('h3', {}, 'Mẫu nhập Excel Doanh nghiệp'),
        h('p', { class: 'muted', style: { marginBottom: '8px' } }, 'Tạo mẫu Excel cho phép tùy biến tên cột, vị trí cột và định dạng theo mẫu của đối tác/nhà cung cấp. Điền dữ liệu vào file mẫu rồi tải lên tại màn hình Import.'),
        h('p', { 'data-template-default': '1' }, 'Mặc định khi nhập phiếu cân ', h('strong', { class: 'tag green' }, defaultName)),
        h('div', { class: 'row gap-s', style: { flexWrap: 'wrap', marginBottom: '12px' } },
          btn('➕ Tạo mẫu mới', lock(() => edit(null)), { class: 'btn sm', 'data-template-new': '1' }),
          config.defaultId && btn('Dùng Tự nhận diện', lock(() => act({ action: 'default', id: null }))),
          btn('⬇ Tải Mẫu Phiếu cân chuẩn', () => App.exportTemplate('template.tickets', {})),
          btn('⬇ Mẫu Danh sách xe', () => App.exportTemplate('template.vehicles', {})),
          btn('⬇ Mẫu Bảng kê đối tác', () => App.exportTemplate('template.partner', {})),
          btn('⬇ Mẫu Giá dầu', () => App.exportTemplate('template.fuel', {}))),
        config.templates.length ? table({ columns: [
          { key: 'name', label: 'Tên mẫu' },
          { key: 'id', label: 'Trạng thái', render: (item) => item.id === config.defaultId ? h('span', { class: 'tag green' }, 'Mặc định') : '' },
          { key: 'actions', label: 'Thao tác', render: (item) => h('div', { class: 'row gap-s' },
            btn('Sửa', lock(() => edit(item))), btn('Sao chép', lock(() => edit(item, true))),
            btn('Tải file mẫu', () => App.exportTemplate('template.configuredTickets', { id: item.id }), { 'data-template-export': '1' }),
            btn('Xóa', lock(async () => {
              if (await App.confirmBox('Xóa mẫu nhập', `Xóa mẫu “${item.name}”?`, 'Xóa')) {
                if (await act({ action: 'delete', id: item.id }) && draft?.id === item.id) { draft = null; await clearFile(); }
              }
            })),
            btn('Đặt mặc định', lock(() => act({ action: 'default', id: item.id })), { disabled: busy || item.id === config.defaultId })),
          },
        ], rows: config.templates }) : null);
      if (!draft) return;
      const updateSave = () => {
        result = null;
        root.querySelector('[data-template-trial]')?.remove();
        root.querySelector('[data-template-save]').disabled = true;
        root.querySelector('[data-template-check]').disabled = columnIssues.size > 0;
      };
      const name = h('input', { value: draft.name, maxlength: 120, oninput: (event) => {
        draft.name = event.target.value;
        if (result) root.querySelector('[data-template-save]').disabled = !draft.name.trim() || result.blocking;
      } });
      const fileButton = btn(opened ? 'Chọn file mẫu khác…' : 'Chọn file mẫu…', lock(async () => {
        const file = await App.pickFile('.xlsx,.csv');
        if (!file) return;
        const response = await call('import.open', { ...file, sample: true });
        if (!response) return;
        await clearFile();
        opened = response;
        sheet = opened.sheets.some((item) => item.name === draft.layout?.sheetName) ? draft.layout.sheetName : opened.suggestedSheet;
        if (draft.headerRow == null) draft.headerRow = Math.max(0, opened.sheets.find((item) => item.name === sheet)?.headerRow ?? 0);
        await loadSheet();
      }), { 'data-template-file': '1' });
      const save = btn('Lưu mẫu', lock(async () => {
        if (!result || result.blocking || !draft.name.trim()) return;
        if (await act({ action: 'save', id: draft.id, template: draftConfig() })) {
          const saved = config.templates.find((item) => item.name === draft.name.trim());
          draft = { ...saved };
          App.toast('Đã lưu mẫu nhập Excel');
        }
      }), { class: 'btn sm', 'data-template-save': '1', disabled: busy || !result || result.blocking || !draft.name.trim() });
      const section = (title, ...contents) => h('section', { class: 'excel-template-step' }, h('h4', {}, title), ...contents);
      const editor = h('div', { class: 'excel-template-editor', 'data-template-editor': '1' },
        h('h3', {}, draft.id ? 'Sửa mẫu nhập Excel' : 'Tạo mẫu nhập Excel'));
      const changeSheet = (update) => lock(async (event) => {
        update(event.target.value);
        for (const control of editor.querySelectorAll('button, input, select')) control.disabled = true;
        await loadSheet();
      });
      const source = h('div', { class: 'excel-template-source' }, fileButton,
        opened ? h('span', { class: 'muted' }, opened.fileName) : h('span', { class: 'muted' }, 'Chọn tệp .xlsx hoặc .csv có dòng tiêu đề và dữ liệu mẫu.'));
      const sheetFields = opened ? h('div', { class: 'form-grid' },
        field('Sheet mẫu', h('select', { onchange: changeSheet((value) => { sheet = value; }) },
          opened.sheets.map((item) => option(item.name, item.name, item.name === sheet)))),
        field('Dòng cuối của tiêu đề (từ 1)', h('input', { type: 'number', min: draft.headerRows, value: draft.headerRow + 1,
          onchange: changeSheet((value) => { draft.headerRow = Number(value) - 1; }) })),
        field('Số dòng tiêu đề', h('select', { onchange: changeSheet((value) => {
          draft.headerRows = Number(value);
          draft.headerRow = Math.max(draft.headerRows - 1, draft.headerRow);
        }) }, [1, 2].map((count) => option(count, `${count} dòng`, count === draft.headerRows))))) : null;
      editor.append(section('1. Chọn tệp và tiêu đề', source, ...(sheetFields ? [sheetFields] : [])));
      if (info) {
        const headerText = (key) => info.headers.find((column) => column.index === mapping[key])?.text || '—';
        const sampleValue = (key) => {
          const idx = mapping[key];
          if (idx == null || !info.sample?.[0]) return '—';
          const val = info.sample[0][idx];
          return val != null ? String(val) : '—';
        };
        const mappingTable = h('div', { class: 'excel-template-table' }, h('table', { class: 't' },
          h('thead', {}, h('tr', {}, ['Trường phiếu cân', 'Cột nguồn trong Excel', 'Tiêu đề lưu theo mẫu', 'Mẫu dòng 1'].map((label) => h('th', { scope: 'col' }, label)))),
          h('tbody', {}, FIELDS.map(([key, label]) => {
            const issue = columnIssues.get(key);
            const chosen = h('td', { 'data-template-heading': key }, issue || headerText(key));
            const sampleCell = h('td', { class: 'muted mono sm' }, sampleValue(key));
            const select = h('select', { 'aria-label': label, 'data-template-map': key, onchange: (event) => {
              if (event.target.value === '') {
                delete mapping[key];
                overrides.set(key, null);
              } else {
                mapping[key] = Number(event.target.value);
                overrides.set(key, headerText(key));
              }
              columnIssues.delete(key);
              chosen.textContent = headerText(key);
              sampleCell.textContent = sampleValue(key);
              updateSave();
            } }, issue && h('option', { value: 'unresolved', disabled: true, selected: true }, '— cần ghép lại —'),
              option('', '— bỏ qua —', !issue && mapping[key] == null), info.headers.filter((col) => col.text)
              .map((col) => option(col.index, `${col.index + 1}. ${col.text}`, mapping[key] === col.index)));
            return h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, select), chosen, sampleCell);
          }))));
        const helpBox = h('div', { class: 'card-subtle', style: { padding: '10px 14px', marginBottom: '10px', background: 'var(--zebra)', borderLeft: '3px solid var(--brand)', fontSize: '13px' } },
          h('strong', { style: { color: 'var(--brand)' } }, '💡 Hướng dẫn ghép trường ngày giờ & khối lượng:'),
          h('ul', { style: { margin: '4px 0 0', paddingLeft: '18px', lineHeight: '1.5' } },
            h('li', {}, h('b', {}, 'Ngày giờ cân: '), 'Nếu file có cột chung ngày giờ (VD: 05/10/2026 08:30), chọn ở ', h('em', {}, 'Ngày giờ cân 1'), '. Nếu tách riêng 2 cột (ngày riêng, giờ riêng), hãy chọn cột ngày ở ', h('em', {}, 'Ngày giờ cân 1'), ' và cột giờ ở ', h('em', {}, 'Giờ cân 1 (cột riêng)'), '. Phần mềm tự động ghép chuẩn.'),
            h('li', {}, h('b', {}, 'Khối lượng: '), 'Ghép vào ', h('em', {}, 'KL hàng'), '; hoặc ghép cả ', h('em', {}, 'Cân lần 1'), ' và ', h('em', {}, 'Cân lần 2'), ' để tự tính hiệu số.'),
            h('li', {}, h('b', {}, 'Số phiếu & biển số: '), 'Bắt buộc ghép Biển số. Số phiếu nếu bỏ qua sẽ được tự động cấp mã duy nhất.')
          )
        );
        editor.append(section('2. Ghép cột',
          h('div', { class: 'form-grid' }, field('Tên mẫu', name), field('Đơn vị dự phòng', h('select', { onchange: (event) => { draft.fallbackUnit = event.target.value; updateSave(); } }, units(draft.fallbackUnit)))),
          helpBox,
          mappingTable));
        editor.append(section('3. Đọc thử và đối chiếu', btn('Đọc thử', lock(async () => {
          result = await call('import.check', { token: opened.token, sheetName: sheet, draft: { ...draftConfig(), name: draft.name.trim() || 'Mẫu đang sửa' } });
        }), { 'data-template-check': '1', disabled: busy || columnIssues.size > 0 }), ...(result ? [trial(result)] : [])));
      }
      editor.append(h('div', { class: 'row end' }, btn('Đóng', lock(async () => { draft = null; await clearFile(); })), save));
      root.append(editor);
    }
    draw();
    return root;
  }

  App.excelTemplates = { FIELDS, units, trial, card };
})();
