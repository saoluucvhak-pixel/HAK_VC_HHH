'use strict';
/**
 * Bảng quyền theo kênh API (nguồn DUY NHẤT; test bảo đảm mọi kênh trong handlers đều có mặt ở đây).
 * Quyền: xem < nhap < duyet < admin. Vai trò: XEM = xem; NHAP = xem+nhap; DUYET = xem+nhap+duyet; ADMIN = tất cả.
 * Kênh lạ/không khai báo → admin (từ chối theo mặc định).
 */
const ROLE_PERMS = { XEM: ['xem'], NHAP: ['xem', 'nhap'], DUYET: ['xem', 'nhap', 'duyet'], ADMIN: ['xem', 'nhap', 'duyet', 'admin'] };
const ROLE_LABEL = { XEM: 'Chỉ xem & xuất báo cáo', NHAP: 'Người nhập liệu', DUYET: 'Người duyệt', ADMIN: 'Quản trị' };

const PUBLIC = new Set(['auth.status', 'auth.login', 'auth.enable']);
const BY_PERM = {
  xem: ['app.info', 'settings.all', 'audit.list', 'alerts.list', 'alerts.types', 'catalog.config', 'catalog.list', 'catalog.get', 'catalog.options', 'import.batches', 'import.batchRows',
    'import.pending', 'workflow.todo', 'tickets.count', 'tickets.periods', 'tickets.list', 'tickets.ids', 'tickets.removePreview', 'tickets.get', 'tickets.explain', 'reports.byVehicle',
    'reports.byCarrier', 'reports.byOrigin', 'reports.byDate', 'reports.byDot', 'reports.timeline', 'reports.statement', 'reports.statements', 'reports.dashboard', 'recon.batches',
    'recon.results', 'lock.list', 'lock.preview', 'price.fuelPeriods', 'price.sheet', 'price.calc', 'price.previewApply', 'template.tickets', 'template.vehicles', 'export.tickets', 'export.statement',
    'export.statementPdf', 'export.report', 'export.reportPdf', 'export.timeline', 'export.priceSheet', 'export.priceSheetPdf', 'export.tauSummary', 'export.tauSummaryPdf', 'export.detail',
    'export.detailPdf', 'forms.preview', 'export.recon', 'backup.list', 'system.integrity', 'auth.me', 'auth.logout', 'auth.changePassword'],
  nhap: ['cost.recalc', 'alerts.setStatus', 'catalog.create', 'catalog.update', 'catalog.remove', 'import.open', 'import.check', 'import.sheetInfo', 'import.preview', 'import.previewRows',
    'import.commit', 'import.issuesXlsx', 'import.cancel', 'vehicles.importPreview', 'vehicles.importCommit', 'tickets.update', 'tickets.remove', 'recon.open', 'recon.sheetInfo', 'recon.run',
    'price.previewFuel', 'price.createFuelPeriod', 'backup.now', 'backup.export'],
  duyet: ['tickets.approve', 'import.resolve', 'import.resolveMany', 'import.undo', 'lock.create', 'lock.unlock', 'recon.resolve', 'recon.weight', 'price.approveFuel', 'price.removeFuelPeriod', 'price.remove',
    'price.createVersion', 'price.applySheet', 'fuel.importPreview', 'fuel.importCommit'],
  admin: ['settings.set', 'seed.loadSample', 'initial.load', 'backup.restore', 'auth.disable', 'auth.users', 'auth.createUser', 'auth.updateUser', 'auth.resetPassword'],
};
const CHANNEL_PERM = new Map();
for (const [perm, list] of Object.entries(BY_PERM)) for (const c of list) CHANNEL_PERM.set(c, perm);

/**
 * Quyền THEO BẢNG cho catalog.create/update/remove: bảng ảnh hưởng trực tiếp tới tiền cần quyền cao hơn mặc định ('nhap').
 * Bảng giá và giá dầu = 'duyet' (cùng mức với price.createVersion, price.applySheet, fuel.importCommit). Bảng khác giữ 'nhap'.
 */
const TABLE_PERM = { bang_gia_van_chuyen: 'duyet', gia_dau: 'duyet' };
const TABLE_CHANNELS = new Set(['catalog.create', 'catalog.update', 'catalog.remove']);
const RANK = { xem: 1, nhap: 2, duyet: 3, admin: 4 };

const permissionFor = (channel, args) => {
  if (PUBLIC.has(channel)) return 'public';
  const base = CHANNEL_PERM.get(channel) || 'admin';
  if (TABLE_CHANNELS.has(channel) && args && typeof args.table === 'string' && Object.hasOwn(TABLE_PERM, args.table)) {
    return RANK[TABLE_PERM[args.table]] > RANK[base] ? TABLE_PERM[args.table] : base;
  }
  return base;
};
const roleAllows = (role, perm) => perm === 'public' || (ROLE_PERMS[role] || []).includes(perm);

module.exports = { ROLE_PERMS, ROLE_LABEL, PUBLIC, CHANNEL_PERM, TABLE_PERM, TABLE_CHANNELS, permissionFor, roleAllows };
