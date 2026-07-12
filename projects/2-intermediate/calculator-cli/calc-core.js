/*
 * calc-core.js — the shared calculator engine.
 *
 * This one file is the single source of truth for the arithmetic and the
 * argument parsing. It is loaded two ways:
 *   - by the Node CLI (`calc.js`) via `require('./calc-core')`
 *   - by the browser terminal demo (`index.html`) via a plain <script> tag,
 *     which exposes it as the global `CalcCore`.
 *
 * Keeping the logic here means the CLI and the browser demo can never drift
 * apart — they run the exact same code.
 */
;(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CalcCore = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // A tagged error so callers can tell "the user typed something wrong"
  // (print a friendly message, exit 1) apart from a real bug (let it throw).
  function CalcError(message) {
    this.name = 'CalcError';
    this.message = message;
  }
  CalcError.prototype = Object.create(Error.prototype);
  CalcError.prototype.constructor = CalcError;

  // Every operation is a reducer over the list of numbers. `variadic` ops take
  // one-or-more operands; `unary` ops (sqrt) take exactly one.
  var OPERATIONS = {
    add: {
      symbol: '+', blurb: 'sum of all numbers',
      apply: function (nums) { return nums.reduce(function (a, b) { return a + b; }, 0); }
    },
    sub: {
      symbol: '-', blurb: 'subtract each number from the first',
      apply: function (nums) { return nums.reduce(function (a, b) { return a - b; }); }
    },
    mul: {
      symbol: '*', blurb: 'product of all numbers',
      apply: function (nums) { return nums.reduce(function (a, b) { return a * b; }, 1); }
    },
    div: {
      symbol: '/', blurb: 'divide the first number by each that follows',
      apply: function (nums) {
        return nums.reduce(function (a, b) {
          if (b === 0) throw new CalcError('division by zero');
          return a / b;
        });
      }
    },
    pow: {
      symbol: '^', blurb: 'raise the first number to each following power',
      apply: function (nums) { return nums.reduce(function (a, b) { return Math.pow(a, b); }); }
    },
    sqrt: {
      symbol: '√', blurb: 'square root of a single number', unary: true,
      apply: function (nums) {
        if (nums[0] < 0) throw new CalcError('cannot take the square root of a negative number');
        return Math.sqrt(nums[0]);
      }
    }
  };

  var FILTERS = {
    even: function (n) { return n % 2 === 0; },
    odd: function (n) { return Math.abs(n % 2) === 1; }
  };

  // Turn a raw argv (an array of strings, no program name) into an intent.
  function parse(argv) {
    var intent = { op: null, filter: null, float: false, help: false, raw: [] };

    argv.forEach(function (token) {
      if (token === '-h' || token === '--help') {
        intent.help = true;
      } else if (token === '-f' || token === '--float') {
        intent.float = true;
      } else if (!intent.op && Object.prototype.hasOwnProperty.call(OPERATIONS, token)) {
        intent.op = token;
      } else if (!intent.filter && Object.prototype.hasOwnProperty.call(FILTERS, token)) {
        intent.filter = token;
      } else {
        intent.raw.push(token);
      }
    });

    return intent;
  }

  // Validate + coerce the raw operand strings into numbers.
  function toNumbers(rawTokens, allowFloat) {
    return rawTokens.map(function (token) {
      // Reject anything that isn't a clean number so "add 2 banana" fails loudly.
      if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(token)) {
        throw new CalcError('"' + token + '" is not a number');
      }
      var value = Number(token);
      if (!allowFloat && !Number.isInteger(value)) {
        throw new CalcError('"' + token + '" is a float — pass -f to allow floating-point numbers');
      }
      return value;
    });
  }

  // Run a parsed intent and return the numeric result.
  function compute(intent) {
    var op = OPERATIONS[intent.op];
    var numbers = toNumbers(intent.raw, intent.float);

    if (intent.filter) {
      numbers = numbers.filter(FILTERS[intent.filter]);
    }

    if (numbers.length === 0) {
      throw new CalcError(
        intent.filter
          ? 'no ' + intent.filter + ' numbers to operate on'
          : 'give me at least one number'
      );
    }
    if (op.unary && numbers.length !== 1) {
      throw new CalcError(intent.op + ' takes exactly one number');
    }

    return op.apply(numbers);
  }

  // The top-level entry point. Returns { output } on success or throws CalcError.
  function run(argv) {
    var intent = parse(argv);

    // `calc` alone, or `--help` with no operation, prints the top-level help.
    if (intent.help && !intent.op) return { output: topHelp() };
    if (!intent.op) {
      if (intent.raw.length === 0) return { output: topHelp() };
      throw new CalcError('unknown command "' + intent.raw[0] + '" — try `calc --help`');
    }
    // `calc add --help` prints help for that one sub-command.
    if (intent.help) return { output: opHelp(intent.op) };

    var value = compute(intent);
    return { output: formatNumber(value) };
  }

  // Trim floating-point fuzz (0.1 + 0.2 -> 0.3, not 0.30000000000000004).
  function formatNumber(value) {
    if (!isFinite(value)) return String(value);
    return String(parseFloat(value.toPrecision(12)));
  }

  function topHelp() {
    var lines = [
      'calc — a tiny arithmetic CLI',
      '',
      'USAGE',
      '  calc <operation> [even|odd] [-f] <numbers...>',
      '',
      'OPERATIONS'
    ];
    Object.keys(OPERATIONS).forEach(function (name) {
      lines.push('  ' + pad(name + ' (' + OPERATIONS[name].symbol + ')', 12) + OPERATIONS[name].blurb);
    });
    lines.push('');
    lines.push('FILTERS');
    lines.push('  even        keep only even numbers before operating');
    lines.push('  odd         keep only odd numbers before operating');
    lines.push('');
    lines.push('FLAGS');
    lines.push('  -f, --float allow floating-point operands (integers only by default)');
    lines.push('  -h, --help  show this help, or help for a sub-command');
    lines.push('');
    lines.push('EXAMPLES');
    lines.push('  calc add 2 3 5            -> 10');
    lines.push('  calc add even 1 2 3 4     -> 6');
    lines.push('  calc add -f 1.5 2.5       -> 4');
    lines.push('  calc div 100 5 2          -> 10');
    lines.push('  calc pow 2 10             -> 1024');
    lines.push('  calc sqrt 144             -> 12');
    return lines.join('\n');
  }

  function opHelp(name) {
    var op = OPERATIONS[name];
    var usage = op.unary ? 'calc ' + name + ' [-f] <number>' : 'calc ' + name + ' [even|odd] [-f] <numbers...>';
    return [
      name + ' (' + op.symbol + ') — ' + op.blurb,
      '',
      'USAGE',
      '  ' + usage
    ].join('\n');
  }

  function pad(str, width) {
    while (str.length < width) str += ' ';
    return str;
  }

  return {
    CalcError: CalcError,
    OPERATIONS: OPERATIONS,
    FILTERS: FILTERS,
    parse: parse,
    compute: compute,
    run: run,
    formatNumber: formatNumber,
    topHelp: topHelp
  };
});
