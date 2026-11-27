(function () {
  'use strict';
  const { h, api, call, table, toast, modal } = App;

  const field = (label, input) => h('label', { class: 'field' }, label, input);
  const sel = (roles, value) => { const s = h('select', {}, Object.entries(roles).map(([k, v]) => h('option', { value: k }, v))); if (value) s.value = value; return s; };

  function openEnable(onChanged) {
    const name = h('input', { autocomplete: 'username', required: true, maxlength: 32 });
    const fullName = h('input', { autocomplete: 'name' });
    const password = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8, maxlength: 128 });
    const repeat = h('input', { type: 'password', autocomplete: 'new-password', required: true, maxlength: 128 });
    const form = h('form', {}, field('Tên đăng nhập quản trị', name), field('Họ và tên (khi tạo mới)', fullName),
      field('Mật khẩu', password), field('Nhập lại mật khẩu', repeat), h('button', { type: 'submit', hidden: true }));
    const dialog = modal({
      title: 'Tạo tài khoản quản trị',
      body: h('div', {}, h('p', { class: 'muted' }, 'Nếu đã có tài khoản quản trị, nhập lại đúng tên và mật khẩu để dùng tiếp.'), form),
      actions: [{ label: 'Quay lại', primary: false }, { label: 'Lưu và bật đăng nhập', onClick: async () => {
        if (!form.reportValidity()) return false;
        if (password.value !== repeat.value) { toast('Hai mật khẩu phải giống nhau', true); repeat.focus(); return false; }
        const args = { ten_dang_nhap: name.value.trim(), ho_ten: fullName.value.trim(), mat_khau: password.value };
        try { await api('auth.enable', args); }
        catch (e) {
          if (e.type !== 'ConfirmRequired') { toast(e.message, true); return false; }
          const choice = await new Promise((resolve) => modal({ title: 'Chỉ có một người duyệt', onClose: () => resolve(null),
            body: h('p', {}, e.message),
            actions: [{ label: 'Hủy', primary: false }, { label: 'Vẫn bật', primary: false, onClick: () => resolve('xac_nhan') },
              { label: 'Bật kèm tự duyệt', onClick: () => resolve('bat_tu_duyet') }] }));
          if (!choice || !(await call('auth.enable', { ...args, [choice]: true }))) return false;
        }
        await App.refreshAuth();
        toast('Đã bật chế độ dùng tài khoản');
        await onChanged();
      } }],
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      dialog.box.querySelector('.actions .btn:last-child').click();
    });
    name.focus();
  }

  function openDisable(onChanged) {
    const name = h('input', { autocomplete: 'username', required: true, maxlength: 32 });
    const password = h('input', { type: 'password', autocomplete: 'current-password', required: true, maxlength: 128 });
    const form = h('form', {}, field('Tên đăng nhập quản trị', name), field('Mật khẩu quản trị', password), h('button', { type: 'submit', hidden: true }));
    const dialog = modal({
      title: 'Chuyển sang một người sử dụng',
      body: h('div', {}, h('p', { class: 'muted' }, 'Xác thực lại bằng tài khoản quản trị đang đăng nhập. Ứng dụng sẽ giữ các tài khoản đã tạo.'), form),
      actions: [{ label: 'Hủy', primary: false }, { label: 'Chuyển chế độ', cls: 'danger', onClick: async () => {
        if (!form.reportValidity()) return false;
        if (!(await call('auth.disable', { ten_dang_nhap: name.value.trim(), mat_khau: password.value }, 'Đã chuyển sang một người sử dụng'))) return false;
        await App.refreshAuth();
        await onChanged();
      } }],
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      dialog.box.querySelector('.actions .btn:last-child').click();
    });
    name.focus();
  }

  function modeCard(status, onChanged) {
    const label = status.enabled ? 'Dùng tài khoản đăng nhập' : 'Một người sử dụng';
    return h('div', { class: 'card', 'data-account-mode': '1' }, h('h3', {}, 'Chế độ đăng nhập'),
      h('p', {}, 'Đang dùng ', h('strong', { class: 'tag green' }, label)),
      h('p', { class: 'muted' }, status.enabled ? 'Mỗi người đăng nhập bằng tài khoản được cấp.' : 'Mở ứng dụng trực tiếp, không cần tên đăng nhập hoặc mật khẩu.'),
      status.enabled
        ? status.user?.vai_tro === 'ADMIN' && h('button', { class: 'btn ghost', 'data-act': 'disable-auth', onclick: () => openDisable(onChanged) }, 'Chuyển sang một người sử dụng')
        : h('button', { class: 'btn', 'data-act': 'enable-auth', onclick: () => openEnable(onChanged) }, 'Dùng tài khoản đăng nhập'));
  }

  App.accountModeCard = modeCard;
  App.firstRunAuth = (onDone) => {
    const complete = async () => { overlay.remove(); await onDone(); };
    const skip = h('button', { class: 'btn ghost', 'data-act': 'skip-account-setup', onclick: async () => {
      skip.disabled = true;
      if (await call('auth.skipSetup', {})) await complete();
      else skip.disabled = false;
    } }, 'Bỏ qua');
    const useAccount = h('button', { class: 'btn', 'data-act': 'start-account-setup', onclick: () => openEnable(complete) }, 'Dùng tài khoản đăng nhập');
    const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'account-setup-heading', 'data-account-setup': '1' },
      h('div', { class: 'modal' }, h('h2', { id: 'account-setup-heading' }, 'Chọn cách sử dụng VC Cost'),
        h('h3', {}, 'Một người sử dụng'),
        h('p', { class: 'muted' }, 'Bấm Bỏ qua để mở ứng dụng trực tiếp. Bạn có thể bật đăng nhập sau trong Cài đặt.'),
        skip, h('h3', { style: { marginTop: '18px' } }, 'Dùng tài khoản đăng nhập'),
        h('p', { class: 'muted' }, 'Tạo tài khoản quản trị và mật khẩu để bắt đầu. Quản trị có thể thêm tài khoản cho những người khác.'),
        useAccount));
    document.body.append(overlay);
    skip.focus();
  };

  App.register('users', {
    async render(v) {
      v.append(App.pageHead('Người dùng & phân quyền', 'Tùy chọn: dùng một người (không đăng nhập) hoặc bật phân quyền theo vai trò'));
      const card = h('div', { class: 'card' }); v.append(card);
      const draw = async () => {
        const a = await App.refreshAuth(); App.clear(card);
        const roleRows = h('ul', { class: 'muted' }, h('li', {}, 'Quản trị: toàn quyền, quản lý người dùng, cài đặt, khôi phục dữ liệu'), h('li', {}, 'Người duyệt: duyệt xung đột/hoàn tác import, chốt/mở khóa kỳ, bảng giá, đối chiếu'),
          h('li', {}, 'Người nhập liệu: import, sửa/xóa phiếu, danh mục, sao lưu'), h('li', {}, 'Chỉ xem: xem và xuất báo cáo'));
        card.append(modeCard(a, draw), roleRows);
        if (!a.enabled || !a.user) return;
        const own = h('button', { class: 'btn ghost sm', 'data-act': 'change-pw', onclick: () => {
          const cu = h('input', { type: 'password', autocomplete: 'current-password' }), moi = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Ít nhất 8 ký tự' });
          modal({ title: 'Đổi mật khẩu của tôi', body: h('div', {}, field('Mật khẩu hiện tại', cu), field('Mật khẩu mới', moi)),
            actions: [{ label: 'Hủy', primary: false }, { label: 'Đổi', onClick: async () => { if (!(await call('auth.changePassword', { cu: cu.value, moi: moi.value }, 'Đã đổi mật khẩu'))) return false; } }] });
        } }, 'Đổi mật khẩu của tôi');
        card.append(own);
        if (a.user.vai_tro !== 'ADMIN') return;
        const users = await api('auth.users');
        const roles = a.roles;
        const edit = (u) => {
          const ht = h('input', { value: u.ho_ten }), vt = sel(roles, u.vai_tro), tt = h('select', {}, h('option', { value: 'ACTIVE' }, 'Đang hoạt động'), h('option', { value: 'INACTIVE' }, 'Khóa'));
          tt.value = u.trang_thai;
          modal({ title: `Sửa ${u.ten_dang_nhap}`, body: h('div', {}, field('Họ và tên', ht), field('Vai trò', vt), field('Trạng thái', tt)),
            actions: [{ label: 'Hủy', primary: false }, { label: 'Lưu', onClick: async () => { if (!(await App.callConfirm('auth.updateUser', { id: u.id, ho_ten: ht.value, vai_tro: vt.value, trang_thai: tt.value }, 'Đã lưu', 'Số người duyệt'))) return false; draw(); } }] });
        };
        const reset = (u) => {
          const mk = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Ít nhất 8 ký tự' });
          modal({ title: `Đặt lại mật khẩu cho ${u.ten_dang_nhap}`, body: field('Mật khẩu mới', mk), actions: [{ label: 'Hủy', primary: false }, { label: 'Đặt lại', onClick: async () => { if (!(await call('auth.resetPassword', { id: u.id, mat_khau: mk.value }, 'Đã đặt lại mật khẩu'))) return false; } }] });
        };
        const add = () => {
          const ten = h('input', { placeholder: 'vd: nguyenvan.a' }), ht = h('input', { placeholder: 'Họ và tên' }), vt = sel(roles, 'NHAP'), mk = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Ít nhất 8 ký tự' });
          modal({ title: 'Thêm người dùng', body: h('div', {}, field('Tên đăng nhập', ten), field('Họ và tên', ht), field('Vai trò', vt), field('Mật khẩu ban đầu', mk)),
            actions: [{ label: 'Hủy', primary: false }, { label: 'Thêm', onClick: async () => { if (!(await call('auth.createUser', { ten_dang_nhap: ten.value.trim(), ho_ten: ht.value.trim(), vai_tro: vt.value, mat_khau: mk.value }, 'Đã thêm'))) return false; draw(); } }] });
        };
        card.append(h('div', { class: 'row', style: { margin: '12px 0' } }, h('b', {}, `${users.length} người dùng`), h('span', { class: 'grow' }), h('button', { class: 'btn', 'data-act': 'add-user', onclick: add }, '+ Thêm người dùng')),
          table({ columns: [{ key: 'ten_dang_nhap', label: 'Tên đăng nhập', mono: true }, { key: 'ho_ten', label: 'Họ tên' }, { key: 'vai_tro', label: 'Vai trò', render: (u) => roles[u.vai_tro] || u.vai_tro },
            { key: 'trang_thai', label: 'Trạng thái', tag: true }, { key: 'dang_nhap_cuoi', label: 'Đăng nhập cuối', fmt: 'dt' },
            { key: '_a', label: '', render: (u) => h('span', { class: 'row gap-s' }, h('button', { class: 'btn ghost sm', onclick: () => edit(u) }, 'Sửa'), h('button', { class: 'btn ghost sm', onclick: () => reset(u) }, 'Đặt lại mật khẩu')) }], rows: users }));
      };
      await draw();
    },
  });
})();
