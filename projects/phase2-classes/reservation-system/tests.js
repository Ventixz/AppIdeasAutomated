#!/usr/bin/env node
/*
 * tests.js — dependency-free checks for the reservation engine. Run: node tests.js
 *
 * The Classes category is about design, so these tests lean on the three things
 * the design is supposed to guarantee: a room can't be double-booked (the whole
 * point), money stays exact (integer cents), and the objects reject bad states
 * (backwards dates, impossible calendar days, unknown rooms, duplicate ids).
 * The half-open interval — checkout day frees the room — gets its own block,
 * because getting it wrong is the classic off-by-one of every booking system.
 */
'use strict';

const core = require('./reservation-core');
const { ReservationError, Money, DateRange, RoomType, Room, Reservation, Hotel } = core;
const fixtures = require('./reservation-fixtures');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function throwsErr(fn, msg) {
  try { fn(); fail++; console.error('  FAIL (no throw):', msg); }
  catch (e) { ok(e instanceof ReservationError, `${msg} — threw ${e.name}, want ReservationError`); }
}

/* --- Money: parse/format round-trip, reject junk ------------------- */
console.log('Money');
eq(Money.parse('189.50'), 18950, 'parse dollars.cents');
eq(Money.parse('119'), 11900, 'parse whole dollars');
eq(Money.parse('$1,299.00'), 129900, 'parse with $ and comma');
eq(Money.parse(0.1) + Money.parse(0.2), 30, '0.1 + 0.2 in cents is exactly 30');
eq(Money.format(18950), '$189.50', 'format cents');
eq(Money.format(129900), '$1,299.00', 'format with thousands separator');
throwsErr(() => Money.parse('189.505'), 'reject three decimals');
throwsErr(() => Money.parse('abc'), 'reject non-numeric');

/* --- DateRange: nights, validation, half-open overlap -------------- */
console.log('DateRange');
const r = new DateRange('2026-11-01', '2026-11-04');
eq(r.nights, 3, 'three nights between the 1st and the 4th');
eq(r.checkInStr, '2026-11-01', 'check-in string preserved');
eq(r.toString(), '2026-11-01 → 2026-11-04 (3 nights)', 'human string');
eq(new DateRange('2026-11-01', '2026-11-02').nights, 1, 'one-night stay is valid');

throwsErr(() => new DateRange('2026-11-04', '2026-11-01'), 'check-out before check-in rejected');
throwsErr(() => new DateRange('2026-11-01', '2026-11-01'), 'zero-night stay rejected');
throwsErr(() => new DateRange('2026-02-30', '2026-03-02'), 'impossible calendar date rejected');
throwsErr(() => new DateRange('11/01/2026', '2026-11-04'), 'wrong date format rejected');

// The off-by-one that sinks naive booking systems: the two blocks below.
const a = new DateRange('2026-11-01', '2026-11-04');
const sameDay = new DateRange('2026-11-04', '2026-11-06'); // checks in the day the other leaves
ok(!a.overlaps(sameDay), 'checkout day == check-in day is NOT an overlap (half-open)');
ok(!sameDay.overlaps(a), 'overlap is symmetric for the turnover case');
const straddle = new DateRange('2026-11-03', '2026-11-05'); // last night of A is the 3rd
ok(a.overlaps(straddle), 'a stay sharing a night DOES overlap');
ok(a.overlaps(new DateRange('2026-10-30', '2026-11-02')), 'overlap on the leading edge');
ok(!a.overlaps(new DateRange('2026-10-29', '2026-11-01')), 'ending on check-in day does not overlap');
ok(a.includesNight(DateRange._toDayNumber('2026-11-03')), 'last night is occupied');
ok(!a.includesNight(DateRange._toDayNumber('2026-11-04')), 'checkout day night is free');

/* --- RoomType & Room invariants ------------------------------------ */
console.log('RoomType / Room');
const suite = new RoomType({ name: 'Suite', rate: '329.00', beds: 2 });
eq(suite.rateCents, 32900, 'rate parsed to cents');
throwsErr(() => new RoomType({ name: '', rate: 10 }), 'blank type name rejected');
throwsErr(() => new RoomType({ name: 'X', rate: -1 }), 'negative rate rejected');
throwsErr(() => new RoomType({ name: 'X', rate: 10, beds: 0 }), 'zero beds rejected');

const room = new Room('301', suite);
eq(room.rateCents, 32900, 'room inherits its type rate');
throwsErr(() => new Room('', suite), 'blank room number rejected');
throwsErr(() => new Room('9', { name: 'fake' }), 'room needs a real RoomType');

/* --- Hotel: the no-double-booking invariant ------------------------ */
console.log('Hotel — no double-booking');
const hotel = fixtures.buildHotel(core);
eq(hotel.rooms().length, fixtures.ROOMS.length, 'all rooms added');
eq(hotel.reservations().length, fixtures.RESERVATIONS.length, 'all seed reservations booked');

// Room 101 is held 11-01→11-04, then 11-04→11-06. An overlapping stay must fail.
throwsErr(() => hotel.book('101', 'Interloper', '2026-11-03', '2026-11-05'), 'overlapping stay rejected');
// The failed booking must not have minted a reservation or touched the room.
eq(hotel.reservations().length, fixtures.RESERVATIONS.length, 'rejected booking left the count unchanged');

// But a stay that fits in a gap (room 101 is free again from the 6th) succeeds.
const fit = hotel.book('101', 'Margaret Hamilton', '2026-11-06', '2026-11-09');
eq(fit.nights, 3, 'gap booking succeeds with the right night count');
eq(fit.id, 'R-0006', 'reservation id is minted sequentially');

throwsErr(() => hotel.book('999', 'Nobody', '2026-11-01', '2026-11-02'), 'booking an unknown room throws');
throwsErr(() => hotel.book('101', '', '2026-12-01', '2026-12-02'), 'booking with a blank guest throws');

/* --- Reservation pricing: exact integer math ----------------------- */
console.log('Pricing');
// Katherine Johnson, room 301 (Suite, $329/night), 11-03 → 11-08 = 5 nights.
const kj = hotel.reservations().find((x) => x.guest === 'Katherine Johnson');
eq(kj.nights, 5, 'five-night suite stay');
eq(kj.totalCents, 32900 * 5, 'total = rate × nights, exact');
eq(Money.format(kj.totalCents), '$1,645.00', 'formatted stay total');

// Revenue is the independent hand-sum of every reservation.
let expected = 0;
for (const res of hotel.reservations()) expected += res.room.rateCents * res.range.nights;
eq(hotel.revenueCents(), expected, 'hotel revenue matches hand sum');

/* --- Availability & occupancy, derived on demand ------------------- */
console.log('Availability / occupancy');
// On the night of 11-02: rooms 101 (Ada) and 201 (Turing) are occupied.
const occ = hotel.occupancyOn('2026-11-02');
eq(occ.occupied, 2, 'two rooms occupied on 11-02');
eq(occ.total, fixtures.ROOMS.length, 'occupancy denominator is every room');

// Availability for a Deluxe over 11-02→11-05: 201 is taken by Turing, 202 is free.
const deluxeFree = hotel.availableRooms('2026-11-02', '2026-11-05', 'Deluxe').map((x) => x.number);
eq(JSON.stringify(deluxeFree), JSON.stringify(['202']), 'only the free Deluxe is offered');
// Cheapest-first ordering across all types for a wide-open week.
const anyFree = hotel.availableRooms('2026-12-01', '2026-12-03');
ok(anyFree[0].rateCents <= anyFree[anyFree.length - 1].rateCents, 'availability sorted cheapest-first');

/* --- Cancellation frees the room ----------------------------------- */
console.log('Cancellation');
const beforeRev = hotel.revenueCents();
hotel.cancel(kj.id);
throwsErr(() => hotel.getReservation(kj.id), 'cancelled reservation is gone from the index');
eq(hotel.revenueCents(), beforeRev - 32900 * 5, 'revenue drops by exactly the cancelled stay');
// Room 301 is now free for the dates the cancelled stay held.
const rebook = hotel.book('301', 'Reboot Guest', '2026-11-03', '2026-11-08');
eq(rebook.nights, 5, 'the freed room can be re-booked for the same dates');
throwsErr(() => hotel.cancel('R-9999'), 'cancelling an unknown reservation throws');

/* --- Serialization ------------------------------------------------- */
console.log('Serialization');
const json = hotel.toJSON();
ok(Array.isArray(json.reservations) && json.reservations.length === hotel.reservations().length,
  'toJSON lists every reservation');
eq(json.summary.revenueCents, hotel.revenueCents(), 'summary revenue matches');

/* ------------------------------------------------------------------ */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
