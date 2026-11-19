(function () {
  'use strict';
  const { h, api, call, table, toast, modal, confirmBox } = App;

  const field = (label, input) => h('label', { class: 'field' }, label, input);
  const sel = (roles, value) => { const s = h('select', {}, Object.entries(roles).map(([k, v]) => h('option', { value: k }, v))); if (value) s.value = value; return s; };

  App.register('users', {
    async render(v) {
      const st = await App.refreshAuth();
      v.append(App.pageHead('Người dùng & phân quyền', 'Tùy chọn: dùng một người (không đăng nhập) hoặc bật phân quyền theo vai trò'));
      const card = h('div', { class: 'card' }); v.append(card);
      const draw = async () => {
        const a = await App.refreshAuth(); App.clear(card);
        const roleRows = h('ul', { class: 'muted' }, h('li', {}, 'Quản trị: toàn quyền, quản lý người dùng, cài đặt, khôi phục dữ liệu'), h('li', {}, 'Người duyệt: duyệt xung đột/hoàn tác import, chốt/mở khóa kỳ, bảng giá, đối chiếu'),
          h('li', {}, 'Người nhập liệu: import, sửa/xóa phiếu, danh mục, sao lưu'), h('li', {}, 'Chỉ xem: xem và xuất báo cáo'));
        if (!a.enabled) {
          const ten = h('input', { placeholder: 'vd: admin', autocomplete: 'off' }), ht = h('input', { placeholder: 'Họ và tên' }), mk = h('input', { type: 'password', placeholder: 'Ít nhất 8 ký tự', autocomplete: 'new-password' });
          card.append(h('p', {}, h('span', { class: 'tag green' }, 'Đang dùng 1 người — không áp dụng phân quyền')),
            h('p', { class: 'muted' }, 'Bật phân quyền khi có nhiều người cùng dùng máy/dữ liệu: mỗi người một tài khoản, nhật ký ghi rõ ai làm gì. Tài khoản bạn tạo bên dưới là Quản trị đầu tiên.'), roleRows,
            h('div', { class: 'row gap-s' }, field('Tên đăng nhập (quản trị)', ten), field('Họ và tên', ht), field('Mật khẩu', mk)),
            h('button', { class: 'btn', 'data-act': 'enable-auth', onclick: async () => {
              if (!(await confirmBox('Bật phân quyền', 'Từ lần mở sau mọi người phải đăng nhập. Hãy nhớ mật khẩu quản trị (quên mật khẩu: xem hướng dẫn khôi phục trong README). Tiếp tục?', 'Bật', ''))) return;
              if (await call('auth.enable', { ten_dang_nhap: ten.value.trim(), ho_ten: ht.value.trim(), mat_khau: mk.value }, 'Đã bật phân quyền')) { await App.refreshAuth(); await App.refreshInfo(); draw(); }
            } }, 'Bật phân quyền'));
          return;
        }
        card.append(h('p', {}, h('span', { class: 'tag amber' }, 'Đang áp dụng phân quyền'), ' ', `Bạn: ${a.user.ho_ten} (${a.roles[a.user.vai_tro]})`), roleRows);
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
            { key: '_a', label: '', render: (u) => h('span', { class: 'row gap-s' }, h('button', { class: 'btn ghost sm', onclick: () => edit(u) }, 'Sửa'), h('button', { class: 'btn ghost sm', onclick: () => reset(u) }, 'Đặt lại mật khẩu')) }], rows: users }),
          h('div', { style: { marginTop: '16px' } }, h('button', { class: 'btn danger sm', 'data-act': 'disable-auth', onclick: () => {
            const mk = h('input', { type: 'password', autocomplete: 'current-password' });
            modal({ title: 'Tắt phân quyền (quay lại dùng 1 người)', body: h('div', {}, h('p', { class: 'muted' }, 'Tài khoản vẫn được giữ lại; bật lại sau cần đúng mật khẩu quản trị.'), field('Mật khẩu quản trị', mk)),
              actions: [{ label: 'Hủy', primary: false }, { label: 'Tắt', cls: 'danger', onClick: async () => { if (!(await call('auth.disable', { mat_khau: mk.value }, 'Đã tắt phân quyền'))) return false; await App.refreshAuth(); await App.refreshInfo(); draw(); } }] });
          } }, 'Tắt phân quyền')));
      };
      await draw();
    },
  });
})();
