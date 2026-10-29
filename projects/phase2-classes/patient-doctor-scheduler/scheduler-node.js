#!/usr/bin/env node
/*
 * scheduler-node.js — a CLI over the same Person hierarchy and Scheduler
 * aggregate the browser demo uses. No build step, no dependencies.
 *
 * With no arguments it loads the sample clinic and prints the day's grid — each
 * doctor's 16 slots, who is in them, and how full the day is. You can also drive
 * it as a tiny REPL, or pipe ';'-separated commands in.
 *
 * Usage:
 *   node scheduler-node.js                       # sample clinic: the day grid
 *   node scheduler-node.js --json                # same, as JSON
 *   node scheduler-node.js --empty               # start empty, then REPL
 *   echo "add doctor 'Dr. X' Cardiology; add patient 'Pat'; book P-0001 D-0001 09:00; day" \
 *        | node scheduler-node.js --empty
 *
 * REPL commands (also accepted on stdin, ';'-separated):
 *   doctors                                      list doctors (id, specialty, load)
 *   patients                                     list patients
 *   add doctor <name> [specialty] [maxPerDay]    register a doctor
 *   add patient <name> [reason]                  register a patient
 *   book <patient> <doctor> <time> [day]         book a slot (time "HH:MM" or index)
 *   booknext <patient> <doctor> [day]            book the earliest free slot
 *   cancel <doctor> <time> [day]                 cancel a slot
 *   move <doctor> <time> <newTime> [day]         reschedule within the same day/doctor
 *   who <patient>                                a patient's appointments
 *   day [YYYY-MM-DD]                             the whole-clinic grid for a day
 *   help                                         this list
 *
 * <patient>/<doctor> may be an id (P-0001 / D-0001) or a unique name.
 */
'use strict';

const core = require('./scheduler-core');
const { Slot, SchedulerError, Doctor, Patient, SLOTS_PER_DAY } = core;
const fixtures = require('./scheduler-fixtures');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

const clinic = flag('--empty') ? new core.Scheduler('My Clinic') : fixtures.buildClinic(core);
let currentDay = fixtures.DEMO_DAY;

/* ---- rendering ----------------------------------------------------- */

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

function renderDoctors(cl) {
  const docs = cl.doctors();
  if (!docs.length) return '(no doctors)';
  const rows = docs.map((d) => [d.id, d.name, d.specialization, `${d.appointmentCountOn(currentDay)}/${d.maxPerDay} on ${currentDay}`]);
  const head = ['ID', 'Name', 'Specialty', 'Load'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => '  ' + r.map((c, i) => pad(c, widths[i])).join('  ');
  return [line(head), '  ' + widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

function renderPatients(cl) {
  const pats = cl.patients();
  if (!pats.length) return '(no patients)';
  const rows = pats.map((p) => [p.id, p.name, p.reason || '']);
  const head = ['ID', 'Name', 'Reason'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => '  ' + r.map((c, i) => pad(c, widths[i])).join('  ');
  return [line(head), '  ' + widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

// The day grid: one column of slots per doctor, so double-bookings and the cap
// are visible at a glance.
function renderDay(cl, day) {
  const report = cl.dayReport(day);
  if (!report.length) return '(no doctors)';
  const out = [`  ${cl.name} — ${day}\n`];
  const nameW = Math.max(5, ...report.map((r) => r.doctor.name.length + 4));
  out.push('  ' + pad('Slot', 13) + report.map((r) => pad(`Dr. ${r.doctor.name}`, nameW)).join('  '));
  out.push('  ' + '-'.repeat(13 + (nameW + 2) * report.length));
  for (let i = 0; i < SLOTS_PER_DAY; i++) {
    const cells = report.map((r) => {
      const appt = r.doctor.appointmentsOn(day).find((a) => a.slotIndex === i);
      return pad(appt ? appt.patient.name : '·', nameW);
    });
    out.push('  ' + pad(Slot.label(i), 13) + cells.join('  '));
  }
  out.push('');
  out.push('  ' + report.map((r) => `Dr. ${r.doctor.name}: ${r.used}/${r.cap}`).join('   '));
  return out.join('\n');
}

function report(cl) {
  console.log('');
  console.log(renderDoctors(cl));
  console.log('');
  console.log(renderDay(cl, currentDay));
  console.log('');
}

/* ---- command parsing (shared by REPL and piped input) ------------- */

function splitCommands(text) { return text.split(';').map((c) => c.trim()).filter(Boolean); }
function tokenize(cmd) {
  const out = [];
  const re = /'([^']*)'|"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function findDoctor(cl, ref) {
  try { return cl.getDoctor(ref); } catch (_) { /* fall through to name match */ }
  const match = cl.doctors().filter((d) => d.name.toLowerCase() === String(ref).toLowerCase());
  if (match.length === 1) return match[0];
  if (match.length > 1) throw new SchedulerError(`"${ref}" is an ambiguous doctor — use an id`);
  throw new SchedulerError(`no doctor "${ref}"`);
}
function findPatient(cl, ref) {
  try { return cl.getPatient(ref); } catch (_) { /* fall through to name match */ }
  const match = cl.patients().filter((p) => p.name.toLowerCase() === String(ref).toLowerCase());
  if (match.length === 1) return match[0];
  if (match.length > 1) throw new SchedulerError(`"${ref}" is an ambiguous patient — use an id`);
  throw new SchedulerError(`no patient "${ref}"`);
}

function runCommand(cl, cmd) {
  const [verb, ...rest] = tokenize(cmd);
  switch ((verb || '').toLowerCase()) {
    case 'doctors': console.log(renderDoctors(cl)); break;
    case 'patients': console.log(renderPatients(cl)); break;
    case 'help': console.log(helpText()); break;
    case 'day': {
      if (rest[0]) currentDay = core.assertDay(rest[0]);
      console.log(renderDay(cl, currentDay));
      break;
    }
    case 'add': {
      const [kind, name, ...extra] = rest;
      if ((kind || '').toLowerCase() === 'doctor') {
        const d = new Doctor(name, { specialization: extra[0] || undefined, maxPerDay: extra[1] != null ? Number(extra[1]) : undefined });
        cl.addDoctor(d);
        console.log(`registered Dr. ${d.name} (${d.id}), ${d.specialization}, cap ${d.maxPerDay}/day`);
      } else if ((kind || '').toLowerCase() === 'patient') {
        const p = new Patient(name, { reason: extra.join(' ') || undefined });
        cl.addPatient(p);
        console.log(`registered ${p.name} (${p.id})`);
      } else {
        throw new SchedulerError(`add what? "doctor" or "patient", got "${kind}"`);
      }
      break;
    }
    case 'book': {
      const patient = findPatient(cl, rest[0]);
      const doctor = findDoctor(cl, rest[1]);
      const time = rest[2];
      const day = rest[3] || currentDay;
      const appt = cl.book(patient.id, doctor.id, day, time);
      console.log(`booked ${patient.name} with Dr. ${doctor.name} at ${appt.label} on ${appt.day}`);
      break;
    }
    case 'booknext': {
      const patient = findPatient(cl, rest[0]);
      const doctor = findDoctor(cl, rest[1]);
      const day = rest[2] || currentDay;
      const appt = cl.bookNext(patient.id, doctor.id, day);
      console.log(`booked ${patient.name} with Dr. ${doctor.name} at ${appt.label} on ${appt.day} (earliest free)`);
      break;
    }
    case 'cancel': {
      const doctor = findDoctor(cl, rest[0]);
      const time = rest[1];
      const day = rest[2] || currentDay;
      const appt = cl.cancel(doctor.id, day, time);
      console.log(`cancelled ${appt.patient.name} with Dr. ${doctor.name} at ${appt.label} on ${appt.day}`);
      break;
    }
    case 'move': {
      const doctor = findDoctor(cl, rest[0]);
      const time = rest[1], newTime = rest[2];
      const day = rest[3] || currentDay;
      const appt = cl.reschedule(doctor.id, day, time, { toSlot: newTime });
      console.log(`moved ${appt.patient.name} with Dr. ${doctor.name} to ${appt.label} on ${appt.day}`);
      break;
    }
    case 'who': {
      const patient = findPatient(cl, rest[0]);
      const appts = cl.appointmentsFor(patient);
      if (!appts.length) { console.log(`${patient.name} has no appointments`); break; }
      console.log(`${patient.name} (${patient.id}):`);
      for (const a of appts) console.log(`  ${a.day} ${a.label}  Dr. ${a.doctor.name} (${a.doctor.specialization})`);
      break;
    }
    case '': break;
    default: console.log(`unknown command "${verb}" — try "help"`);
  }
}

function helpText() {
  return [
    'commands:',
    '  doctors                                    list doctors',
    '  patients                                   list patients',
    '  add doctor <name> [specialty] [maxPerDay]  register a doctor',
    '  add patient <name> [reason]                register a patient',
    '  book <patient> <doctor> <time> [day]       book a slot (HH:MM or index)',
    '  booknext <patient> <doctor> [day]          book the earliest free slot',
    '  cancel <doctor> <time> [day]               cancel a slot',
    '  move <doctor> <time> <newTime> [day]       reschedule a slot',
    '  who <patient>                              a patient\'s appointments',
    '  day [YYYY-MM-DD]                           the whole-clinic grid',
  ].join('\n');
}

/* ---- entry points -------------------------------------------------- */

function runRepl() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'clinic> ' });
  console.log('Patient / Doctor Scheduler. Type "help" for commands, Ctrl-D to exit.\n');
  rl.prompt();
  rl.on('line', (line) => {
    for (const cmd of splitCommands(line)) {
      try { runCommand(clinic, cmd); } catch (e) {
        if (e instanceof SchedulerError) console.error(`error: ${e.message}`); else throw e;
      }
    }
    rl.prompt();
  });
  rl.on('close', () => { console.log(); process.exit(0); });
}

function runPiped(text) {
  for (const cmd of splitCommands(text)) {
    try { runCommand(clinic, cmd); } catch (e) {
      if (e instanceof SchedulerError) console.error(`error: ${e.message}`); else throw e;
    }
  }
}

if (flag('--json')) {
  console.log(JSON.stringify(clinic.toJSON(), null, 2));
} else if (process.stdin.isTTY) {
  if (!flag('--empty')) report(clinic);
  runRepl();
} else {
  let buf = '';
  process.stdin.on('data', (d) => (buf += d));
  process.stdin.on('end', () => {
    if (!flag('--empty') && !buf.trim()) report(clinic);
    else runPiped(buf);
  });
}
