'use strict';
/** Cấu hình hệ thống: chỉ nhận khóa đã biết + giá trị hợp lệ; sao lưu không bao giờ bị xóa hàng loạt do cấu hình hỏng. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const { BackupService } = require('../src/services/BackupService');

const rej = (fn, re) => assert.throws(fn, (e) => e.name === 'ValidationError' && re.test(e.message), String(re));

test('settings.set: khóa lạ bị từ chối (kể cả __proto__), giá trị không đổi', () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  const before = JSON.stringify(app.settings.all());
  for (const k of ['khong-co', '__proto__', 'constructor', '']) rej(() => app.settings.set(k, { x: 1 }), /Khóa cấu hình/);
  assert.equal(JSON.stringify(app.settings.all()), before);
});

test('settings.set: giá trị sai bị từ chối, giá trị đúng được lưu', () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  const S = app.settings;
  rej(() => S.set('backup', { keepDaily: 'abc' }), /hằng ngày/);
  rej(() => S.set('backup', { keepDaily: -1 }), /hằng ngày/);
  rej(() => S.set('backup', { keepDaily: 0 }), /hằng ngày/);
  rej(() => S.set('backup', { keepMonthly: 1.5 }), /hằng tháng/);
  rej(() => S.set('backup', { intervalDays: NaN }), /Chu kỳ/);
  rej(() => S.set('backup', null), /đối tượng/);
  rej(() => S.set('rounding', 'abc'), /đối tượng/);
  rej(() => S.set('rounding', { level: 'STATEMENT', statement: { lineAmount: { digits: NaN, mode: 'HALF_UP' } } }), /số nguyên/);
  rej(() => S.set('rounding', { statement: { vat: { digits: 0, mode: 'GIUA' } } }), /kiểu/);
  rej(() => S.set('time_anomaly', { minGapMinutes: -5 }), /0 đến 1440/);
  rej(() => S.set('time_anomaly', { maxWeighDurationMinutes: 'x' }), /1 đến 10080/);
  rej(() => S.set('money_scale', 1), /cố định 1000/);
  rej(() => S.set('company', { ten: 123 }), /phải là chữ/);
  S.set('backup', { auto: 'INTERVAL', intervalDays: 2, keepDaily: 10, keepMonthly: 6 });
  S.set('rounding', { level: 'STATEMENT', statement: { lineAmount: { digits: -2, mode: 'HALF_UP' }, vat: { digits: 0, mode: 'DOWN' } } });
  S.set('time_anomaly', { minGapMinutes: 15, maxWeighDurationMinutes: 120, minWeighDurationMinutes: 1 });
  S.set('company', { ten: 'Cty A', dia_chi: '' });
  assert.equal(S.get('backup').keepDaily, 10);
  assert.equal(S.get('time_anomaly').minGapMinutes, 15);
  assert.equal(S.get('money_scale'), 1000);
});

test('sao lưu: cấu hình lưu trữ bị hỏng (chữ/âm/0) KHÔNG làm xóa bản sao lưu; bản vừa tạo luôn còn', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  const app = createApp({ dbFile: path.join(dir, 'app.db'), driver: 'node:sqlite' });
  const bk = new BackupService({ getDb: () => app.db, dbFile: path.join(dir, 'app.db'), backupsDir: path.join(dir, 'backups'), settings: app.settings, reopen: () => {} });
  const autos = () => bk.list().filter((b) => b.kind === 'AUTO').length;
  for (let i = 0; i < 4; i++) bk.backupNow('AUTO');
  assert.equal(autos(), 4);
  for (const bad of [{ keepDaily: 'abc', keepMonthly: 'x' }, { keepDaily: -1 }, { keepDaily: 0, keepMonthly: 0 }, { keepDaily: 1e9 }, { keepDaily: 2.5 }]) {
    app.db.run(`UPDATE settings SET value_json=? WHERE key='backup'`, [JSON.stringify(bad)]);     // ghi thẳng, vượt qua kiểm tra của service
    const r = bk.backupNow('AUTO');
    assert.ok(fs.existsSync(r.file), 'bản vừa tạo phải còn');
    assert.ok(autos() >= 4, `${JSON.stringify(bad)} → còn ${autos()} bản`);
  }
  app.db.run(`UPDATE settings SET value_json='null' WHERE key='backup'`);
  bk.backupNow('AUTO');
  assert.ok(autos() >= 4);
  // cấu hình hợp lệ giữ đúng số bản
  app.settings.set('backup', { keepDaily: 3, keepMonthly: 1 });
  bk.backupNow('AUTO');
  assert.ok(autos() <= 4 && autos() >= 3);
});
