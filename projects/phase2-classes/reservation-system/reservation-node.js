#!/usr/bin/env node
/*
 * reservation-node.js — a CLI front end over the same Hotel/Room/Reservation
 * classes the browser demo uses. No build step, no dependencies.
 *
 * With no arguments it loads the sample hotel and prints the reservation list,
 * a room roster, and the booked-revenue total. You can also drive it as a tiny
 * REPL of booking commands, or pipe commands in.
 *
 * Usage:
 *   node reservation-node.js                       # demo hotel + report
 *   node reservation-node.js --json                # same, as JSON
 *   node reservation-node.js --empty               # start with no bookings, then REPL
 *   echo "avail 2026-11-02 2026-11-05; book 202 'J Doe' 2026-11-02 2026-11-05" \
 *        | node reservation-node.js
 *
 * REPL commands (also accepted on stdin, ';'-separated):
 *   rooms                            list the rooms and their types
 *   avail <in> <out> [type]          rooms free for a stay (optionally one type)
 *   book <room> <guest> <in> <out>   book a room; refuses to double-book
 *   cancel <id>                      cancel a reservation, freeing the room
 *   list                             every reservation, by check-in
 *   occupancy <date>                 rooms occupied on a given night
 *   revenue                          total booked revenue
 *   json | help | quit
 *
 * Guest names with spaces go in quotes: book 202 "Jane Doe" 2026-11-02 2026-11-05
 * Dates are YYYY-MM-DD.
 */
'use strict';

const readline = require('readline');
const core = require('./reservation-core');
const { ReservationError, Money, DateRange } = core;
const fixtures = require('./reservation-fixtures');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const startEmpty = args.includes('--empty');

let hotel;
if (startEmpty) {
  hotel = new core.Hotel(fixtures.HOTEL_NAME);
  for (const spec of fixtures.ROOM_TYPES) hotel.addRoomType(spec);
  for (const [number, type] of fixtures.ROOMS) hotel.addRoom(number, type);
} else {
  hotel = fixtures.buildHotel(core);
}

/* ---- rendering ---------------------------------------------------- */

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function roomRoster() {
  const lines = [pad('ROOM', 7) + pad('TYPE', 12) + padL('RATE/NIGHT', 12), '-'.repeat(31)];
  for (const r of hotel.rooms()) {
    lines.push(pad(r.number, 7) + pad(r.typeName, 12) + padL(Money.format(r.rateCents), 12));
  }
  return lines.join('\n');
}

function reservationList() {
  const rows = hotel.reservations();
  if (!rows.length) return '(no reservations)';
  const lines = [
    pad('ID', 8) + pad('ROOM', 6) + pad('GUEST', 22) + pad('CHECK-IN', 12) + pad('CHECK-OUT', 12) + padL('NIGHTS', 7) + padL('TOTAL', 12),
    '-'.repeat(79),
  ];
  for (const r of rows) {
    lines.push(
      pad(r.id, 8) + pad(r.room.number, 6) +
      pad(r.guest.length > 21 ? r.guest.slice(0, 20) + '…' : r.guest, 22) +
      pad(r.range.checkInStr, 12) + pad(r.range.checkOutStr, 12) +
      padL(r.nights, 7) + padL(Money.format(r.totalCents), 12)
    );
  }
  lines.push('-'.repeat(79));
  const s = hotel.summary();
  lines.push(pad(`${s.reservationCount} reservations`, 48) + padL('revenue', 18) + padL(Money.format(s.revenueCents), 13));
  return lines.join('\n');
}

function showAll() {
  if (asJson) { console.log(JSON.stringify(hotel.toJSON(), null, 2)); return; }
  console.log(`${hotel.name} — ${hotel.rooms().length} rooms, ${hotel.roomTypes().length} types\n`);
  console.log(roomRoster());
  console.log('');
  console.log(reservationList());
}

/* ---- command handling (shared by one-shot and REPL) --------------- */

function tokenize(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function runCommand(line) {
  const [cmd, ...rest] = tokenize(line.trim());
  if (!cmd) return;
  switch (cmd.toLowerCase()) {
    case 'rooms': console.log(roomRoster()); break;
    case 'list': console.log(reservationList()); break;
    case 'avail': {
      const [checkIn, checkOut, type] = rest;
      const free = hotel.availableRooms(checkIn, checkOut, type || null);
      const range = new DateRange(checkIn, checkOut);
      console.log(
        free.length
          ? `Free for ${range} (${free.length}):\n` +
            free.map((r) => `  ${pad(r.number, 6)} ${pad(r.typeName, 12)} ${Money.format(r.rateCents)}/night`).join('\n')
          : `No rooms free for ${range}${type ? ` of type ${type}` : ''}`
      );
      break;
    }
    case 'book': {
      const [room, guest, checkIn, checkOut] = rest;
      const res = hotel.book(room, guest, checkIn, checkOut);
      console.log(`booked ${res.id}: ${res.guest}, room ${res.room.number}, ${res.range} — ${Money.format(res.totalCents)}`);
      break;
    }
    case 'cancel': {
      const res = hotel.cancel(rest[0]);
      console.log(`cancelled ${res.id} (room ${res.room.number} freed for ${res.range.checkInStr} → ${res.range.checkOutStr})`);
      break;
    }
    case 'occupancy': case 'occ': {
      const o = hotel.occupancyOn(rest[0]);
      console.log(`${o.date}: ${o.occupied} / ${o.total} rooms occupied (${(o.rate * 100).toFixed(0)}%)`);
      break;
    }
    case 'revenue': console.log(`Total booked revenue: ${Money.format(hotel.revenueCents())}`); break;
    case 'json': console.log(JSON.stringify(hotel.toJSON(), null, 2)); break;
    case 'help': console.log('rooms avail book cancel list occupancy revenue json quit'); break;
    case 'quit': case 'exit': return 'quit';
    default: console.log(`unknown command: ${cmd} (try "help")`);
  }
}

function safe(line) {
  try { return runCommand(line); }
  catch (e) {
    if (e instanceof ReservationError) console.error(`error: ${e.message}`);
    else throw e;
  }
}

/* ---- entry point -------------------------------------------------- */

const positional = args.filter((a) => !a.startsWith('--'));

if (positional.length) {
  for (const c of positional.join(' ').split(';')) if (c.trim()) safe(c);
} else if (process.stdin.isTTY) {
  showAll();
  console.log('\nType commands ("help" for the list, "quit" to exit).');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'hotel> ' });
  rl.prompt();
  rl.on('line', (line) => { if (safe(line) === 'quit') rl.close(); else rl.prompt(); });
  rl.on('close', () => process.exit(0));
} else {
  let buf = '';
  process.stdin.on('data', (d) => (buf += d));
  process.stdin.on('end', () => {
    const cmds = buf.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
    if (!cmds.length) showAll();
    else for (const c of cmds) safe(c);
  });
}
