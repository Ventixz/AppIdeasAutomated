/*
 * scheduler-core.js — a patient/doctor appointment scheduler, DOM-free.
 *
 * The task ("Patient / Doctor Scheduler") is the fifth* of karan/Projects'
 * Classes (Object-Oriented Programming) category:
 *
 *   "Create a patient class and a doctor class. A doctor can handle several
 *    patients. Write a scheduling program — a doctor can only handle 16 patients
 *    during an 8-hour work day."
 *
 * (*the Classes list's fifth entry; this repo's fifth project in the category.)
 *
 * Like every task in this category, the point is the *design*, not the feature
 * list. "16 patients in an 8-hour day" is not a slogan — it is 16 half-hour
 * slots, and getting it right means the three things a naive version gets wrong:
 *
 *   1. PERSON IS ABSTRACT; THE ROLE IS THE SUBCLASS. A patient and a doctor are
 *      both people — they share a name and an id — but you never have a bare
 *      "person" in a clinic. `new Person()` throws; the only concrete kinds are
 *      `Patient` and `Doctor`, and each answers `role` its own way. The shared
 *      identity lives in the base; the thing that differs lives below it.
 *
 *   2. TIME IS DISCRETE AND EXACT — SLOTS, NOT A FLOATING CLOCK. The 8-hour day
 *      (09:00–17:00) is exactly 16 half-hour slots, indexed 0–15. Every time is
 *      integer minutes validated onto that grid: "09:30" *is* slot 1, and an
 *      off-grid time like "09:15" or an out-of-hours "17:00" is refused rather
 *      than silently rounded. No `Date` arithmetic, no floating minutes that
 *      drift — a slot is an integer, and two appointments collide only when
 *      their integers are equal.
 *
 *   3. THE INVARIANTS ARE THE OBJECTS' JOB, AND BOOKING IS ATOMIC. A `Doctor`
 *      refuses a second patient in a slot it already holds (no double-booking)
 *      and refuses more than its daily cap (≤ 16). The `Scheduler` adds the one
 *      rule a single doctor can't see: a patient can't be in two places at the
 *      same instant. A booking passes *every* check before anything is written,
 *      and a patient's appointment list is *derived* by scanning the doctors'
 *      schedules — there is no second copy to fall out of sync, so what the
 *      patient sees and what the doctor holds can never disagree.
 *
 * The Scheduler is the aggregate: it registers doctors and patients, books,
 * cancels and reschedules appointments (a reschedule validates the target before
 * giving up the old slot, so a bad move never loses the appointment), and every
 * rollup is derived on demand. Nothing here touches the DOM, a hidden clock, or
 * the network. `scheduler-node.js` drives these classes from a CLI, `script.js`
 * drives them in a browser, `tests.js` drives them with fixed data. One engine,
 * three front ends.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Errors — one named type so callers (and tests) can tell a rejected
 * operation (abstract instantiation, bad time, double-booking, cap
 * reached, unknown id) from a real bug.
 * ------------------------------------------------------------------ */

class SchedulerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchedulerError';
  }
}

/* ------------------------------------------------------------------ *
 * The workday, as integers. 09:00–17:00 is 8 hours; at 30 minutes a
 * slot that is exactly 16 slots — the spec's "16 patients in an 8-hour
 * day". These are the only magic numbers in the file, named once here.
 * ------------------------------------------------------------------ */

const DAY_START_MIN = 9 * 60;                               // 09:00 in minutes past midnight
const SLOT_MINUTES = 30;                                    // one appointment
const SLOTS_PER_DAY = 16;                                   // 8h / 30min — the daily maximum
const DAY_END_MIN = DAY_START_MIN + SLOTS_PER_DAY * SLOT_MINUTES; // 17:00

/* ------------------------------------------------------------------ *
 * Slot — the time grid, as a flat helper (a slot IS just an integer
 * 0–15; wrapping each in an object would buy nothing). It parses and
 * formats clock times, converts between a time string and a slot index,
 * and refuses anything off the half-hour grid or outside the workday.
 * ------------------------------------------------------------------ */

const Slot = {
  SLOTS_PER_DAY, SLOT_MINUTES, DAY_START_MIN, DAY_END_MIN,

  isIndex(i) { return Number.isInteger(i) && i >= 0 && i < SLOTS_PER_DAY; },

  assertIndex(i) {
    if (!Slot.isIndex(i)) throw new SchedulerError(`slot must be an integer 0–${SLOTS_PER_DAY - 1}, got ${i}`);
    return i;
  },

  // "09:00" / "9:00" -> minutes past midnight. Rejects junk and impossible times.
  parseTime(value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
    if (!m) throw new SchedulerError(`not a time "HH:MM": "${value}"`);
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) throw new SchedulerError(`not a valid clock time: "${value}"`);
    return h * 60 + min;
  },

  // minutes -> "09:00"
  formatMinute(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  },

  // "09:30" -> slot index 1. Refuses off-grid ("09:15") and out-of-hours ("17:00").
  indexFromTime(value) {
    const off = Slot.parseTime(value) - DAY_START_MIN;
    if (off < 0 || off >= SLOTS_PER_DAY * SLOT_MINUTES) {
      throw new SchedulerError(`time outside clinic hours ${Slot.formatMinute(DAY_START_MIN)}–${Slot.formatMinute(DAY_END_MIN)}: "${value}"`);
    }
    if (off % SLOT_MINUTES !== 0) {
      throw new SchedulerError(`time must fall on a ${SLOT_MINUTES}-minute slot: "${value}"`);
    }
    return off / SLOT_MINUTES;
  },

  startMinute(i) { return DAY_START_MIN + Slot.assertIndex(i) * SLOT_MINUTES; },
  time(i) { return Slot.formatMinute(Slot.startMinute(i)); },          // "09:00"
  endTime(i) { return Slot.formatMinute(Slot.startMinute(i) + SLOT_MINUTES); }, // "09:30"
  label(i) { return `${Slot.time(i)}–${Slot.endTime(i)}`; },           // "09:00–09:30"

  // accept either a slot index (number) or a clock time (string) -> index
  toIndex(slot) {
    return typeof slot === 'number' ? Slot.assertIndex(slot) : Slot.indexFromTime(String(slot));
  },
};

/* A day is a calendar date "YYYY-MM-DD". Validate the shape AND that it is a
 * real date, so "2026-02-30" is caught rather than quietly normalized. */
function assertDay(day) {
  const s = String(day).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new SchedulerError(`day must be YYYY-MM-DD, got "${day}"`);
  const [y, mo, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new SchedulerError(`not a real calendar date: "${day}"`);
  }
  return s;
}

/* ------------------------------------------------------------------ *
 * Person — the ABSTRACT base. It owns the one thing a patient and a
 * doctor share: identity (a name and an id). It declares `role`, the
 * thing they answer differently, and refuses to be instantiated. That
 * is the whole "abstract" requirement, made real: there is no such
 * thing as a bare person wandering the clinic.
 * ------------------------------------------------------------------ */

let _pSeq = 0, _dSeq = 0;

class Person {
  constructor(name, { id } = {}) {
    if (new.target === Person) {
      throw new SchedulerError('Person is abstract — create a Patient or a Doctor');
    }
    const nm = String(name == null ? '' : name).trim();
    if (!nm) throw new SchedulerError('a person needs a name');
    this.name = nm;
    this.id = id != null ? String(id) : null; // the subclass assigns one if null
  }

  get role() {
    throw new SchedulerError(`${this.constructor.name} must define role`);
  }
}

/* ------------------------------------------------------------------ *
 * Patient — a person who gets booked. Identity plus an optional reason
 * for the visit. A patient holds no appointment list of its own: that
 * is derived from the doctors' schedules (see Scheduler.appointmentsFor),
 * so it can never disagree with where the patient is actually booked.
 * ------------------------------------------------------------------ */

class Patient extends Person {
  constructor(name, opts = {}) {
    super(name, opts);
    if (this.id == null) this.id = `P-${String(++_pSeq).padStart(4, '0')}`;
    else { const m = /^P-(\d+)$/.exec(this.id); if (m) _pSeq = Math.max(_pSeq, Number(m[1])); }
    this.reason = opts.reason ? String(opts.reason).trim() : '';
  }

  get role() { return 'Patient'; }

  toJSON() {
    return { id: this.id, name: this.name, role: this.role, reason: this.reason };
  }
}

/* ------------------------------------------------------------------ *
 * Doctor — a person who sees patients. It owns its own day book (a Map
 * of booked slots) and enforces, all on its own, the two rules a single
 * doctor can see: no two patients in the same slot, and no more than
 * `maxPerDay` appointments in a day (default 16 — the full 8-hour day;
 * a doctor who works a shorter clinic can set a lower cap). The day book
 * is the single source of truth for this doctor's bookings.
 * ------------------------------------------------------------------ */

class Doctor extends Person {
  constructor(name, opts = {}) {
    super(name, opts);
    if (this.id == null) this.id = `D-${String(++_dSeq).padStart(4, '0')}`;
    else { const m = /^D-(\d+)$/.exec(this.id); if (m) _dSeq = Math.max(_dSeq, Number(m[1])); }

    this.specialization = opts.specialization ? String(opts.specialization).trim() : 'General Practice';

    const cap = opts.maxPerDay != null ? Number(opts.maxPerDay) : SLOTS_PER_DAY;
    if (!Number.isInteger(cap) || cap < 1 || cap > SLOTS_PER_DAY) {
      throw new SchedulerError(`maxPerDay must be an integer 1–${SLOTS_PER_DAY}, got ${opts.maxPerDay}`);
    }
    this.maxPerDay = cap;

    this._appts = new Map(); // `${day}#${slot}` -> Appointment
  }

  get role() { return 'Doctor'; }

  _key(day, slot) { return `${day}#${slot}`; }

  isFreeAt(day, slot) { return !this._appts.has(this._key(assertDay(day), Slot.toIndex(slot))); }

  appointmentCountOn(day) {
    const d = assertDay(day);
    let n = 0;
    for (const a of this._appts.values()) if (a.day === d) n++;
    return n;
  }

  appointmentsOn(day) {
    const d = assertDay(day);
    return [...this._appts.values()].filter((a) => a.day === d).sort((a, b) => a.slotIndex - b.slotIndex);
  }

  freeSlotsOn(day) {
    const d = assertDay(day);
    const out = [];
    for (let i = 0; i < SLOTS_PER_DAY; i++) if (!this._appts.has(this._key(d, i))) out.push(i);
    return out;
  }

  // Book a patient into a slot — enforcing THIS doctor's two rules. A Doctor is
  // correct on its own: even called directly (not through the Scheduler) it will
  // never double-book a slot or exceed its daily cap.
  book(patient, day, slot) {
    if (!(patient instanceof Patient)) throw new SchedulerError('book() takes a Patient');
    const d = assertDay(day), s = Slot.toIndex(slot);
    if (this._appts.has(this._key(d, s))) {
      throw new SchedulerError(`double-booked: Dr. ${this.name} already has a patient at ${Slot.label(s)} on ${d}`);
    }
    if (this.appointmentCountOn(d) >= this.maxPerDay) {
      throw new SchedulerError(`daily limit reached: Dr. ${this.name} is capped at ${this.maxPerDay} appointment(s) on ${d}`);
    }
    const appt = new Appointment(patient, this, d, s);
    this._appts.set(this._key(d, s), appt);
    return appt;
  }

  cancel(day, slot) {
    const d = assertDay(day), s = Slot.toIndex(slot);
    const appt = this._appts.get(this._key(d, s));
    if (!appt) throw new SchedulerError(`no appointment with Dr. ${this.name} at ${Slot.label(s)} on ${d}`);
    this._appts.delete(this._key(d, s));
    return appt;
  }

  appointments() { return [...this._appts.values()]; }

  toJSON() {
    return {
      id: this.id, name: this.name, role: this.role,
      specialization: this.specialization, maxPerDay: this.maxPerDay,
      appointments: this.appointments().map((a) => a.toJSON()),
    };
  }
}

/* ------------------------------------------------------------------ *
 * Appointment — an immutable value binding one patient, one doctor, and
 * one slot on one day. Frozen on creation: an appointment is a fact that
 * happened, not a mutable record. Its clock times are derived from the
 * slot index, so the slot and the "09:30" you read can never diverge.
 * ------------------------------------------------------------------ */

class Appointment {
  constructor(patient, doctor, day, slotIndex) {
    this.patient = patient;
    this.doctor = doctor;
    this.day = day;
    this.slotIndex = slotIndex;
    Object.freeze(this);
  }

  get time() { return Slot.time(this.slotIndex); }
  get endTime() { return Slot.endTime(this.slotIndex); }
  get label() { return Slot.label(this.slotIndex); }

  toJSON() {
    return {
      day: this.day, slot: this.slotIndex, time: this.time, endTime: this.endTime,
      patientId: this.patient.id, patientName: this.patient.name,
      doctorId: this.doctor.id, doctorName: this.doctor.name,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Scheduler — the aggregate clinic. It registers doctors and patients
 * and coordinates bookings. It adds the one invariant a lone doctor
 * cannot see — a patient cannot be in two places at the same instant —
 * and keeps every operation atomic: a booking is validated completely
 * before anything is recorded, and a reschedule proves the target is
 * free before it releases the old slot, so no appointment is ever lost
 * to a half-finished move.
 * ------------------------------------------------------------------ */

class Scheduler {
  constructor(name = 'Clinic') {
    this.name = String(name).trim() || 'Clinic';
    this._doctors = new Map();   // id -> Doctor
    this._patients = new Map();  // id -> Patient
  }

  get doctorCount() { return this._doctors.size; }
  get patientCount() { return this._patients.size; }
  doctors() { return [...this._doctors.values()]; }
  patients() { return [...this._patients.values()]; }

  addDoctor(doctor) {
    if (!(doctor instanceof Doctor)) throw new SchedulerError('addDoctor() takes a Doctor');
    if (this._doctors.has(doctor.id)) throw new SchedulerError(`doctor ${doctor.id} already registered`);
    this._doctors.set(doctor.id, doctor);
    return doctor;
  }

  addPatient(patient) {
    if (!(patient instanceof Patient)) throw new SchedulerError('addPatient() takes a Patient');
    if (this._patients.has(patient.id)) throw new SchedulerError(`patient ${patient.id} already registered`);
    this._patients.set(patient.id, patient);
    return patient;
  }

  getDoctor(id) {
    const d = this._doctors.get(String(id));
    if (!d) throw new SchedulerError(`no doctor ${id}`);
    return d;
  }

  getPatient(id) {
    const p = this._patients.get(String(id));
    if (!p) throw new SchedulerError(`no patient ${id}`);
    return p;
  }

  // The cross-doctor rule, which no single doctor can enforce: is this patient
  // already booked somewhere at (day, slot)? Returns the clashing appointment or
  // null. `exclude` lets a reschedule ignore the appointment it is moving.
  patientBookingAt(patient, day, slot, exclude) {
    const d = assertDay(day), s = Slot.toIndex(slot);
    for (const doc of this._doctors.values()) {
      for (const a of doc.appointments()) {
        if (a.day === d && a.slotIndex === s && a.patient === patient && a !== exclude) return a;
      }
    }
    return null;
  }

  // A patient's appointments across ALL doctors, derived (never stored twice).
  appointmentsFor(patient) {
    const p = patient instanceof Patient ? patient : this.getPatient(patient);
    const out = [];
    for (const doc of this._doctors.values()) for (const a of doc.appointments()) if (a.patient === p) out.push(a);
    return out.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : x.slotIndex - y.slotIndex));
  }

  // Book a specific slot. Atomic: the patient cross-check and the doctor's own
  // checks all pass before the single write. If the doctor refuses (slot taken
  // or cap reached), nothing was recorded on either side.
  book(patientId, doctorId, day, slot) {
    const patient = this.getPatient(patientId);
    const doctor = this.getDoctor(doctorId);
    const d = assertDay(day), s = Slot.toIndex(slot);
    const clash = this.patientBookingAt(patient, d, s);
    if (clash) {
      throw new SchedulerError(`${patient.name} is already booked at ${Slot.label(s)} on ${d} (with Dr. ${clash.doctor.name})`);
    }
    return doctor.book(patient, d, s); // doctor enforces slot-free + daily cap
  }

  // Book the earliest slot that works for both the doctor and the patient.
  bookNext(patientId, doctorId, day) {
    const patient = this.getPatient(patientId);
    const doctor = this.getDoctor(doctorId);
    const d = assertDay(day);
    if (doctor.appointmentCountOn(d) >= doctor.maxPerDay) {
      throw new SchedulerError(`daily limit reached: Dr. ${doctor.name} is full on ${d} (${doctor.maxPerDay})`);
    }
    for (const s of doctor.freeSlotsOn(d)) {
      if (!this.patientBookingAt(patient, d, s)) return this.book(patientId, doctorId, d, s);
    }
    throw new SchedulerError(`no slot on ${d} works for ${patient.name} with Dr. ${doctor.name}`);
  }

  cancel(doctorId, day, slot) {
    return this.getDoctor(doctorId).cancel(day, slot);
  }

  // Move an appointment. Atomic: the target is fully validated (slot free, cap
  // has room, patient free) BEFORE the old slot is released, so a rejected move
  // leaves the original appointment exactly where it was.
  reschedule(doctorId, day, slot, { toDoctor, toDay, toSlot } = {}) {
    const fromDoctor = this.getDoctor(doctorId);
    const fromDay = assertDay(day), fromSlot = Slot.toIndex(slot);
    const current = fromDoctor._appts.get(fromDoctor._key(fromDay, fromSlot));
    if (!current) throw new SchedulerError(`no appointment with Dr. ${fromDoctor.name} at ${Slot.label(fromSlot)} on ${fromDay}`);

    const newDoctor = toDoctor != null ? this.getDoctor(toDoctor) : fromDoctor;
    const newDay = toDay != null ? assertDay(toDay) : fromDay;
    const newSlot = toSlot != null ? Slot.toIndex(toSlot) : fromSlot;

    const noMove = newDoctor === fromDoctor && newDay === fromDay && newSlot === fromSlot;
    if (!noMove) {
      if (!newDoctor.isFreeAt(newDay, newSlot)) {
        throw new SchedulerError(`double-booked: Dr. ${newDoctor.name} already has a patient at ${Slot.label(newSlot)} on ${newDay}`);
      }
      // Moving within the same doctor+day keeps the count the same; otherwise the
      // target day must have room under that doctor's cap.
      const sameDoctorDay = newDoctor === fromDoctor && newDay === fromDay;
      if (!sameDoctorDay && newDoctor.appointmentCountOn(newDay) >= newDoctor.maxPerDay) {
        throw new SchedulerError(`daily limit reached: Dr. ${newDoctor.name} is capped at ${newDoctor.maxPerDay} appointment(s) on ${newDay}`);
      }
      const clash = this.patientBookingAt(current.patient, newDay, newSlot, current);
      if (clash) {
        throw new SchedulerError(`${current.patient.name} is already booked at ${Slot.label(newSlot)} on ${newDay}`);
      }
    }

    // Every check has passed — now it is safe to move.
    fromDoctor.cancel(fromDay, fromSlot);
    return newDoctor.book(current.patient, newDay, newSlot);
  }

  // One day across every doctor: used vs capacity and the booked rows.
  dayReport(day) {
    const d = assertDay(day);
    return this.doctors().map((doc) => ({
      doctor: doc,
      used: doc.appointmentCountOn(d),
      cap: doc.maxPerDay,
      free: doc.freeSlotsOn(d).length,
      appointments: doc.appointmentsOn(d),
    }));
  }

  summary(day) {
    const rows = day != null ? this.dayReport(day) : null;
    return {
      name: this.name,
      doctors: this.doctorCount,
      patients: this.patientCount,
      booked: rows ? rows.reduce((n, r) => n + r.used, 0) : this.doctors().reduce((n, d) => n + d.appointments().length, 0),
      capacity: rows ? rows.reduce((n, r) => n + r.cap, 0) : null,
    };
  }

  toJSON() {
    return {
      name: this.name,
      doctors: this.doctors().map((d) => d.toJSON()),
      patients: this.patients().map((p) => p.toJSON()),
    };
  }
}

/* ------------------------------------------------------------------ */

const coreApi = {
  SchedulerError, Slot, assertDay,
  Person, Patient, Doctor, Appointment, Scheduler,
  DAY_START_MIN, DAY_END_MIN, SLOT_MINUTES, SLOTS_PER_DAY,
};

if (typeof module !== 'undefined' && module.exports) module.exports = coreApi;
if (typeof window !== 'undefined') window.ClinicScheduler = coreApi;
