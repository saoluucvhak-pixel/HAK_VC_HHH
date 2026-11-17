/* HAK Accounting Report Standard — bản dùng cho trình duyệt (TỰ SINH từ src/ bằng scripts/build-browser.js — không sửa tay). */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HAKReport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var defs = {}, cache = {};
  function req(name) {
    if (cache[name]) return cache[name].exports;
    if (!defs[name]) throw new Error('Không có module ' + name);
    var m = cache[name] = { exports: {} };
    defs[name](m, m.exports, req);
    return m.exports;
  }
  defs["./exact-format"] = function (module, exports, require) {
    // Presentation-only decimal formatter. Accepts decimal strings or BigInt to avoid IEEE-754 precision loss.
    // Input convention: ungrouped ASCII decimal, dot as decimal separator. No exponent notation.
    function formatExact(value,{digits=2,mode='decimal',trimTrailingZeros=false}={}){
     if(!Number.isInteger(digits)||digits<0||digits>6||!['integer','decimal'].includes(mode))throw RangeError('Invalid precision');
     if(typeof value==='bigint')value=value.toString();
     if(typeof value!=='string'||!/^[+-]?\d+(?:\.\d+)?$/.test(value))throw TypeError('Expected ungrouped decimal string or bigint');
     const negative=value.startsWith('-');const clean=value.replace(/^[+-]/,'');let [whole,fraction='']=clean.split('.');
     const places=mode==='integer'?0:digits;
     const next=fraction[places]||'0';
     let kept=fraction.slice(0,places).padEnd(places,'0');
     // half-up rounding on decimal digits; rounding policy is display-only.
     if(next>='5'){
      let n=(BigInt(whole+kept||'0')+1n).toString().padStart(whole.length+places,'0');
      whole=places?n.slice(0,-places):n;kept=places?n.slice(-places):'';
     }
     whole=whole.replace(/^0+(?=\d)/,'').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
     if(trimTrailingZeros)kept=kept.replace(/0+$/,'');
     const zero=/^0+$/.test(whole.replace(/\./g,''))&&!/[1-9]/.test(kept);
     return (negative&&!zero?'-':'')+whole+(kept?','+kept:'');
    }
    module.exports={formatExact};
  };
  defs["./index"] = function (module, exports, require) {
    const numberFormats = new Map();
    function formatNumber(value, { maxDecimals = 2, minDecimals = 0 } = {}) {
      if (value === null || value === undefined || value === '') return '';
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Expected finite number');
      // Quá 2^53 thì Number đã mất chữ số: không hiển thị số sai âm thầm; dùng formatExact với chuỗi thập phân
      if (Math.abs(value) >= Number.MAX_SAFE_INTEGER + 1) throw new RangeError('|value| >= 2^53: use formatExact with a decimal string');
      if (!Number.isInteger(maxDecimals) || maxDecimals < 0 || maxDecimals > 20 || !Number.isInteger(minDecimals) || minDecimals < 0 || minDecimals > maxDecimals) throw new RangeError('Invalid precision');
      const key = minDecimals + ':' + maxDecimals;
      if (!numberFormats.has(key)) numberFormats.set(key, new Intl.NumberFormat('vi-VN', {useGrouping:true,minimumFractionDigits:minDecimals,maximumFractionDigits:maxDecimals}));
      return noNegativeZero(numberFormats.get(key).format(value));
    }
    // Số âm làm tròn về 0 hiển thị "0" / "0,00" (không "-0"): báo cáo kế toán không có số 0 âm. formatExact đã xử lý đúng từ trước.
    function noNegativeZero(text) { return /^-0(?:,0+)?$/.test(text) ? text.slice(1) : text; }
    function formatVND(value) { return formatNumber(value, {maxDecimals:0}); }
    function formatDateISO(value) {
      if (value === null || value === undefined || value === '') return '';
      if (typeof value !== 'string') throw new TypeError('Expected ISO yyyy-MM-dd');
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!m) throw new RangeError('Invalid date');
      const y = +m[1], mo = +m[2], d = +m[3];
      const dt = new Date(Date.UTC(y,mo-1,d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo-1 || dt.getUTCDate() !== d) throw new RangeError('Invalid calendar date');
      return m[3]+'/'+m[2]+'/'+m[1];
    }
    function alignFor(type) {
      if (['integer','decimal','money','percent'].includes(type)) return 'right';
      if (['date','datetime'].includes(type)) return 'center';
      return 'left';
    }
    function validateColumns(columns) {
      if (!Array.isArray(columns) || !columns.length) throw new TypeError('Non-empty columns required');
      const keys = new Set();
      return columns.map(c => {
        if (!c || typeof c.key !== 'string' || !c.key || keys.has(c.key)) throw new TypeError('Invalid/duplicate column key');
        keys.add(c.key);
        const type = c.type || 'text';
        if (!['text','code','integer','decimal','money','percent','date','datetime','boolean'].includes(type)) throw new TypeError('Invalid column type');
        const minWidth = c.minWidth ?? 70, maxWidth = c.maxWidth ?? 350;
        if (!(minWidth > 0 && maxWidth >= minWidth)) throw new RangeError('Invalid column widths');
        return {...c,type,align:c.align || alignFor(type),minWidth,maxWidth,wrap:c.wrap ?? type === 'text'};
      });
    }
    const {formatExact} = require('./exact-format');
    module.exports = {noNegativeZero,formatNumber,formatExact,formatVND,formatDateISO,alignFor,validateColumns};
  };
  defs["./precision-settings"] = function (module, exports, require) {
    const {formatNumber}=require('./index');
    const TYPES=['money','quantity'];
    function validatePrecision(setting) {
      if (!setting || typeof setting !== 'object') throw new TypeError('Precision setting required');
      if (!['integer','decimal'].includes(setting.mode)) throw new RangeError('mode must be integer or decimal');
      const digits=setting.mode==='integer'?0:setting.digits;
      if (!Number.isInteger(digits)||digits<0||digits>6) throw new RangeError('digits must be 0..6');
      return {mode:setting.mode,digits};
    }
    function normalizeSettings(input={}) {
      const defaults={money:{mode:'integer',digits:0},quantity:{mode:'decimal',digits:2}};
      const out={};
      for(const t of TYPES)out[t]=validatePrecision(input[t]||defaults[t]);
      const columns={};
      for(const [key,setting] of Object.entries(input.columns||{})) {
        if(!key||key==='__proto__'||key==='constructor'||key==='prototype')throw new TypeError('Invalid column key');
        columns[key]=validatePrecision(setting);
      }
      return {schemaVersion:1,money:out.money,quantity:out.quantity,columns};
    }
    function resolvePrecision(settings,type,columnKey) {
      if(!TYPES.includes(type))throw new RangeError('type must be money or quantity');
      const s=normalizeSettings(settings);
      return columnKey && Object.prototype.hasOwnProperty.call(s.columns,columnKey)?s.columns[columnKey]:s[type];
    }
    function formatConfigured(value,settings,type,columnKey) {
      const {digits}=resolvePrecision(settings,type,columnKey);
      return formatNumber(value,{minDecimals:digits,maxDecimals:digits});
    }
    module.exports={validatePrecision,normalizeSettings,resolvePrecision,formatConfigured};
  };
  defs["./moisture-settings"] = function (module, exports, require) {
    const {formatNumber}=require('./index');
    const {validatePrecision}=require('./precision-settings');
    const DEFAULTS=Object.freeze({moisture:{mode:'decimal',digits:2},dryness:{mode:'decimal',digits:2}});
    function normalizeMoistureSettings(input={}) {
     const out={schemaVersion:1,moisture:validatePrecision(input.moisture||DEFAULTS.moisture),dryness:validatePrecision(input.dryness||DEFAULTS.dryness),columns:{}};
     for(const [key,setting] of Object.entries(input.columns||{})){
      if(!key||['__proto__','constructor','prototype'].includes(key))throw new TypeError('Invalid column key');
      out.columns[key]=validatePrecision(setting);
     }
     return out;
    }
    function formatPercent(value,settings={},type='moisture',columnKey){
     if(!['moisture','dryness'].includes(type))throw new RangeError('Unknown percent type');
     if(value===null||value===undefined||value==='')return '';
     if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)throw new RangeError('Percentage must be in 0..100');
     const s=normalizeMoistureSettings(settings);
     const p=columnKey&&Object.prototype.hasOwnProperty.call(s.columns,columnKey)?s.columns[columnKey]:s[type];
     return formatNumber(value,{minDecimals:p.digits,maxDecimals:p.digits})+' %';
    }
    function drynessFromMoisture(moisture){
     if(typeof moisture!=='number'||!Number.isFinite(moisture)||moisture<0||moisture>100)throw new RangeError('Moisture must be in 0..100');
     // 100 - x trong số thực nhị phân sinh nhiễu (100-8.04 = 91.96000000000001): làm tròn về 6 chữ số thập phân (tối đa độ chính xác cấu hình 0..6).
     return Math.round((100-moisture)*1e6)/1e6;
    }
    module.exports={normalizeMoistureSettings,formatPercent,drynessFromMoisture};
  };
  defs["./system-settings"] = function (module, exports, require) {
    const {validatePrecision}=require('./precision-settings');
    const {noNegativeZero}=require('./index');
    const CATEGORIES=['money','quantity','moisture','dryness'];
    const DEFAULTS={money:{mode:'integer',digits:0},quantity:{mode:'decimal',digits:2},moisture:{mode:'decimal',digits:2},dryness:{mode:'decimal',digits:2}};
    function normalize(input={}){const groups={};for(const key of CATEGORIES)groups[key]=validatePrecision(input.groups?.[key]||DEFAULTS[key]);const columns={};for(const [key,entry] of Object.entries(input.columns||{})){if(!key||['__proto__','constructor','prototype'].includes(key)||!CATEGORIES.includes(entry.category))throw Error('Invalid column override');columns[key]={category:entry.category,...validatePrecision(entry)};}return {schemaVersion:2,groups,columns};}
    function resolve(settings,category,key){if(!CATEGORIES.includes(category))throw Error('Invalid category');const s=normalize(settings);const col=key&&s.columns[key];if(col&&col.category!==category)throw Error('Column category mismatch');return col||s.groups[category];}
    function format(value,settings,category,key){if(value==null||value==='')return '';if(typeof value!=='number'||!Number.isFinite(value))throw TypeError('Finite number required');if((category==='moisture'||category==='dryness')&&(value<0||value>100))throw RangeError('Percent out of range');const {digits}=resolve(settings,category,key);const n=noNegativeZero(new Intl.NumberFormat('vi-VN',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value));return n+(category==='moisture'||category==='dryness'?' %':'');}
    module.exports={CATEGORIES,normalize,resolve,format};
  };
  var api = {};
  ['./index', './precision-settings', './moisture-settings', './system-settings'].forEach(function (n) {
    var e = req(n);
    Object.keys(e).forEach(function (k) { if (!(k in api)) api[k] = e[k]; });
  });
  api.system = req('./system-settings');       // format/normalize/resolve của cấu hình v2 (trùng tên với module khác nên để riêng)
  api.moisture = req('./moisture-settings');
  api.precision = req('./precision-settings');
  return api;
});
