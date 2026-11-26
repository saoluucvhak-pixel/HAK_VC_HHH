'use strict';
const { fold } = require('./columnMapping');

function unitFrom(value) {
  const text = fold(value).replace(/[.]/g, '');
  if (/^(?:kg|kgs|ki lo gam|kilogram|kilograms)$/.test(text)) return 'kg';
  if (/^(?:t|tan|ton|tons|tonne|tonnes|mt)$/.test(text)) return 't';
  return null;
}

function headerUnit(title) {
  const text = fold(title);
  if (/\((?:g|mg|lb|lbs|oz|pound|m3)\)|\b(?:lb|lbs|pounds?)$/.test(text)) return 'invalid';
  const units = text.match(/\b(?:kgs?|ki lo gam|kilograms?|tan|tons?|tonnes?|mt)\b|\(t\)|\bt$/g) || [];
  const recognized = new Set(units.map((unit) => unitFrom(unit.replace(/[()]/g, ''))));
  return recognized.size === 1 ? [...recognized][0] : recognized.size > 1 ? 'invalid' : null;
}

function splitWeightValue(value) {
  const parts = typeof value === 'string' && value.trim().match(/^([+-]?[0-9.,\s]+?)\s*([a-zA-ZÀ-ỹ.]+(?:\s+[a-zA-ZÀ-ỹ.]+)*)$/);
  const unit = parts ? unitFrom(parts[2]) : null;
  return { value: parts ? parts[1] : value, unit, invalidUnit: Boolean(parts && !unit) };
}

function parseWeightNumber(value, unit) {
  if (value == null || String(value).trim() === '') return null;
  let number = value;
  if (typeof value !== 'number') {
    let text = String(value).replace(/\s/g, '');
    if (unit !== 't' || !/^[+-]?\d+\.\d+$/.test(text)) text = text.replace(/\.(?=\d{3}(\D|$))/g, '');
    number = Number(text.replace(',', '.'));
  }
  if (!Number.isFinite(number)) return NaN;
  return unit === 't' ? Math.round(number * 1e6) / 1000 : number;
}

module.exports = { unitFrom, headerUnit, parseWeightNumber, splitWeightValue };
