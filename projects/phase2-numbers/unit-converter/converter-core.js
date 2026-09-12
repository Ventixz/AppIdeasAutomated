/*
 * converter-core.js — a DOM-free, exact-rational unit-conversion engine.
 *
 * Why rationals? Almost every unit relationship is a *defined* exact ratio:
 * 1 in = 2.54 cm, 1 mile = 1609.344 m, 1 US gallon = 3.785411784 L — all exact
 * by definition. Store those factors as IEEE-754 floats and round-trips drift:
 * (1 mile -> km -> mile) stops being 1. Here every factor and every value is a
 * reduced pair of BigInts, so conversions are exact and reversible, and the
 * display layer decides — per result — whether the exact value terminates as a
 * finite decimal (shown in full) or has to be rounded (flagged as such).
 *
 * Temperature is affine, not just multiplicative (°F -> K is a scale *and* an
 * offset), so those units carry an exact rational scale and offset too, which
 * keeps °C <-> °F <-> K exact as well.
 *
 * Currency is the honest exception: there is no exact, timeless ratio between
 * dollars and euros. Rates here are a fixed offline snapshot (see RATE_DATE),
 * editable at runtime, and every currency result is flagged approximate.
 *
 * This file is DOM-free / IO-free so the identical module runs in the browser
 * and under Node for the tests (module.exports at the bottom).
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Exact rationals: { n, d } BigInt, always reduced, denominator > 0. *
 * ------------------------------------------------------------------ */

function babs(x) { return x < 0n ? -x : x; }

function gcd(a, b) {
  a = babs(a); b = babs(b);
  while (b) { var t = a % b; a = b; b = t; }
  return a;
}

// Build a reduced rational from BigInt numerator/denominator.
function rat(n, d) {
  if (d === 0n) throw new Error('division by zero');
  if (d < 0n) { n = -n; d = -d; }
  if (n === 0n) return { n: 0n, d: 1n };
  var g = gcd(n, d);
  return { n: n / g, d: d / g };
}

function rMul(a, b) { return rat(a.n * b.n, a.d * b.d); }
function rDiv(a, b) {
  if (b.n === 0n) throw new Error('division by zero');
  return rat(a.n * b.d, a.d * b.n);
}
function rAdd(a, b) { return rat(a.n * b.d + b.n * a.d, a.d * b.d); }
function rSub(a, b) { return rat(a.n * b.d - b.n * a.d, a.d * b.d); }
function rEq(a, b) { return a.n === b.n && a.d === b.d; }
function rIsNeg(a) { return a.n < 0n; }

// Convenience: build a rational from a plain integer or a n/d pair of Numbers.
function R(n, d) {
  return rat(BigInt(n), d === undefined ? 1n : BigInt(d));
}

/* ------------------------------------------------------------------ *
 * Parse a user-typed number into an exact rational.                  *
 * Accepts:  12   -3.5   .25   1_000   6.022e23   1/3   -2/7          *
 * ------------------------------------------------------------------ */

function parseNumber(str) {
  if (typeof str !== 'string') str = String(str);
  var s = str.trim().replace(/_/g, '');
  if (s === '') throw new Error('empty input');

  // Explicit fraction "a/b" (each side an integer or decimal).
  var slash = s.indexOf('/');
  if (slash !== -1) {
    var num = parseNumber(s.slice(0, slash));
    var den = parseNumber(s.slice(slash + 1));
    return rDiv(num, den);
  }

  var m = /^([+-]?)(\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || (m[2] === '' && m[3] === undefined)) {
    throw new Error('not a number: "' + str + '"');
  }
  var sign = m[1] === '-' ? -1n : 1n;
  var intPart = m[2] || '0';
  var fracPart = m[3] || '';
  var exp = m[4] ? parseInt(m[4], 10) : 0;

  // (int.frac) as a rational: (intfrac) / 10^fracLen
  var digits = intPart + fracPart;
  var numerator = sign * BigInt(digits);
  var denomPow = fracPart.length;             // 10^denomPow in the denominator

  // Apply the exponent by shifting the power of ten.
  var netPow = exp - denomPow;                // final scale: value * 10^netPow
  if (netPow >= 0) {
    return rat(numerator * (10n ** BigInt(netPow)), 1n);
  }
  return rat(numerator, 10n ** BigInt(-netPow));
}

/* ------------------------------------------------------------------ *
 * Format a rational for display.                                     *
 *  - terminating decimal  -> shown in full, exactDisplay = true      *
 *  - repeating / too long -> rounded to sig figs, exactDisplay=false *
 * ------------------------------------------------------------------ */

var EXACT_CAP = 30;   // max fractional digits we'll print for an exact value
var SIG = 12;         // significant figures when we have to round

// Long division producing up to `places` fractional digits.
// Returns { intStr, frac (string), terminated }.
function longDivide(n, d, places) {
  var intPart = n / d;
  var rem = n % d;
  var frac = '';
  var terminated = rem === 0n;
  for (var i = 0; i < places && rem !== 0n; i++) {
    rem *= 10n;
    frac += (rem / d).toString();
    rem %= d;
    if (rem === 0n) { terminated = true; }
  }
  return { intStr: intPart.toString(), frac: frac, terminated: rem === 0n };
}

function stripTrailingZeros(frac) {
  return frac.replace(/0+$/, '');
}

// Round non-negative rational n/d to `sig` significant figures, returning a
// plain decimal string (half-up).
function roundSig(n, d, sig) {
  if (n === 0n) return '0';
  var intPart = n / d;
  var decimalPlaces;
  if (intPart > 0n) {
    decimalPlaces = sig - intPart.toString().length;
  } else {
    // value < 1: count leading zeros after the point.
    var rem = n, lz = 0;
    while (true) {
      rem *= 10n;
      if (rem / d === 0n) { lz++; rem %= d; } else break;
      if (lz > 400) break; // safety
    }
    decimalPlaces = lz + sig;
  }
  // Rounding position lands inside the integer part (e.g. 1234 to 2 sig figs
  // -> 1200): round to the nearest multiple of 10^(-decimalPlaces).
  if (decimalPlaces < 0) {
    var pow = 10n ** BigInt(-decimalPlaces);
    var q = (n * 2n + d * pow) / (d * 2n * pow); // round(n / (d·pow)) half-up
    return (q * pow).toString();
  }
  var scale = 10n ** BigInt(decimalPlaces);
  // half-up rounding on a positive quantity
  var scaled = (n * scale * 2n + d) / (d * 2n);
  var str = scaled.toString();
  if (decimalPlaces === 0) return str;
  while (str.length <= decimalPlaces) str = '0' + str;
  var cut = str.length - decimalPlaces;
  var out = str.slice(0, cut) + '.' + str.slice(cut);
  out = out.replace(/0+$/, '').replace(/\.$/, '');
  return out;
}

// -> { display, exactDisplay }
function formatRational(r) {
  if (r.n === 0n) return { display: '0', exactDisplay: true };
  var neg = r.n < 0n;
  var n = neg ? -r.n : r.n;
  var d = r.d;

  var ld = longDivide(n, d, EXACT_CAP);
  if (ld.terminated) {
    var frac = stripTrailingZeros(ld.frac);
    var s = ld.intStr + (frac ? '.' + frac : '');
    return { display: (neg ? '-' : '') + s, exactDisplay: true };
  }
  // Not terminating within the cap -> round.
  var rounded = roundSig(n, d, SIG);
  return { display: (neg ? '-' : '') + rounded, exactDisplay: false };
}

/* ------------------------------------------------------------------ *
 * Unit definitions.                                                  *
 *                                                                    *
 * Multiplicative categories: each unit has `factor` = how many base  *
 * units are in one of this unit. Affine (temperature): base = v*scale*
 * + offset. Currency: `factor` = base (USD) per one unit, snapshot.  *
 * ------------------------------------------------------------------ */

// Handy exact decimal-string -> rational for readable definitions.
function D(s) { return parseNumber(s); }

var RATE_DATE = '2025-01-02'; // the currency snapshot's "as of" date

var CATEGORIES = {
  length: {
    label: 'Length',
    base: 'm',
    kind: 'mul',
    units: {
      km:  { label: 'kilometre (km)',   factor: R(1000) },
      m:   { label: 'metre (m)',        factor: R(1) },
      cm:  { label: 'centimetre (cm)',  factor: R(1, 100) },
      mm:  { label: 'millimetre (mm)',  factor: R(1, 1000) },
      um:  { label: 'micrometre (µm)',  factor: R(1, 1000000) },
      mi:  { label: 'mile (mi)',        factor: D('1609.344') },
      yd:  { label: 'yard (yd)',        factor: D('0.9144') },
      ft:  { label: 'foot (ft)',        factor: D('0.3048') },
      in:  { label: 'inch (in)',        factor: D('0.0254') },
      nmi: { label: 'nautical mile',    factor: R(1852) }
    }
  },
  mass: {
    label: 'Mass',
    base: 'kg',
    kind: 'mul',
    units: {
      t:   { label: 'tonne (t)',        factor: R(1000) },
      kg:  { label: 'kilogram (kg)',    factor: R(1) },
      g:   { label: 'gram (g)',         factor: R(1, 1000) },
      mg:  { label: 'milligram (mg)',   factor: R(1, 1000000) },
      lb:  { label: 'pound (lb)',       factor: D('0.45359237') },
      oz:  { label: 'ounce (oz)',       factor: rDiv(D('0.45359237'), R(16)) },
      st:  { label: 'stone (st)',       factor: rMul(D('0.45359237'), R(14)) }
    }
  },
  volume: {
    label: 'Volume',
    base: 'L',
    kind: 'mul',
    units: {
      m3:   { label: 'cubic metre (m³)', factor: R(1000) },
      L:    { label: 'litre (L)',        factor: R(1) },
      mL:   { label: 'millilitre (mL)',  factor: R(1, 1000) },
      cm3:  { label: 'cubic cm (cm³)',   factor: R(1, 1000) },
      gal:  { label: 'US gallon',        factor: D('3.785411784') },
      qt:   { label: 'US quart',         factor: rDiv(D('3.785411784'), R(4)) },
      pt:   { label: 'US pint',          factor: rDiv(D('3.785411784'), R(8)) },
      cup:  { label: 'US cup',           factor: rDiv(D('3.785411784'), R(16)) },
      floz: { label: 'US fluid ounce',   factor: rDiv(D('3.785411784'), R(128)) },
      tbsp: { label: 'US tablespoon',    factor: rDiv(D('3.785411784'), R(256)) },
      tsp:  { label: 'US teaspoon',      factor: rDiv(D('3.785411784'), R(768)) }
    }
  },
  area: {
    label: 'Area',
    base: 'm²',
    kind: 'mul',
    units: {
      km2:  { label: 'square km (km²)', factor: R(1000000) },
      ha:   { label: 'hectare (ha)',    factor: R(10000) },
      m2:   { label: 'square metre (m²)', factor: R(1) },
      cm2:  { label: 'square cm (cm²)', factor: R(1, 10000) },
      mi2:  { label: 'square mile',     factor: rMul(D('1609.344'), D('1609.344')) },
      acre: { label: 'acre',            factor: rMul(R(4840), rMul(D('0.9144'), D('0.9144'))) },
      yd2:  { label: 'square yard',     factor: rMul(D('0.9144'), D('0.9144')) },
      ft2:  { label: 'square foot',     factor: rMul(D('0.3048'), D('0.3048')) },
      in2:  { label: 'square inch',     factor: rMul(D('0.0254'), D('0.0254')) }
    }
  },
  speed: {
    label: 'Speed',
    base: 'm/s',
    kind: 'mul',
    units: {
      'm/s':  { label: 'metre/second',    factor: R(1) },
      'km/h': { label: 'kilometre/hour',  factor: R(1000, 3600) },
      mph:    { label: 'mile/hour',       factor: rDiv(D('1609.344'), R(3600)) },
      'ft/s': { label: 'foot/second',     factor: D('0.3048') },
      knot:   { label: 'knot',            factor: R(1852, 3600) }
    }
  },
  time: {
    label: 'Time',
    base: 's',
    kind: 'mul',
    units: {
      ms:   { label: 'millisecond (ms)', factor: R(1, 1000) },
      s:    { label: 'second (s)',       factor: R(1) },
      min:  { label: 'minute (min)',     factor: R(60) },
      h:    { label: 'hour (h)',         factor: R(3600) },
      day:  { label: 'day',              factor: R(86400) },
      week: { label: 'week',             factor: R(604800) },
      year: { label: 'year (365.25 d)',  factor: R(31557600) }
    }
  },
  digital: {
    label: 'Digital storage',
    base: 'B',
    kind: 'mul',
    units: {
      bit: { label: 'bit',        factor: R(1, 8) },
      B:   { label: 'byte (B)',   factor: R(1) },
      KB:  { label: 'kilobyte (KB, 1000)', factor: R(1000) },
      MB:  { label: 'megabyte (MB, 1000²)', factor: R(1000000) },
      GB:  { label: 'gigabyte (GB, 1000³)', factor: R(1000000000) },
      TB:  { label: 'terabyte (TB, 1000⁴)', factor: R('1000000000000') },
      KiB: { label: 'kibibyte (KiB, 1024)', factor: R(1024) },
      MiB: { label: 'mebibyte (MiB, 1024²)', factor: R(1048576) },
      GiB: { label: 'gibibyte (GiB, 1024³)', factor: R(1073741824) },
      TiB: { label: 'tebibyte (TiB, 1024⁴)', factor: R('1099511627776') }
    }
  },
  temperature: {
    label: 'Temperature',
    base: 'K',
    kind: 'affine',
    // base (Kelvin) = value * scale + offset
    units: {
      C: { label: 'Celsius (°C)',    scale: R(1),    offset: D('273.15') },
      F: { label: 'Fahrenheit (°F)', scale: R(5, 9), offset: rSub(D('273.15'), rMul(R(32), R(5, 9))) },
      K: { label: 'Kelvin (K)',      scale: R(1),    offset: R(0) },
      R: { label: 'Rankine (°R)',    scale: R(5, 9), offset: R(0) }
    }
  },
  currency: {
    label: 'Currency (offline snapshot)',
    base: 'USD',
    kind: 'currency',
    // factor = USD per one unit (editable at runtime); flagged approximate.
    units: {
      USD: { label: 'US dollar (USD)',      factor: R(1) },
      EUR: { label: 'Euro (EUR)',           factor: D('1.0350') },
      GBP: { label: 'British pound (GBP)',  factor: D('1.2520') },
      JPY: { label: 'Japanese yen (JPY)',   factor: D('0.006380') },
      CNY: { label: 'Chinese yuan (CNY)',   factor: D('0.1370') },
      CAD: { label: 'Canadian dollar (CAD)', factor: D('0.6960') },
      AUD: { label: 'Australian dollar (AUD)', factor: D('0.6230') },
      CHF: { label: 'Swiss franc (CHF)',    factor: D('1.1010') },
      INR: { label: 'Indian rupee (INR)',   factor: D('0.011670') },
      BRL: { label: 'Brazilian real (BRL)', factor: D('0.16350') }
    }
  }
};

/* ------------------------------------------------------------------ *
 * Conversion.                                                        *
 * ------------------------------------------------------------------ */

function getCategory(catKey) {
  var cat = CATEGORIES[catKey];
  if (!cat) throw new Error('unknown category: ' + catKey);
  return cat;
}

function getUnit(cat, unitKey) {
  var u = cat.units[unitKey];
  if (!u) throw new Error('unknown unit: ' + unitKey);
  return u;
}

// Convert an exact-rational value from one unit to another within a category.
// Returns a rational (the exact converted value).
function convertRational(catKey, fromKey, toKey, value) {
  var cat = getCategory(catKey);
  var from = getUnit(cat, fromKey);
  var to = getUnit(cat, toKey);

  if (cat.kind === 'affine') {
    // to base:   base = value * from.scale + from.offset
    // from base: out  = (base - to.offset) / to.scale
    var base = rAdd(rMul(value, from.scale), from.offset);
    return rDiv(rSub(base, to.offset), to.scale);
  }
  // multiplicative & currency both use `factor` (base units per one unit).
  var baseVal = rMul(value, from.factor);
  return rDiv(baseVal, to.factor);
}

/*
 * The public entry point. Takes a category, from/to unit keys and a value
 * string; returns an object with the exact rational, its display string, a
 * flag for whether that display is exact, and a note for approximate cases.
 */
function convert(catKey, fromKey, toKey, valueStr) {
  var cat = getCategory(catKey);
  var value = (typeof valueStr === 'object' && valueStr && 'n' in valueStr)
    ? valueStr
    : parseNumber(valueStr);

  // Absolute-zero guard for temperature (a physical, not arithmetic, limit).
  if (cat.kind === 'affine') {
    var kelvin = rAdd(rMul(value, getUnit(cat, fromKey).scale), getUnit(cat, fromKey).offset);
    if (rIsNeg(kelvin)) {
      throw new Error('below absolute zero (0 K)');
    }
  }

  var result = convertRational(catKey, fromKey, toKey, value);
  var fmt = formatRational(result);

  var note = null;
  var exactValue = true;
  if (cat.kind === 'currency') {
    exactValue = false;               // the rate itself is an approximation
    note = 'offline snapshot rate (as of ' + RATE_DATE + ') — not live';
  }

  return {
    category: catKey,
    from: fromKey,
    to: toKey,
    value: result,                    // exact rational
    display: fmt.display,
    // exactDisplay: the printed string equals the true value exactly
    exactDisplay: fmt.exactDisplay && exactValue,
    exactValue: exactValue,           // the underlying value is an exact ratio
    note: note
  };
}

// Set (or override) a currency's USD rate at runtime. Accepts a number/string
// or a rational; returns the stored rational.
function setRate(currencyKey, usdPerUnit) {
  var u = getUnit(CATEGORIES.currency, currencyKey);
  u.factor = (typeof usdPerUnit === 'object' && usdPerUnit && 'n' in usdPerUnit)
    ? usdPerUnit
    : parseNumber(usdPerUnit);
  return u.factor;
}

/* ------------------------------------------------------------------ */

var api = {
  // rationals
  rat: rat, R: R, rMul: rMul, rDiv: rDiv, rAdd: rAdd, rSub: rSub, rEq: rEq, gcd: gcd,
  // parsing / formatting
  parseNumber: parseNumber, formatRational: formatRational,
  roundSig: roundSig, longDivide: longDivide,
  // data + conversion
  CATEGORIES: CATEGORIES, RATE_DATE: RATE_DATE,
  convert: convert, convertRational: convertRational, setRate: setRate
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.ConverterCore = api;
}
