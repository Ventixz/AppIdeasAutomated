/*
 * reservation-fixtures.js — a sample hotel shared by the browser demo, the CLI
 * and the tests, so all three talk about the same property.
 *
 * Rates are written as human dollar strings and parsed to cents by RoomType —
 * exactly how a rate sheet would arrive. The room types are the "sections" the
 * task describes (standard vs suite vs penthouse, cheap to dear), and the seed
 * reservations are picked to show the interesting cases: a room booked back to
 * back with a same-day turnover (no clash), and rooms left free so the
 * availability view has something to show.
 */
'use strict';

const HOTEL_NAME = 'The Automated Arms';

const ROOM_TYPES = [
  { name: 'Standard',  rate: '119.00', beds: 1, description: 'One queen bed, courtyard side.' },
  { name: 'Deluxe',    rate: '189.50', beds: 1, description: 'One king bed, city view.' },
  { name: 'Twin',      rate: '149.00', beds: 2, description: 'Two double beds, good for families.' },
  { name: 'Suite',     rate: '329.00', beds: 2, description: 'Separate living room, corner view.' },
  { name: 'Penthouse', rate: '899.00', beds: 3, description: 'Top floor, terrace, the works.' },
];

// [roomNumber, typeName]
const ROOMS = [
  ['101', 'Standard'], ['102', 'Standard'], ['103', 'Twin'],
  ['201', 'Deluxe'],   ['202', 'Deluxe'],   ['203', 'Twin'],
  ['301', 'Suite'],    ['302', 'Suite'],
  ['401', 'Penthouse'],
];

// [roomNumber, guest, checkIn, checkOut]
const RESERVATIONS = [
  ['101', 'Ada Lovelace',      '2026-11-01', '2026-11-04'],
  ['101', 'Grace Hopper',      '2026-11-04', '2026-11-06'], // same-day turnover — legal, no clash
  ['201', 'Alan Turing',       '2026-11-02', '2026-11-05'],
  ['301', 'Katherine Johnson', '2026-11-03', '2026-11-08'],
  ['401', 'Hedy Lamarr',       '2026-11-10', '2026-11-12'],
];

// Build the sample hotel from the fixtures above, using the given core API
// (passed in so this file stays free of any require/window assumption). The
// three front ends and the tests all call this, so they start identical.
function buildHotel(core) {
  const hotel = new core.Hotel(HOTEL_NAME);
  for (const spec of ROOM_TYPES) hotel.addRoomType(spec);
  for (const [number, type] of ROOMS) hotel.addRoom(number, type);
  for (const [room, guest, checkIn, checkOut] of RESERVATIONS) hotel.book(room, guest, checkIn, checkOut);
  return hotel;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HOTEL_NAME, ROOM_TYPES, ROOMS, RESERVATIONS, buildHotel };
}
if (typeof window !== 'undefined') {
  window.ReservationFixtures = { HOTEL_NAME, ROOM_TYPES, ROOMS, RESERVATIONS, buildHotel };
}
