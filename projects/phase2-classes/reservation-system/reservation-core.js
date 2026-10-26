/*
 * reservation-core.js — a hotel reservation system as classes, DOM-free.
 *
 * The task ("Airline / Hotel Reservation System") is the third of karan/Projects'
 * Classes category: "book airline seats or hotel rooms, charging various rates
 * for particular sections — first class costs more than coach, a suite costs
 * more than a standard room." Like every task in this category, the point is the
 * *design*, not the feature list. "A hotel has rooms of different types at
 * different rates; a guest books a room for a stay" is one sentence, and it hides
 * the three things a naive version gets wrong. This engine is built around them:
 *
 *   1. A ROOM CANNOT BE DOUBLE-BOOKED. This is the whole reason a reservation
 *      system is hard: two stays that overlap in time on the same room is the
 *      one state the system must never enter. The guard lives in `Room` — it
 *      refuses an overlapping reservation rather than quietly accepting it — so
 *      no front end (browser, CLI, a future API) can route around it. Nights are
 *      HALF-OPEN intervals: checkout morning frees the room for someone else's
 *      checkout-day check-in, exactly as a real hotel turns a room over.
 *
 *   2. MONEY IS INTEGER CENTS, never a float. A stay's price is a nightly rate
 *      times a night count, summed across a property — `0.1 + 0.2 !== 0.3` in
 *      IEEE-754, so rates live as integer cents (`Money.parse`/`Money.format`)
 *      and every total is exact integer arithmetic.
 *
 *   3. THE HOTEL IS AN AGGREGATE WITH ONE INDEX OF TRUTH. Rooms live in a Map
 *      keyed by number, reservations in a Map keyed by id; every rollup
 *      (availability, occupancy, revenue) is derived from those on demand, so
 *      the summary can never disagree with the bookings you see. A reservation
 *      also lives on its room, so the room owns its own calendar and the
 *      overlap check is a local question.
 *
 * Nothing here touches the DOM, the clock as a hidden global, or the network.
 * `reservation-node.js` drives these classes from a CLI, `script.js` drives them
 * in a browser, and `tests.js` drives them with fixed data. One engine, three
 * front ends.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Errors — one named type so callers (and tests) can tell a rejected
 * operation (double-booking, bad date, unknown room) from a real bug.
 * ------------------------------------------------------------------ */

class ReservationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReservationError';
  }
}

/* ------------------------------------------------------------------ *
 * Money — integer cents in, formatted dollars out. A flat helper rather
 * than a class because a cent amount IS just an integer; wrapping every
 * rate in an object would buy nothing.
 * ------------------------------------------------------------------ */

const Money = {
  // "189", "189.50", "$1,299.00", 189.5 -> cents. Rejects >2 decimals or junk.
  parse(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new ReservationError('rate must be a finite number');
      return Money.parse(value.toFixed(2));
    }
    if (typeof value !== 'string') throw new ReservationError('rate must be a number or string');
    const cleaned = value.trim().replace(/^\$/, '').replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
      throw new ReservationError(`"${value}" is not a valid rate (use e.g. 189 or 189.50)`);
    }
    const [dollars, cents = ''] = cleaned.split('.');
    return Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
  },

  // 18950 -> "$189.50". Sign sits outside the $.
  format(cents) {
    if (!Number.isInteger(cents)) throw new ReservationError('cents must be an integer');
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    const dollars = Math.floor(abs / 100);
    const rem = String(abs % 100).padStart(2, '0');
    return `${sign}$${dollars.toLocaleString('en-US')}.${rem}`;
  },
};

/* ------------------------------------------------------------------ *
 * DateRange — a check-in / check-out stay, measured in whole days.
 *
 * Dates are kept as integer "day numbers" (days since the Unix epoch, in
 * UTC) so overlap and night-counting are plain integer comparisons with
 * no timezone or DST surprises. The interval is HALF-OPEN [checkIn,
 * checkOut): the night of the checkout day belongs to the next guest,
 * which is why a checkout and a same-day check-in do NOT conflict.
 * ------------------------------------------------------------------ */

const MS_PER_DAY = 86400000;

class DateRange {
  constructor(checkIn, checkOut) {
    this.checkIn = DateRange._toDayNumber(checkIn, 'check-in');
    this.checkOut = DateRange._toDayNumber(checkOut, 'check-out');
    if (this.checkOut <= this.checkIn) {
      throw new ReservationError(
        `check-out (${DateRange._toStr(this.checkOut)}) must be after ` +
        `check-in (${DateRange._toStr(this.checkIn)}) — a stay is at least one night`
      );
    }
    this.checkInStr = DateRange._toStr(this.checkIn);
    this.checkOutStr = DateRange._toStr(this.checkOut);
  }

  get nights() {
    return this.checkOut - this.checkIn;
  }

  // Half-open overlap: two stays clash iff each starts before the other ends.
  // Shared checkout/check-in day (a == b boundary) is NOT a clash.
  overlaps(other) {
    return this.checkIn < other.checkOut && other.checkIn < this.checkOut;
  }

  // Is a given day one of the nights occupied by this stay? (checkout excluded)
  includesNight(dayNumber) {
    return dayNumber >= this.checkIn && dayNumber < this.checkOut;
  }

  toString() {
    return `${this.checkInStr} → ${this.checkOutStr} (${this.nights} night${this.nights === 1 ? '' : 's'})`;
  }

  // "YYYY-MM-DD" or a Date -> integer day number. Strict: rejects a string
  // that isn't a real calendar date (so 2026-02-30 is caught, not silently
  // rolled to March).
  static _toDayNumber(value, label) {
    if (value instanceof DateRange) throw new ReservationError('expected a date, got a DateRange');
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) throw new ReservationError(`${label} is an invalid Date`);
      return Math.floor(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) / MS_PER_DAY);
    }
    const s = String(value == null ? '' : value).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) throw new ReservationError(`${label} must be a date as YYYY-MM-DD, got "${value}"`);
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const ms = Date.UTC(y, mo - 1, d);
    const back = new Date(ms);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
      throw new ReservationError(`${label} "${value}" is not a real calendar date`);
    }
    return Math.floor(ms / MS_PER_DAY);
  }

  static _toStr(dayNumber) {
    return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
  }

  // Build from loose input, passing a DateRange straight through.
  static of(checkIn, checkOut) {
    return checkIn instanceof DateRange ? checkIn : new DateRange(checkIn, checkOut);
  }
}

/* ------------------------------------------------------------------ *
 * RoomType — the "section" the task talks about: a named class of room
 * (or fare) with its own nightly rate. First class vs coach, suite vs
 * standard. Rate is integer cents; the type is immutable once built.
 * ------------------------------------------------------------------ */

class RoomType {
  constructor({ name, rate, beds = 1, description = '' }) {
    const cleanName = String(name == null ? '' : name).trim();
    if (!cleanName) throw new ReservationError('room type needs a name');
    this.name = cleanName;
    this.rateCents = Money.parse(rate);
    if (this.rateCents < 0) throw new ReservationError('rate cannot be negative');
    if (!Number.isInteger(beds) || beds < 1) {
      throw new ReservationError(`beds must be a positive whole number, got ${beds}`);
    }
    this.beds = beds;
    this.description = String(description).trim();
  }

  toJSON() {
    return { name: this.name, rateCents: this.rateCents, beds: this.beds, description: this.description };
  }
}

/* ------------------------------------------------------------------ *
 * Room — a single bookable unit of a given RoomType. It owns its own
 * calendar (the reservations on it) and is the one place the no-overlap
 * invariant is enforced: `_attach` refuses a clashing stay. Nothing can
 * reach in and push an overlapping reservation past that guard.
 * ------------------------------------------------------------------ */

class Room {
  constructor(number, type) {
    const cleanNumber = String(number == null ? '' : number).trim();
    if (!cleanNumber) throw new ReservationError('room number is required');
    if (!(type instanceof RoomType)) throw new ReservationError(`room ${cleanNumber} needs a RoomType`);
    this.number = cleanNumber;
    this.type = type;
    this._reservations = []; // Reservation[] on this room; the room's calendar
  }

  get rateCents() {
    return this.type.rateCents;
  }

  get typeName() {
    return this.type.name;
  }

  // The first reservation whose stay overlaps `range`, or null if the room
  // is free for that range. The single source of the overlap answer.
  clashFor(range) {
    return this._reservations.find((r) => r.range.overlaps(range)) || null;
  }

  isAvailable(range) {
    return this.clashFor(range) === null;
  }

  // THE invariant. The only way a reservation lands on a room's calendar,
  // and it throws rather than ever accepting an overlap.
  _attach(reservation) {
    const clash = this.clashFor(reservation.range);
    if (clash) {
      throw new ReservationError(
        `room ${this.number} is already booked ${clash.range.checkInStr} → ${clash.range.checkOutStr} ` +
        `(reservation ${clash.id}); cannot also book ${reservation.range.checkInStr} → ${reservation.range.checkOutStr}`
      );
    }
    this._reservations.push(reservation);
  }

  _detach(reservationId) {
    const i = this._reservations.findIndex((r) => r.id === reservationId);
    if (i === -1) throw new ReservationError(`reservation ${reservationId} is not on room ${this.number}`);
    this._reservations.splice(i, 1);
  }

  // The room's stays, earliest check-in first.
  reservations() {
    return [...this._reservations].sort((a, b) => a.range.checkIn - b.range.checkIn);
  }

  toJSON() {
    return {
      number: this.number,
      type: this.type.name,
      rateCents: this.rateCents,
      reservations: this.reservations().map((r) => r.id),
    };
  }
}

/* ------------------------------------------------------------------ *
 * Reservation — one guest, one room, one stay. Its price is DERIVED
 * (rate × nights), never stored, so it can't drift from the room's rate.
 * ------------------------------------------------------------------ */

class Reservation {
  constructor({ id, guest, room, range }) {
    const cleanId = String(id == null ? '' : id).trim();
    if (!cleanId) throw new ReservationError('reservation id is required');
    const cleanGuest = String(guest == null ? '' : guest).trim();
    if (!cleanGuest) throw new ReservationError('reservation needs a guest name');
    if (!(room instanceof Room)) throw new ReservationError('reservation needs a Room');
    if (!(range instanceof DateRange)) throw new ReservationError('reservation needs a DateRange');
    this.id = cleanId;
    this.guest = cleanGuest;
    this.room = room;
    this.range = range;
  }

  get nights() {
    return this.range.nights;
  }

  // Exact integer math: nightly rate × number of nights.
  get totalCents() {
    return this.room.rateCents * this.nights;
  }

  toJSON() {
    return {
      id: this.id,
      guest: this.guest,
      room: this.room.number,
      type: this.room.typeName,
      checkIn: this.range.checkInStr,
      checkOut: this.range.checkOutStr,
      nights: this.nights,
      totalCents: this.totalCents,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Hotel — the aggregate. RoomTypes and Rooms keyed by name/number,
 * reservations keyed by a generated id. Booking is the one operation
 * that creates a reservation, and it goes through the room's overlap
 * guard, so a double-booking can't exist. Every rollup is derived.
 * ------------------------------------------------------------------ */

class Hotel {
  constructor(name = 'Hotel') {
    this.name = String(name).trim() || 'Hotel';
    this._types = new Map();        // name  -> RoomType
    this._rooms = new Map();        // number -> Room
    this._reservations = new Map(); // id    -> Reservation
    this._seq = 0;                  // reservation id counter
  }

  /* ---- building the property ------------------------------------- */

  addRoomType(spec) {
    const type = spec instanceof RoomType ? spec : new RoomType(spec);
    if (this._types.has(type.name)) throw new ReservationError(`room type "${type.name}" already exists`);
    this._types.set(type.name, type);
    return type;
  }

  getRoomType(name) {
    const key = String(name).trim();
    const type = this._types.get(key);
    if (!type) throw new ReservationError(`no room type "${key}"`);
    return type;
  }

  addRoom(number, typeName) {
    const type = this.getRoomType(typeName);
    const room = new Room(number, type);
    if (this._rooms.has(room.number)) throw new ReservationError(`room ${room.number} already exists`);
    this._rooms.set(room.number, room);
    return room;
  }

  _room(number) {
    const key = String(number).trim();
    const room = this._rooms.get(key);
    if (!room) throw new ReservationError(`no room ${key}`);
    return room;
  }

  /* ---- booking & cancelling -------------------------------------- */

  // Book a room for a stay. Throws if the room is unknown, the dates are
  // bad, or the room is already taken for any overlapping night. On
  // success a reservation id is minted and the stay is recorded in both
  // the hotel index and the room's own calendar.
  book(number, guest, checkIn, checkOut) {
    const room = this._room(number);
    const range = DateRange.of(checkIn, checkOut);
    const clash = room.clashFor(range); // check before minting an id
    if (clash) {
      throw new ReservationError(
        `room ${room.number} is already booked ${clash.range.checkInStr} → ${clash.range.checkOutStr} ` +
        `(reservation ${clash.id}); cannot also book ${range.checkInStr} → ${range.checkOutStr}`
      );
    }
    const id = `R-${String(++this._seq).padStart(4, '0')}`;
    const reservation = new Reservation({ id, guest, room, range });
    room._attach(reservation); // the real invariant guard; re-checks and throws on any clash
    this._reservations.set(id, reservation);
    return reservation;
  }

  cancel(reservationId) {
    const key = String(reservationId).trim();
    const reservation = this._reservations.get(key);
    if (!reservation) throw new ReservationError(`no reservation ${key}`);
    reservation.room._detach(key);
    this._reservations.delete(key);
    return reservation;
  }

  getReservation(id) {
    const key = String(id).trim();
    const r = this._reservations.get(key);
    if (!r) throw new ReservationError(`no reservation ${key}`);
    return r;
  }

  /* ---- queries, all derived on demand ---------------------------- */

  roomTypes() {
    return [...this._types.values()];
  }

  rooms() {
    return [...this._rooms.values()];
  }

  reservations() {
    return [...this._reservations.values()].sort((a, b) => a.range.checkIn - b.range.checkIn);
  }

  // Rooms free for the whole of a stay, optionally limited to one type.
  // Cheapest rate first — the list a booking screen actually shows.
  availableRooms(checkIn, checkOut, typeName = null) {
    const range = DateRange.of(checkIn, checkOut);
    const wanted = typeName == null ? null : String(typeName).trim();
    return this.rooms()
      .filter((room) => (wanted == null || room.typeName === wanted) && room.isAvailable(range))
      .sort((a, b) => a.rateCents - b.rateCents || a.number.localeCompare(b.number));
  }

  // How many rooms are occupied on a given night, and the occupancy rate.
  occupancyOn(date) {
    const day = DateRange._toDayNumber(date, 'date');
    let occupied = 0;
    for (const room of this._rooms.values()) {
      if (room._reservations.some((r) => r.range.includesNight(day))) occupied++;
    }
    const total = this._rooms.size;
    return { date: DateRange._toStr(day), occupied, total, rate: total ? occupied / total : 0 };
  }

  // Total booked revenue across every reservation, exact integer cents.
  revenueCents() {
    let total = 0;
    for (const r of this._reservations.values()) total += r.totalCents;
    return total;
  }

  summary() {
    return {
      roomCount: this._rooms.size,
      typeCount: this._types.size,
      reservationCount: this._reservations.size,
      revenueCents: this.revenueCents(),
    };
  }

  toJSON() {
    return {
      name: this.name,
      roomTypes: this.roomTypes().map((t) => t.toJSON()),
      rooms: this.rooms().map((r) => r.toJSON()),
      reservations: this.reservations().map((r) => r.toJSON()),
      summary: this.summary(),
    };
  }
}

/* ------------------------------------------------------------------ */

const coreApi = { ReservationError, Money, DateRange, RoomType, Room, Reservation, Hotel };

if (typeof module !== 'undefined' && module.exports) module.exports = coreApi;
if (typeof window !== 'undefined') window.ReservationSystem = coreApi;
