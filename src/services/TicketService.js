'use strict';
/** Sửa phiếu cân (có audit), gán/chuyển đợt, đánh dấu xe trả về. Không sửa phiếu đã chốt. */
const { ValidationError } = require('./CatalogService');
const { businessKey, strongKey, fingerprint } = require('./DuplicateDetector');
const { normalizePlate, displayPlate, isValidPlate } = require('../utils/plate');

const EDITABLE = ['ngay_gio_can_1', 'ngay_gio_can_2', 'bien_so', 'can_lan_1', 'can_lan_2', 'kl_hang_kg', 'noi_den_id', 'dot_van_chuyen_id', 'xe_tra_ve', 'ghi_chu', 'loai_hang'];
const FINANCIAL = EDITABLE.filter((k) => k !== 'ghi_chu'); // phiếu đã chốt: chỉ còn sửa được ghi chú
const { parseDateTime } = require('../utils/datetime');
const { weightProblem, limitsFrom } = require('../utils/weight');
const { duyetBat, duyetTuDuyet, ticketVersionSql } = require('../utils/duyet');

class TicketService {
  constructor(db, { audit, cost, auth = null }) { Object.assign(this, { db, audit, cost, auth }); }

  get(id) { return this.db.get('SELECT * FROM phieu_can WHERE id=?', [id]); }

  update(id, data, note) {
    if (!String(note || '').trim()) throw new ValidationError('Cần ghi lý do sửa phiếu');
    return this.db.tx(() => {
      const old = this.get(id);
      if (!old || old.trang_thai !== 'ACTIVE') throw new ValidationError('Không tìm thấy phiếu');
      const ch = {};
      for (const k of EDITABLE) if (k in data && data[k] !== old[k]) ch[k] = data[k] === '' ? null : data[k];
      if (!Object.keys(ch).length) return old;
      if (old.chot_ky_id && Object.keys(ch).some((k) => FINANCIAL.includes(k) || k === 'dot_van_chuyen_id')) throw new ValidationError('Phiếu đã chốt — phải mở khóa kỳ trước');
      if (old.dot_van_chuyen_id && Object.keys(ch).some((k) => FINANCIAL.includes(k))) {
        const sd = this.db.get('SELECT trang_thai FROM dot_van_chuyen WHERE id=?', [old.dot_van_chuyen_id]);
        if (sd && sd.trang_thai === 'KHOA') throw new ValidationError('Phiếu thuộc đợt đã khóa — mở khóa đợt trước khi sửa');
      }
      for (const k of ['ngay_gio_can_1', 'ngay_gio_can_2']) {
        if (!(k in ch)) continue;
        if (ch[k] === null) { if (k === 'ngay_gio_can_1') throw new ValidationError('Không được xóa ngày giờ cân 1'); continue; }
        const iso = parseDateTime(ch[k]);
        if (!iso) throw new ValidationError(`${k === 'ngay_gio_can_1' ? 'Ngày giờ cân 1' : 'Ngày giờ cân 2'}: sai định dạng hoặc ngày không tồn tại`);
        ch[k] = iso;
      }
      // Đổi ngày cân 1 sang một ngày thuộc kỳ đã chốt → số đã chốt sẽ lệch Bảng kê: phải mở khóa kỳ trước
      if (ch.ngay_gio_can_1 && ch.ngay_gio_can_1.slice(0, 10) !== (old.ngay_gio_can_1 || '').slice(0, 10)) {
        require('./ChotKyService').ChotKyService.prototype.assertOpenForDates.call({ db: this.db }, [ch.ngay_gio_can_1.slice(0, 10)]);
      }
      const t1 = Object.hasOwn(ch, 'ngay_gio_can_1') ? ch.ngay_gio_can_1 : old.ngay_gio_can_1;
      const t2 = Object.hasOwn(ch, 'ngay_gio_can_2') ? ch.ngay_gio_can_2 : old.ngay_gio_can_2;
      if (('ngay_gio_can_1' in ch || 'ngay_gio_can_2' in ch) && t1 && t2 && t2 < t1) throw new ValidationError('Giờ cân 2 phải sau giờ cân 1');
      for (const k of ['can_lan_1', 'can_lan_2']) if (k in ch && ch[k] !== null && (!Number.isFinite(Number(ch[k])) || Number(ch[k]) < 0)) throw new ValidationError('Trọng lượng cân phải là số hữu hạn và không được âm');
      if (ch.dot_van_chuyen_id) {
        const d = this.db.get('SELECT trang_thai FROM dot_van_chuyen WHERE id=?', [ch.dot_van_chuyen_id]);
        if (!d) throw new ValidationError('Đợt không tồn tại');
        if (d.trang_thai === 'KHOA') throw new ValidationError('Đợt đích đã khóa');
      }
      if ('bien_so' in ch) {
        if (!isValidPlate(ch.bien_so)) throw new ValidationError('Biển số không hợp lệ');
        ch.bien_so_chuan = normalizePlate(ch.bien_so); ch.bien_so = displayPlate(ch.bien_so);
      }
      if ('kl_hang_kg' in ch && (!Number.isFinite(Number(ch.kl_hang_kg)) || !(Number(ch.kl_hang_kg) > 0))) throw new ValidationError('KL phải là số hữu hạn > 0');
      if ('kl_hang_kg' in ch) { const wp = weightProblem(ch.kl_hang_kg, limitsFrom(this.cost && this.cost.settings)); if (wp) throw new ValidationError(wp); }
      if (['kl_hang_kg', 'can_lan_1', 'can_lan_2'].some((k) => k in ch)) {
        const weights = { ...old, ...ch };
        if (weights.can_lan_1 !== null && weights.can_lan_2 !== null && Math.abs(Math.abs(weights.can_lan_1 - weights.can_lan_2) - weights.kl_hang_kg) > 0.5) {
          throw new ValidationError('KL hàng phải khớp |Cân lần 1 − Cân lần 2|');
        }
      }
      if ('xe_tra_ve' in ch) ch.xe_tra_ve = ch.xe_tra_ve ? 1 : 0;
      // Bật duyệt phiếu: sửa số liệu → phiếu về Nháp, người sửa gần nhất không tự duyệt được (cần duyệt lại)
      if (duyetBat(this.cost && this.cost.settings) && Object.keys(ch).some((k) => FINANCIAL.includes(k))) { ch.trang_thai_duyet = 'NHAP'; ch.duyet_boi = null; ch.duyet_luc = null; ch.nhap_boi = this.audit.actor() || null; }
      const merged = { ...old, ...ch, noi_xuat: old.noi_xuat_goc, bien_so: ch.bien_so || old.bien_so_goc };
      ch.business_key = businessKey(merged); ch.strong_key = strongKey(merged); ch.fingerprint = fingerprint(merged);
      const cols = Object.keys(ch);
      this.db.run(`UPDATE phieu_can SET ${cols.map((c) => `${c}=?`).join(',')}, updated_at=strftime('%Y-%m-%dT%H:%M:%S','now','localtime') WHERE id=?`, [...cols.map((c) => ch[c]), id]);
      const oldVals = Object.fromEntries(cols.map((c) => [c, old[c]]));
      this.audit.log('dot_van_chuyen_id' in ch && cols.length <= 4 ? 'MOVE_TICKET' : 'UPDATE_TICKET', 'phieu_can', id, oldVals, ch, note);
      this.cost.recalc({ ids: [id] });
      if ('bien_so' in ch) this.cost.syncTimeAlerts([old.bien_so_chuan]);
      return this.get(id);
    });
  }

  /** Phân loại phiếu trước khi xóa: xóa được / đã chốt kỳ (không xóa) / đợt đã khóa (không xóa). */
  _delCheck(ids) {
    const out = { ok: [], locked: [], dotKhoa: [], missing: 0, priced: 0 };
    for (const id of [...new Set(ids.map(Number))]) {
      const t = this.db.get(`SELECT p.*, d.trang_thai AS dot_tt FROM phieu_can p LEFT JOIN dot_van_chuyen d ON d.id=p.dot_van_chuyen_id WHERE p.id=?`, [id]);
      if (!t || t.trang_thai !== 'ACTIVE') { out.missing++; continue; }
      if (t.chot_ky_id || t.trang_thai_tinh_gia === 'LOCKED') out.locked.push(t.so_phieu);
      else if (t.dot_tt === 'KHOA') out.dotKhoa.push(t.so_phieu);
      else { out.ok.push(t.id); if (t.trang_thai_tinh_gia === 'OK') out.priced++; }
    }
    return out;
  }

  removePreview(ids) {
    const c = this._delCheck(ids);
    return { xoa_duoc: c.ok.length, da_tinh_gia: c.priced, da_chot_ky: c.locked.length, dot_khoa: c.dotKhoa.length, khong_con: c.missing };
  }

  /**
   * Xóa phiếu cân (xóa mềm → trạng thái VOID, có audit, import lại được). Gồm cả phiếu đã áp giá vận chuyển.
   * Phiếu đã chốt kỳ hoặc thuộc đợt đã khóa thì KHÔNG xóa — phải mở khóa trước.
   */
  remove(ids, reason) {
    if (!reason || !String(reason).trim()) throw new ValidationError('Cần ghi lý do xóa phiếu');
    if (!Array.isArray(ids) || !ids.length) throw new ValidationError('Chưa chọn phiếu nào');
    return this.db.tx(() => {
      const c = this._delCheck(ids);
      if (c.locked.length) throw new ValidationError(`${c.locked.length} phiếu đã chốt kỳ (${c.locked.slice(0, 5).join(', ')}${c.locked.length > 5 ? '…' : ''}) — mở khóa kỳ trước khi xóa`);
      if (c.dotKhoa.length) throw new ValidationError(`${c.dotKhoa.length} phiếu thuộc đợt đã khóa (${c.dotKhoa.slice(0, 5).join(', ')}${c.dotKhoa.length > 5 ? '…' : ''}) — mở khóa đợt trước khi xóa`);
      const plates = new Set();
      for (const id of c.ok) {
        const t = this.get(id); plates.add(t.bien_so_chuan);
        this.db.run(`UPDATE phieu_can SET trang_thai='VOID', updated_at=strftime('%Y-%m-%dT%H:%M:%S','now','localtime') WHERE id=?`, [id]);
        this.db.run(`UPDATE canh_bao SET trang_thai='DA_XU_LY', resolved_at=strftime('%Y-%m-%dT%H:%M:%S','now','localtime'), ghi_chu='Phiếu đã xóa' WHERE entity='phieu_can' AND entity_id=? AND trang_thai IN ('MOI','DANG_XU_LY')`, [id]);
        this.audit.log('DELETE_TICKET', 'phieu_can', id, { so_phieu: t.so_phieu, bien_so: t.bien_so, ngay_gio_can_1: t.ngay_gio_can_1, kl_hang_kg: t.kl_hang_kg, don_gia: t.don_gia, tong_tien: t.tong_tien, dot_van_chuyen_id: t.dot_van_chuyen_id }, null, reason);
      }
      this.cost.syncTimeAlerts([...plates]);
      return { deleted: c.ok.length, da_tinh_gia: c.priced };
    });
  }

  /**
   * Duyệt phiếu Nháp (chỉ khi bật duyệt phiếu). Mỗi phiếu một giao dịch, trả kết quả từng ID, không dừng ở lỗi đầu.
   * Không duyệt: phiếu không còn hiệu lực/đã duyệt; ngày thuộc kỳ đã chốt; thuộc đợt đã khóa; (khi bật phân quyền) phiếu do chính người duyệt nhập/sửa gần nhất.
   */
  approve(ids, note = null, vers = null) {
    if (!duyetBat(this.cost && this.cost.settings)) throw new ValidationError('Chưa bật duyệt phiếu (Cài đặt)');
    if (!Array.isArray(ids) || !ids.length) throw new ValidationError('Chưa chọn phiếu nào');
    const actor = this.audit.actor() || null; const authOn = !!(this.auth && this.auth.enabled());
    const results = [];
    for (const id of [...new Set(ids.map(Number))]) {
      const t = this.get(id); const base = { id, so_phieu: t ? t.so_phieu : null };
      try {
        if (!t || t.trang_thai !== 'ACTIVE') throw new ValidationError('Phiếu không còn hiệu lực');
        if (t.trang_thai_duyet !== 'NHAP') throw new ValidationError('Phiếu đã được duyệt');
        if (vers && vers[id] !== this.db.get(`SELECT ${ticketVersionSql()} v FROM phieu_can WHERE id=?`, [id]).v) throw new ValidationError('Phiếu đã thay đổi sau khi bạn chọn — tải lại danh sách và xem lại trước khi duyệt');
        { const wp = weightProblem(t.kl_hang_kg, limitsFrom(this.cost && this.cost.settings)); if (wp) throw new ValidationError(`${wp} — sửa khối lượng trước khi duyệt`); }
        if (authOn && actor && t.nhap_boi === actor) { if (!duyetTuDuyet(this.cost && this.cost.settings)) throw new ValidationError('Người nhập/sửa phiếu không tự duyệt phiếu của mình — cần một người có quyền Duyệt khác. Nếu chỉ có một người dùng, bật "Cho phép tự duyệt" ở Cài đặt → Duyệt từng phiếu'); }
        if (t.dot_van_chuyen_id) { const d = this.db.get('SELECT trang_thai FROM dot_van_chuyen WHERE id=?', [t.dot_van_chuyen_id]); if (d && d.trang_thai === 'KHOA') throw new ValidationError('Phiếu thuộc đợt đã khóa'); }
        this.db.tx(() => {
          require('./ChotKyService').ChotKyService.prototype.assertOpenForDates.call({ db: this.db }, [(t.ngay_gio_can_1 || '').slice(0, 10)]);
          this.db.run(`UPDATE phieu_can SET trang_thai_duyet='DA_DUYET', duyet_boi=?, duyet_luc=strftime('%Y-%m-%dT%H:%M:%S','now','localtime') WHERE id=?`, [actor, id]);
          this.audit.log('APPROVE_TICKET', 'phieu_can', id, { trang_thai_duyet: 'NHAP' }, { trang_thai_duyet: 'DA_DUYET', tu_duyet: !!(authOn && actor && t.nhap_boi === actor) }, note);
        });
        results.push({ ...base, ok: true });
      } catch (e) { results.push({ ...base, ok: false, reason: e.message }); }
    }
    const ok = results.filter((x) => x.ok).length;
    return { total: results.length, ok, failed: results.length - ok, results };
  }

  /** Chuyển nhiều phiếu sang đợt khác. */
  moveToDot(ids, dotId, note) {
    return this.db.tx(() => ids.map((id) => this.update(id, { dot_van_chuyen_id: dotId }, note || 'Chuyển đợt')).length);
  }
}

module.exports = { TicketService };
