/*
 * converter-core.js — the whole calculation for "Binary to Decimal and Back
 * Converter", from karan/Projects (Numbers):
 *
 *   "If you can write the algorithm to convert a number from binary to decimal
 *    and vice versa in your favourite language, you understand computers."
 *
 * DOM-free, console-free, I/O-free, so the identical file runs in the browser
 * and under Node for the tests.
 *
 * Two things make this more than `parseInt(s, 2)` / `n.toString(2)`, and both
 * live here:
 *
 * 1. THOSE ONE-LINERS SILENTLY LOSE PRECISION. `parseInt('1' + '0'.repeat(60),
 *    2)` is not 2^60 — it comes back as 1152921504606847000, wrong from the
 *    17th digit on, because it goes through a 64-bit float. `(2n**60n)`
 *    .toString etc. is exact only if you never touch Number. So every integer
 *    conversion here runs on BigInt, digit by digit, and is exact at any size.
 *
 * 2. FRACTIONS ARE ASYMMETRIC. A binary fraction ALWAYS terminates in decimal
 *    (its denominator is a power of two), so binary -> decimal is exact. But a
 *    decimal fraction usually does NOT terminate in binary — 0.1 decimal is
 *    0.0001100110011... forever — so decimal -> binary must stop somewhere and
 *    say it rounded. We compute the fractional bits exactly as a rational,
 *    round the last one, and flag whether the result is exact or truncated.
 */

'use strict';

/* ------------------------------------------------------------------ *
 * Small helpers over strings we don't trust yet.
 * ------------------------------------------------------------------ */

function splitSign(str) {
  var neg = false;
  var s = str;
  if (s[0] === '+') { s = s.slice(1); }
  else if (s[0] === '-') { neg = true; s = s.slice(1); }
  return { neg: neg, body: s };
}

// "0012.3400" without a leading-zero storm and without a trailing-zero storm,
// keeping a single "0" where a part is empty. Purely cosmetic; never lossy.
function tidy(intPart, fracPart) {
  var i = intPart.replace(/^0+(?=\d)/, '');   // drop leading zeros, keep one
  if (i === '') i = '0';
  var f = fracPart.replace(/0+$/, '');         // drop trailing zeros
  return f === '' ? i : i + '.' + f;
}

/* ------------------------------------------------------------------ *
 * BINARY -> DECIMAL.  Always exact: a binary fraction b/2^k has a finite
 * decimal expansion, because 1/2 = 0.5, 1/4 = 0.25, ... all terminate.
 * ------------------------------------------------------------------ */

function binToDec(binStr) {
  if (typeof binStr !== 'string') binStr = String(binStr);
  var t = binStr.trim();
  if (t === '' || t === '+' || t === '-') throw new Error('empty binary number');

  var sp = splitSign(t);
  var parts = sp.body.split('.');
  if (parts.length > 2) throw new Error('more than one binary point: "' + binStr + '"');
  var intBits = parts[0];
  var fracBits = parts.length === 2 ? parts[1] : '';

  if (intBits === '' && fracBits === '') throw new Error('no digits: "' + binStr + '"');
  if (!/^[01]*$/.test(intBits) || !/^[01]*$/.test(fracBits)) {
    throw new Error('binary may only contain 0 and 1: "' + binStr + '"');
  }

  // Integer part: fold the bits into a BigInt, MSB first.
  var intVal = 0n;
  for (var i = 0; i < intBits.length; i++) {
    intVal = intVal * 2n + (intBits[i] === '1' ? 1n : 0n);
  }

  // Fractional part: the value is F / 2^k, where F is the fraction bits read as
  // an integer and k is how many there are. Dividing by 2^k in decimal is the
  // same as multiplying the numerator by 5^k and shifting the point k places,
  // because 1/2^k = 5^k / 10^k. That keeps everything exact integer work.
  var fracDec = '';
  if (fracBits.length > 0) {
    var k = fracBits.length;
    var F = 0n;
    for (var j = 0; j < fracBits.length; j++) {
      F = F * 2n + (fracBits[j] === '1' ? 1n : 0n);
    }
    var scaled = (F * (5n ** BigInt(k))).toString(); // = fraction * 10^k
    while (scaled.length < k) scaled = '0' + scaled;  // pad to k digits
    fracDec = scaled.slice(scaled.length - k);        // the k digits after point
  }

  var out = tidy(intVal.toString(), fracDec);
  return (sp.neg && out !== '0') ? '-' + out : out;
}

/* ------------------------------------------------------------------ *
 * DECIMAL -> BINARY.  Integer part is exact. Fraction part may be
 * non-terminating (e.g. 0.1), so it is computed to `fracBits` places and the
 * result reports whether it came out exact or was rounded.
 * ------------------------------------------------------------------ */

function decToBin(decStr, fracBits) {
  if (fracBits === undefined) fracBits = 52;
  if (typeof decStr !== 'string') decStr = String(decStr);
  var t = decStr.trim();
  if (t === '' || t === '+' || t === '-') throw new Error('empty decimal number');

  var sp = splitSign(t);
  var parts = sp.body.split('.');
  if (parts.length > 2) throw new Error('more than one decimal point: "' + decStr + '"');
  var intPart = parts[0];
  var fracPart = parts.length === 2 ? parts[1] : '';

  if (intPart === '' && fracPart === '') throw new Error('no digits: "' + decStr + '"');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) {
    throw new Error('decimal may only contain digits: "' + decStr + '"');
  }

  // Integer part: repeated division by 2 over BigInt, exact at any size.
  var n = BigInt(intPart === '' ? '0' : intPart);
  var intBits = '';
  if (n === 0n) {
    intBits = '0';
  } else {
    while (n > 0n) {
      intBits = (n % 2n).toString() + intBits;
      n = n / 2n;
    }
  }

  // Fractional part as an exact rational num/den = 0.fracPart.
  //   0.d1d2...dm = (d1d2...dm) / 10^m
  var exact = true;
  var outFrac = '';
  if (fracPart.length > 0) {
    var num = BigInt(fracPart);
    var den = 10n ** BigInt(fracPart.length);
    num = num % den;                 // keep it a pure fraction in [0,1)
    var bits = [];
    // Multiply by two repeatedly; the integer part of each product is the next
    // binary digit. Terminates early iff the remainder hits exactly zero.
    for (var b = 0; b < fracBits && num !== 0n; b++) {
      num = num * 2n;
      if (num >= den) { bits.push('1'); num -= den; }
      else { bits.push('0'); }
    }
    if (num !== 0n) {
      exact = false;
      // Round to nearest, ties up: look at the would-be next bit (2*num vs den).
      if (num * 2n >= den) {
        bits = roundUpBits(bits, intBits);
        if (typeof bits === 'object' && bits.carryInt) {
          intBits = bits.intBits;
          bits = bits.bits;
        }
      }
    }
    outFrac = bits.join('');
  }

  var out = tidy(intBits, outFrac);
  var result = (sp.neg && out !== '0') ? '-' + out : out;
  return { binary: result, exact: exact };
}

// Add one unit in the last fractional place, propagating carry through the
// fraction bits and, if it overflows, into the integer bits.
function roundUpBits(bits, intBits) {
  var i = bits.length - 1;
  while (i >= 0) {
    if (bits[i] === '0') { bits[i] = '1'; return bits; }
    bits[i] = '0';
    i--;
  }
  // Carried out of the fraction: increment the integer part (also binary).
  var carried = incBinary(intBits);
  return { carryInt: true, intBits: carried, bits: bits };
}

// intBits + 1, as a binary string.
function incBinary(intBits) {
  var arr = intBits.split('');
  var i = arr.length - 1;
  while (i >= 0) {
    if (arr[i] === '0') { arr[i] = '1'; return arr.join(''); }
    arr[i] = '0';
    i--;
  }
  return '1' + arr.join('');
}

/* ------------------------------------------------------------------ *
 * A single round-trip check the UI and tests lean on: convert one way,
 * convert back, and confirm you land where you started (for exact cases).
 * ------------------------------------------------------------------ */

function roundTripDec(decStr, fracBits) {
  var toBin = decToBin(decStr, fracBits);
  var back = binToDec(toBin.binary);
  return { binary: toBin.binary, exact: toBin.exact, backToDec: back };
}

/* ------------------------------------------------------------------ */

var api = {
  binToDec: binToDec,
  decToBin: decToBin,
  roundTripDec: roundTripDec,
  incBinary: incBinary,
  tidy: tidy,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.ConverterCore = api;
