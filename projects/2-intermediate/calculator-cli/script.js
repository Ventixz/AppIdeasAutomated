/*
 * script.js — the browser terminal for the Calculator CLI demo.
 *
 * It reuses the exact same engine as the Node CLI (CalcCore, loaded from
 * calc-core.js). Typing `add 2 3 5` here runs the identical code path that
 * `node calc.js add 2 3 5` runs in a shell — the only difference is where the
 * output is printed.
 */
(function () {
  'use strict';

  var output = document.getElementById('output');
  var form = document.getElementById('prompt-form');
  var input = document.getElementById('cmd');

  var history = [];
  var historyPos = -1; // -1 means "not browsing history"

  function print(text, className) {
    var p = document.createElement('p');
    p.className = 'line ' + (className || '');
    p.textContent = text;
    output.appendChild(p);
    output.scrollTop = output.scrollHeight;
  }

  function echoCommand(text) {
    var p = document.createElement('p');
    p.className = 'line line--cmd';
    var sign = document.createElement('span');
    sign.className = 'sign';
    sign.textContent = '$';
    p.appendChild(sign);
    p.appendChild(document.createTextNode('calc ' + text));
    output.appendChild(p);
  }

  // Split a command line into tokens, respecting simple quotes.
  function tokenize(line) {
    var matches = line.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    return matches.map(function (t) {
      return t.replace(/^['"]|['"]$/g, '');
    });
  }

  function handle(line) {
    var trimmed = line.trim();
    if (!trimmed) return;

    echoCommand(trimmed);
    history.push(trimmed);
    historyPos = -1;

    // A couple of conveniences that a real shell would give you for free.
    if (trimmed === 'clear' || trimmed === 'cls') {
      output.innerHTML = '';
      return;
    }
    if (trimmed === 'help') {
      print(CalcCore.topHelp(), 'line--out');
      return;
    }

    var argv = tokenize(trimmed);
    // Let people type either "calc add 2 3" or just "add 2 3".
    if (argv[0] === 'calc') argv.shift();

    try {
      var result = CalcCore.run(argv);
      print(result.output, 'line--out');
    } catch (err) {
      if (err instanceof CalcCore.CalcError) {
        print('calc: ' + err.message, 'line--err');
      } else {
        print('calc: unexpected error — ' + err.message, 'line--err');
      }
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    handle(input.value);
    input.value = '';
  });

  // Up/down arrows walk the command history, like a real terminal.
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowUp') {
      if (!history.length) return;
      e.preventDefault();
      if (historyPos === -1) historyPos = history.length;
      historyPos = Math.max(0, historyPos - 1);
      input.value = history[historyPos];
      moveCaretToEnd();
    } else if (e.key === 'ArrowDown') {
      if (historyPos === -1) return;
      e.preventDefault();
      historyPos += 1;
      if (historyPos >= history.length) {
        historyPos = -1;
        input.value = '';
      } else {
        input.value = history[historyPos];
        moveCaretToEnd();
      }
    }
  });

  function moveCaretToEnd() {
    var v = input.value;
    input.value = '';
    input.value = v;
  }

  // Greet with the help text so the demo is self-explanatory on load.
  print(CalcCore.topHelp(), 'line--muted');
  print('', '');
  input.focus();
  document.addEventListener('click', function () { input.focus(); });
})();
