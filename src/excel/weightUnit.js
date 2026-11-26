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

module.exports = { unitFrom, headerUnit };
