#!/usr/bin/env node
/*
 * calc.js — the command-line entry point.
 *
 * All the actual logic lives in calc-core.js; this file just wires Node's
 * process.argv to it and turns the result (or a user error) into stdout /
 * stderr and an exit code.
 *
 *   $ node calc.js add 2 3 5
 *   10
 *   $ node calc.js --help
 */
'use strict';

var CalcCore = require('./calc-core');

function main(argv) {
  try {
    var result = CalcCore.run(argv);
    process.stdout.write(result.output + '\n');
    return 0;
  } catch (err) {
    if (err instanceof CalcCore.CalcError) {
      process.stderr.write('calc: ' + err.message + '\n');
      return 1;
    }
    throw err; // a real bug — let it surface with a stack trace
  }
}

process.exit(main(process.argv.slice(2)));
