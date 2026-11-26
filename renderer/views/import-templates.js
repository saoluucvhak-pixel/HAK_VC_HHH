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
  const kg = (value) => fmt.kgDecimal(value) + ' kg';

  function trial(result) {
    const { sample, summary, readKg, fileKg, deltaKg, totalRow, problems } = result;
    const weights = [
      ['can_lan_1', 'Cân lần 1 (kg)'], ['can_lan_2', 'Cân lần 2 (kg)'],
    ].filter(([key]) => sample.some((row) => row[key] != null))
      .map(([key, label]) => ({ key, label, num: true, render: (row) => fmt.kgDecimal(row[key]) }));
    return h('div', { 'data-template-trial': '1' },
      h('h3', {}, 'Kết quả đọc thử'),
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
        { key: 'ngay_gio_can_1', label: 'Ngày giờ cân 1', fmt: 'dt' }, { key: 'bien_so', label: 'Biển số' },
        { key: 'kl_hang_kg', label: 'KL (kg)', num: true, render: (row) => fmt.kgDecimal(row.kl_hang_kg) },
        ...weights, { key: 'noi_xuat_goc', label: 'Kho' },
        ...(sample.some((row) => row.cong_ty_vc_nguon) ? [{ key: 'cong_ty_vc_nguon', label: 'Đơn vị vận chuyển' }] : []),
        { key: 'ghi_chu', label: 'Ghi chú' },
      ], rows: sample }));
  }

  function card(initial) {
    let config = initial || { defaultId: null, templates: [] };
    let draft = null, opened = null, info = null, sheet = null, mapping = {}, result = null;
    let busy = false;
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
      draw();
    }
    async function loadSheet(useSaved = false) {
      const response = await call('import.sheetInfo', { token: opened.token, sheetName: sheet,
        headerRow: draft.headerRow, headerRows: draft.headerRows, templateId: null });
      info = response;
      mapping = { ...info?.mapping };
      if (info) draft.headerRow = info.headerRow;
      if (useSaved && info) {
        for (const [name, title] of Object.entries(draft.columns)) {
          const index = info.headers.findIndex((col) => col.text === title);
          if (index >= 0) mapping[name] = index;
        }
      }
      result = null;
    }
    function draftConfig() {
      const columns = {};
      for (const [key, index] of Object.entries(mapping)) columns[key] = info.headers[index].text;
      return { name: draft.name.trim(), headerRow: draft.headerRow, headerRows: draft.headerRows, fallbackUnit: draft.fallbackUnit, columns,
        layout: { sheetName: sheet, positions: { ...mapping } } };
    }
    const lock = (fn) => async () => {
      if (busy) return;
      busy = true;
      try { await fn(); } finally { busy = false; draw(); }
    };
    function draw() {
      const defaultName = config.templates.find((item) => item.id === config.defaultId)?.name || 'Tự nhận diện';
      App.clear(root).append(h('h3', {}, 'Mẫu nhập Excel'),
        h('p', { 'data-template-default': '1' }, 'Mặc định khi nhập phiếu cân ', h('strong', { class: 'tag green' }, defaultName)),
        h('div', { class: 'row gap-s' }, btn('Tạo mẫu', lock(() => edit(null)), { 'data-template-new': '1' }),
          config.defaultId && btn('Dùng Tự nhận diện', lock(() => act({ action: 'default', id: null })))),
        config.templates.length ? table({ columns: [
          { key: 'name', label: 'Tên mẫu' },
          { key: 'id', label: 'Trạng thái', render: (item) => item.id === config.defaultId ? h('span', { class: 'tag green' }, 'Mặc định') : '' },
          { key: 'actions', label: 'Thao tác', render: (item) => h('div', { class: 'row gap-s' },
            btn('Sửa', lock(() => edit(item))), btn('Sao chép', lock(() => edit(item, true))),
            btn('Tải file mẫu', () => App.exportXlsx('template.configuredTickets', { id: item.id }), { 'data-template-export': '1' }),
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
        sheet = opened.suggestedSheet;
        if (draft.headerRow == null) draft.headerRow = Math.max(0, opened.sheets.find((item) => item.name === sheet)?.headerRow ?? 0);
        await loadSheet(true);
      }), { 'data-template-file': '1' });
      const save = btn('Lưu mẫu', lock(async () => {
        if (!result || result.blocking || !draft.name.trim()) return;
        if (await act({ action: 'save', id: draft.id, template: draftConfig() })) {
          const saved = config.templates.find((item) => item.name === draft.name.trim());
          draft = { ...saved };
          App.toast('Đã lưu mẫu nhập Excel');
        }
      }), { class: 'btn sm', 'data-template-save': '1', disabled: busy || !result || result.blocking || !draft.name.trim() });
      const editor = h('div', { class: 'card', 'data-template-editor': '1' },
        h('h3', {}, draft.id ? 'Sửa mẫu nhập' : 'Tạo mẫu nhập'),
        h('div', { class: 'row gap-s' }, fileButton, opened?.fileName));
      if (opened) {
        editor.append(
          h('div', { class: 'form-grid' }, field('Tên mẫu', name),
            field('Sheet mẫu', h('select', { onchange: async (event) => { sheet = event.target.value; await loadSheet(true); draw(); } },
              opened.sheets.map((item) => option(item.name, item.name, item.name === sheet)))),
            field('Dòng cuối của tiêu đề (từ 1)', h('input', { type: 'number', min: draft.headerRows, value: draft.headerRow + 1,
              onchange: async (event) => { draft.headerRow = Number(event.target.value) - 1; await loadSheet(true); draw(); } })),
            field('Số dòng tiêu đề', h('select', { onchange: async (event) => {
              draft.headerRows = Number(event.target.value);
              draft.headerRow = Math.max(draft.headerRows - 1, draft.headerRow);
              await loadSheet(true); draw();
            } }, [1, 2].map((count) => option(count, `${count} dòng`, count === draft.headerRows)))),
            field('Đơn vị dự phòng', h('select', { onchange: (event) => { draft.fallbackUnit = event.target.value; updateSave(); } }, units(draft.fallbackUnit)))),
          h('h3', {}, 'Ghép cột'),
          h('p', { class: 'muted' }, 'Ghép Biển số, Ngày giờ cân 1, và KL hàng hoặc cả hai cột cân. Nếu bỏ qua cột Số phiếu, ứng dụng sẽ tạo mã từ dữ liệu cân.'),
          h('p', { class: 'muted' }, 'Nếu ngày và giờ ở hai cột, ghép cột ngày vào Ngày giờ cân và cột giờ vào Giờ cân (cột riêng) của cùng lần cân. Nếu đã gộp trong một ô, chỉ ghép Ngày giờ cân.'),
          h('div', { class: 'form-grid' }, FIELDS.map(([key, label]) => field(label,
            h('select', { 'data-template-map': key, onchange: (event) => {
              if (event.target.value === '') delete mapping[key]; else mapping[key] = Number(event.target.value);
              updateSave();
            } }, option('', '— bỏ qua —', mapping[key] == null), (info?.headers || []).filter((col) => col.text)
              .map((col) => option(col.index, `${col.index + 1}. ${col.text}`, mapping[key] === col.index)))))));
        editor.append(btn('Đọc thử', lock(async () => {
          result = await call('import.check', { token: opened.token, sheetName: sheet, draft: { ...draftConfig(), name: draft.name.trim() || 'Mẫu đang sửa' } });
        }), { 'data-template-check': '1', disabled: busy || !info }));
        if (result) editor.append(trial(result));
      }
      editor.append(h('div', { class: 'row end' }, btn('Đóng', lock(async () => { draft = null; await clearFile(); })), save));
      root.append(editor);
    }
    draw();
    return root;
  }

  App.excelTemplates = { FIELDS, units, trial, card };
})();
