'use strict';
/** 0.8.4: căn cứ ngày tính giá CAN_1/CAN_2 trong engine — phiếu xuyên đêm dùng bảng giá và đơn vị theo ngày cân đã chọn (trước đó không test nào bắt). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { VehicleResolver } = require('../src/services/VehicleResolver');
const { computeTicket } = require('../src/services/TransportCostEngine');

const rules = [
  { id: 1, tuyen_id: 10, don_vi_van_chuyen_id: null, loai_hang: null, tu_ngay: '2025-04-10', den_ngay: '2026-09-17', don_gia_ap_dung: 96000, don_vi_tinh: 'DONG_TAN', vat_percent: 8, trang_thai: 'ACTIVE' },
  { id: 2, tuyen_id: 10, don_vi_van_chuyen_id: null, loai_hang: null, tu_ngay: '2026-09-18', den_ngay: null, don_gia_ap_dung: 116700, don_vi_tinh: 'DONG_TAN', vat_percent: 8, trang_thai: 'ACTIVE' },
];
const vr = new VehicleResolver([
  { bien_so_chuan: '43H-01021', don_vi_van_chuyen_id: 'HAK', tu_ngay: null, den_ngay: '2026-09-30' },
  { bien_so_chuan: '43H-01021', don_vi_van_chuyen_id: 'QC', tu_ngay: '2026-10-01', den_ngay: null },
]);
const ctx = (basis) => ({
  vehicleResolver: vr, routeResolver: () => ({ status: 'OK', routeId: 10 }), priceRules: rules,
  settings: { roundingLevel: 'TICKET', rounding: { amount: null, vat: null, total: null }, ...(basis ? { ngay_can_cu_gia: basis } : {}) },
});
const tk = (o) => ({ id: 1, so_phieu: '1', bien_so: '43H-01021', kl_hang_kg: 20000, noi_xuat_id: 'DH', noi_den_id: 'TIENSA', ...o });

test('phiếu xuyên đêm qua ranh giới bảng giá: CAN_1 dùng giá ngày cân 1, CAN_2 dùng giá ngày cân 2; mặc định = CAN_1', () => {
  const t = tk({ ngay_gio_can_1: '2026-09-17T23:50:00', ngay_gio_can_2: '2026-09-18T00:20:00' });
  assert.equal(computeTicket(t, ctx()).don_gia, 96000);            // không cài → CAN_1
  assert.equal(computeTicket(t, ctx('CAN_1')).don_gia, 96000);
  assert.equal(computeTicket(t, ctx('CAN_2')).don_gia, 116700);
});

test('phiếu xuyên đêm qua ngày đổi đơn vị của xe: đơn vị theo ngày căn cứ', () => {
  const t = tk({ ngay_gio_can_1: '2026-09-30T23:50:00', ngay_gio_can_2: '2026-10-01T00:20:00' });
  assert.equal(computeTicket(t, ctx('CAN_1')).don_vi_van_chuyen_id, 'HAK');
  assert.equal(computeTicket(t, ctx('CAN_2')).don_vi_van_chuyen_id, 'QC');
});

test('CAN_2 nhưng phiếu chưa có giờ cân 2: quay về ngày cân 1; phiếu không xuyên đêm: hai căn cứ cho cùng kết quả', () => {
  const chuaCan2 = tk({ ngay_gio_can_1: '2026-09-17T23:50:00', ngay_gio_can_2: null });
  assert.equal(computeTicket(chuaCan2, ctx('CAN_2')).don_gia, 96000);
  const cungNgay = tk({ ngay_gio_can_1: '2026-09-20T08:00:00', ngay_gio_can_2: '2026-09-20T08:30:00' });
  assert.equal(computeTicket(cungNgay, ctx('CAN_1')).don_gia, computeTicket(cungNgay, ctx('CAN_2')).don_gia);
});
