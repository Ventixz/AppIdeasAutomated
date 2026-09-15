/*
 * card-core.js — the DOM-free, I/O-free brain of Credit Card Validator.
 *
 * The task ("given a credit card number, determine if it is a valid number")
 * is, at heart, one small piece of arithmetic — the **Luhn algorithm**, a
 * checksum Hans Peter Luhn patented for IBM in 1960 — wrapped in a lot of
 * pattern-matching about *which* network a number belongs to. Neither part
 * needs the DOM, a network, or any real card data, so all of it lives here:
 *
 *   - luhnChecksum() / isValidLuhn() / luhnCheckDigit() — the checksum itself
 *   - detectNetwork()   — Visa, Mastercard, Amex, Discover, Diners, JCB,
 *                         UnionPay, Maestro — from IIN/BIN prefixes + length
 *   - validate()        — the whole picture for one input: digits, Luhn pass,
 *                         network, length check, a formatted and a masked form,
 *                         and a plain-English reason when it fails
 *   - format() / mask() — group into the network's own spacing; hide the middle
 *   - generate()        — a *fake* but Luhn-valid number for a network, so the
 *                         tests (and the demo) never touch a real card
 *
 * A word on safety: this validates *structure*, not authority. A number can be
 * perfectly Luhn-valid and correctly shaped for Visa and still not be a real,
 * issued, funded card — only the issuer knows that. Everything here is offline
 * arithmetic on made-up digits.
 *
 * Every function takes plain strings/arrays and returns plain values, so the
 * suite can check the checksum, the round-trips and the network table without a
 * browser. The file runs unchanged in the browser (it attaches to
 * `window.CardCore`) and under Node (`module.exports`).
 */

'use strict';

/* ---------- digit helpers --------------------------------------------- */

/*
 * onlyDigits("4111 1111-1111 1111") -> "4111111111111111".
 * Strips spaces, dashes and any other non-digit so the rest of the module can
 * assume a clean string of 0-9. Rejects non-strings up front.
 */
function onlyDigits(input) {
  if (typeof input !== 'string' && typeof input !== 'number') {
    throw new Error('card number must be a string or number');
  }
  return String(input).replace(/[^0-9]/g, '');
}

/* True if `str` is a non-empty run of ASCII digits and nothing else. */
function isDigitString(str) {
  return typeof str === 'string' && /^[0-9]+$/.test(str) && str.length > 0;
}

/* ---------- the Luhn checksum ----------------------------------------- */

/*
 * luhnChecksum("4111111111111111") -> 0..9.
 *
 * The core arithmetic. Walking right-to-left, every second digit is doubled;
 * a double over 9 has 9 subtracted (equivalently, its two digits are summed).
 * The checksum is the grand total modulo 10 — a *valid* number totals 0.
 *
 * Doubling is done with a tiny lookup table rather than `d*2>9 ? d*2-9 : d*2`
 * so the intent ("sum the digits of the doubled value") is impossible to get
 * subtly wrong.
 */
var DOUBLED = [0, 2, 4, 6, 8, 1, 3, 5, 7, 9]; // digit d doubled, digits summed
function luhnChecksum(digits) {
  if (!isDigitString(digits)) throw new Error('luhnChecksum expects a non-empty digit string');
  var sum = 0;
  var dbl = false; // the rightmost digit is NOT doubled
  for (var i = digits.length - 1; i >= 0; i--) {
    var d = digits.charCodeAt(i) - 48; // '0' is 48
    sum += dbl ? DOUBLED[d] : d;
    dbl = !dbl;
  }
  return sum % 10;
}

/* isValidLuhn("4111111111111111") -> true. Tolerant of spaces/dashes. */
function isValidLuhn(input) {
  var digits = onlyDigits(input);
  if (digits.length === 0) return false;
  return luhnChecksum(digits) === 0;
}

/*
 * luhnCheckDigit("411111111111111") -> 1.
 *
 * Given a number WITHOUT its final check digit, return the digit that, appended,
 * makes the whole thing Luhn-valid. This is how a valid number is built (and how
 * generate() finishes one). It is the exact inverse of stripping the last digit
 * and checking: the returned digit d satisfies luhnChecksum(partial + d) === 0.
 */
function luhnCheckDigit(partial) {
  if (!isDigitString(partial)) throw new Error('luhnCheckDigit expects a non-empty digit string');
  // Treat the missing last position as a (not-doubled) 0, then find the digit
  // that zeroes the checksum. Because the appended digit sits in the
  // not-doubled position, its contribution is itself.
  var sum = 0;
  var dbl = true; // the appended digit is not doubled, so the one before it IS
  for (var i = partial.length - 1; i >= 0; i--) {
    var d = partial.charCodeAt(i) - 48;
    sum += dbl ? DOUBLED[d] : d;
    dbl = !dbl;
  }
  return (10 - (sum % 10)) % 10;
}

/* ---------- card networks --------------------------------------------- */

/*
 * The network table. Each entry knows how to recognise its own numbers from the
 * leading digits (the Issuer Identification Number, or IIN/BIN) and which total
 * lengths it issues. `test(digits)` returns true when the prefix matches; it may
 * look at as many leading digits as it needs. Order matters only in that
 * detectNetwork() returns the first match, and the ranges here are disjoint
 * enough that the common networks don't collide.
 *
 * These prefix ranges are the well-documented, publicly published IIN ranges;
 * they are what a validator uses to *label* a number, and are independent of the
 * Luhn check (a number can match a network's prefix yet fail Luhn, and vice
 * versa).
 */
function inRange(prefix, low, high) {
  // Compare the first N digits numerically, where N = number of digits in `low`.
  var n = String(low).length;
  if (prefix.length < n) return false;
  var head = parseInt(prefix.slice(0, n), 10);
  return head >= low && head <= high;
}

var NETWORKS = [
  {
    id: 'amex', name: 'American Express', lengths: [15], gaps: [4, 6, 5], cvvLength: 4,
    test: function (d) { return inRange(d, 34, 34) || inRange(d, 37, 37); }
  },
  {
    id: 'visa', name: 'Visa', lengths: [13, 16, 19], gaps: [4, 4, 4, 4], cvvLength: 3,
    test: function (d) { return d.charAt(0) === '4'; }
  },
  {
    id: 'mastercard', name: 'Mastercard', lengths: [16], gaps: [4, 4, 4, 4], cvvLength: 3,
    test: function (d) { return inRange(d, 51, 55) || inRange(d, 2221, 2720); }
  },
  {
    id: 'discover', name: 'Discover', lengths: [16, 17, 18, 19], gaps: [4, 4, 4, 4], cvvLength: 3,
    test: function (d) {
      return inRange(d, 6011, 6011) || inRange(d, 644, 649) ||
             d.slice(0, 2) === '65' || inRange(d, 622126, 622925);
    }
  },
  {
    id: 'diners', name: 'Diners Club', lengths: [14, 16, 19], gaps: [4, 6, 4], cvvLength: 3,
    test: function (d) {
      return inRange(d, 300, 305) || d.slice(0, 4) === '3095' ||
             d.slice(0, 2) === '36' || d.slice(0, 2) === '38' || d.slice(0, 2) === '39';
    }
  },
  {
    id: 'jcb', name: 'JCB', lengths: [16, 17, 18, 19], gaps: [4, 4, 4, 4], cvvLength: 3,
    test: function (d) { return inRange(d, 3528, 3589); }
  },
  {
    id: 'unionpay', name: 'UnionPay', lengths: [16, 17, 18, 19], gaps: [4, 4, 4, 4], cvvLength: 3,
    test: function (d) { return d.slice(0, 2) === '62' || d.slice(0, 2) === '81'; }
  },
  {
    id: 'maestro', name: 'Maestro', lengths: [12, 13, 14, 15, 16, 17, 18, 19], gaps: [4, 4, 4, 4], cvvLength: 3,
    test: function (d) {
      return d.slice(0, 4) === '5018' || d.slice(0, 4) === '5020' ||
             d.slice(0, 4) === '5038' || d.slice(0, 4) === '6304' ||
             d.slice(0, 4) === '6759' || d.slice(0, 4) === '6761' ||
             d.slice(0, 4) === '6763' || d.slice(0, 2) === '50' ||
             inRange(d, 56, 69);
    }
  }
];

/*
 * detectNetwork("4111 1111 1111 1111") -> { id, name, lengths, gaps, cvvLength }
 *   (a copy), or null if no known network claims the prefix.
 *
 * Matching is by prefix only — it does NOT require the length to be right or the
 * Luhn check to pass, because you want to name a number's network even while it
 * is being typed. validate() layers the length and Luhn checks on top.
 */
function detectNetwork(input) {
  var d = onlyDigits(input);
  if (d.length === 0) return null;
  for (var i = 0; i < NETWORKS.length; i++) {
    if (NETWORKS[i].test(d)) return copyNetwork(NETWORKS[i]);
  }
  return null;
}

function copyNetwork(n) {
  return { id: n.id, name: n.name, lengths: n.lengths.slice(), gaps: n.gaps.slice(), cvvLength: n.cvvLength };
}

/* Look a network up by its id, e.g. networkById('visa'). null if unknown. */
function networkById(id) {
  for (var i = 0; i < NETWORKS.length; i++) if (NETWORKS[i].id === id) return copyNetwork(NETWORKS[i]);
  return null;
}

/* All network ids, for building a picker. */
function networkIds() { return NETWORKS.map(function (n) { return n.id; }); }

/* ---------- formatting & masking -------------------------------------- */

/*
 * format("4111111111111111") -> "4111 1111 1111 1111".
 * format("378282246310005")  -> "3782 822463 10005"   (Amex groups 4-6-5).
 *
 * Groups the digits into the detected network's own spacing (`gaps`), so the
 * display matches what's printed on the physical card. Unknown networks fall
 * back to groups of four. Never throws — a partial number is grouped as far as
 * it goes.
 */
function format(input, opts) {
  var d = onlyDigits(input);
  if (d.length === 0) return '';
  var sep = (opts && opts.separator) || ' ';
  var net = detectNetwork(d);
  var gaps = net ? net.gaps : null;
  var out = [];
  if (gaps) {
    var pos = 0;
    for (var g = 0; g < gaps.length && pos < d.length; g++) {
      out.push(d.slice(pos, pos + gaps[g]));
      pos += gaps[g];
    }
    if (pos < d.length) out.push(d.slice(pos)); // anything past the template
    return out.filter(Boolean).join(sep);
  }
  // Default: groups of four.
  return d.replace(/(.{4})/g, '$1' + sep).trim().replace(new RegExp(sep + '$'), '');
}

/*
 * mask("4111111111111111") -> "•••• •••• •••• 1111".
 *
 * Hides everything but the last four digits (the most anyone should ever show),
 * keeping the network's grouping. `visibleLast` (default 4) and the mask glyph
 * are configurable.
 */
function mask(input, opts) {
  var d = onlyDigits(input);
  if (d.length === 0) return '';
  var last = opts && opts.visibleLast != null ? opts.visibleLast : 4;
  var glyph = (opts && opts.glyph) || '•';
  last = Math.max(0, Math.min(last, d.length));
  var hiddenCount = d.length - last;
  var masked = new Array(hiddenCount + 1).join(glyph) + d.slice(hiddenCount);
  // Re-group the masked string using the real digits' network template so the
  // spacing still matches the physical card.
  return regroup(masked, detectNetwork(d));
}

/* Group an already-built (possibly masked) string by a network template. */
function regroup(chars, net) {
  var gaps = net ? net.gaps : null;
  if (!gaps) return chars.replace(/(.{4})/g, '$1 ').trim();
  var out = [], pos = 0;
  for (var g = 0; g < gaps.length && pos < chars.length; g++) {
    out.push(chars.slice(pos, pos + gaps[g]));
    pos += gaps[g];
  }
  if (pos < chars.length) out.push(chars.slice(pos));
  return out.filter(Boolean).join(' ');
}

/* ---------- the whole picture: validate() ----------------------------- */

/*
 * validate("4111 1111 1111 1111") -> {
 *   input, digits, length,
 *   network,            // {id,name,...} or null
 *   luhnValid,          // does the checksum pass?
 *   lengthValid,        // is the length one the network issues? (null if no network)
 *   valid,              // luhnValid AND (network ? lengthValid : true) AND digits present
 *   formatted, masked,  // display strings
 *   errors              // [] when valid, else plain-English reasons
 * }
 *
 * The single call the UI (and most callers) actually want: it says yes/no *and*
 * why. "valid" is deliberately strict — a Visa-shaped number of the wrong length
 * is not valid even if the digits happen to pass Luhn — but each sub-result is
 * exposed so a caller can be more lenient if it wants.
 */
function validate(input) {
  var digits = onlyDigits(input);
  var errors = [];

  if (digits.length === 0) {
    return {
      input: input == null ? '' : String(input),
      digits: '', length: 0, network: null,
      luhnValid: false, lengthValid: null, valid: false,
      formatted: '', masked: '', errors: ['No digits found.']
    };
  }

  var net = detectNetwork(digits);
  var luhnValid = luhnChecksum(digits) === 0;
  var lengthValid = net ? net.lengths.indexOf(digits.length) !== -1 : null;

  if (!luhnValid) errors.push('Fails the Luhn checksum.');
  if (net && !lengthValid) {
    errors.push(net.name + ' numbers are ' + humanLengths(net.lengths) +
                ' digits long, but this is ' + digits.length + '.');
  }
  if (!net) {
    errors.push('No known card network matches this prefix.');
  }

  var valid = luhnValid && (net ? lengthValid : true) && digits.length > 0;

  return {
    input: String(input),
    digits: digits,
    length: digits.length,
    network: net,
    luhnValid: luhnValid,
    lengthValid: lengthValid,
    valid: valid,
    formatted: format(digits),
    masked: mask(digits),
    errors: errors
  };
}

/* "13, 16 or 19" from [13,16,19]; "16" from [16]. */
function humanLengths(lengths) {
  if (lengths.length === 1) return String(lengths[0]);
  return lengths.slice(0, -1).join(', ') + ' or ' + lengths[lengths.length - 1];
}

/* ---------- generating fake-but-valid numbers ------------------------- */

/*
 * generate('visa') -> a Luhn-valid, correctly-shaped, entirely FAKE Visa number.
 *
 * Fills the network's leading digits with a real IIN prefix, pads the middle
 * with random digits, then appends the Luhn check digit so the result passes.
 * These are for tests and demos only — they are not issued cards and cannot be
 * charged. `rand` is injectable so the suite can make generation deterministic.
 */
var SAMPLE_PREFIX = {
  amex: '37', visa: '4', mastercard: '52', discover: '6011',
  diners: '36', jcb: '3538', unionpay: '62', maestro: '6304'
};
function generate(networkId, opts) {
  var net = networkById(networkId);
  if (!net) throw new Error('unknown network: ' + networkId);
  var rand = (opts && opts.rand) || Math.random;
  var length = (opts && opts.length) || net.lengths[net.lengths.length === 1 ? 0 : Math.floor(rand() * net.lengths.length)];
  if (net.lengths.indexOf(length) === -1) throw new Error(net.name + ' does not issue ' + length + '-digit numbers');

  var prefix = SAMPLE_PREFIX[networkId] || '';
  var body = prefix;
  while (body.length < length - 1) {
    body += String(Math.floor(rand() * 10));
  }
  body = body.slice(0, length - 1); // exactly one short of full length
  return body + String(luhnCheckDigit(body));
}

/* ---------- exports --------------------------------------------------- */

var CardCore = {
  onlyDigits: onlyDigits,
  isDigitString: isDigitString,
  luhnChecksum: luhnChecksum,
  isValidLuhn: isValidLuhn,
  luhnCheckDigit: luhnCheckDigit,
  detectNetwork: detectNetwork,
  networkById: networkById,
  networkIds: networkIds,
  NETWORKS: NETWORKS.map(copyNetwork),
  format: format,
  mask: mask,
  validate: validate,
  humanLengths: humanLengths,
  generate: generate
};

if (typeof module !== 'undefined' && module.exports) { module.exports = CardCore; }
if (typeof window !== 'undefined') { window.CardCore = CardCore; }
