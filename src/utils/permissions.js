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
    'recon.results', 'lock.list', 'lock.preview', 'price.fuelPeriods', 'price.sheet', 'price.calc', 'template.tickets', 'template.vehicles', 'export.tickets', 'export.statement',
    'export.statementPdf', 'export.report', 'export.reportPdf', 'export.timeline', 'export.priceSheet', 'export.priceSheetPdf', 'export.tauSummary', 'export.tauSummaryPdf', 'export.detail',
    'export.detailPdf', 'forms.preview', 'export.recon', 'backup.list', 'auth.me', 'auth.logout', 'auth.changePassword'],
  nhap: ['cost.recalc', 'alerts.setStatus', 'catalog.create', 'catalog.update', 'catalog.remove', 'import.open', 'import.check', 'import.sheetInfo', 'import.preview', 'import.previewRows',
    'import.commit', 'import.issuesXlsx', 'import.cancel', 'vehicles.importPreview', 'vehicles.importCommit', 'tickets.update', 'tickets.remove', 'recon.open', 'recon.sheetInfo', 'recon.run',
    'price.previewFuel', 'price.createFuelPeriod', 'fuel.importPreview', 'backup.now', 'backup.export'],
  duyet: ['import.resolve', 'import.resolveMany', 'import.undo', 'lock.create', 'lock.unlock', 'recon.resolve', 'recon.weight', 'price.approveFuel', 'price.removeFuelPeriod', 'price.remove',
    'price.createVersion', 'price.applySheet', 'fuel.importCommit'],
  admin: ['settings.set', 'seed.loadSample', 'initial.load', 'backup.restore', 'auth.disable', 'auth.users', 'auth.createUser', 'auth.updateUser', 'auth.resetPassword'],
};
const CHANNEL_PERM = new Map();
for (const [perm, list] of Object.entries(BY_PERM)) for (const c of list) CHANNEL_PERM.set(c, perm);

const permissionFor = (channel) => (PUBLIC.has(channel) ? 'public' : CHANNEL_PERM.get(channel) || 'admin');
const roleAllows = (role, perm) => perm === 'public' || (ROLE_PERMS[role] || []).includes(perm);

module.exports = { ROLE_PERMS, ROLE_LABEL, PUBLIC, CHANNEL_PERM, permissionFor, roleAllows };
