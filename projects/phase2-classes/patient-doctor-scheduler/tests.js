#!/usr/bin/env node
/*
 * tests.js — dependency-free checks for the scheduler engine. Run: node tests.js
 *
 * The Classes category is about design, so these tests lean on what the design
 * is supposed to guarantee: Person is abstract (you can't make a bare one, and a
 * subclass that forgets `role` can't be used), time is an exact slot grid (the
 * half-hour boundary and the clinic's hours are enforced, not rounded), a Doctor
 * enforces its own two rules (no double-booking, a daily cap of ≤ 16), the
 * Scheduler adds the one rule a doctor can't see (a patient is never in two
 * places at once) and keeps booking and rescheduling atomic, and a patient's
 * appointments are derived from the doctors so the two views can't disagree.
 */
'use strict';

const core = require('./scheduler-core');
const {
  SchedulerError, Slot, assertDay,
  Person, Patient, Doctor, Appointment, Scheduler, SLOTS_PER_DAY,
} = core;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function throwsErr(fn, msg) {
  try { fn(); fail++; console.error('  FAIL (no throw):', msg); }
  catch (e) { ok(e instanceof SchedulerError, `${msg} — threw ${e.name}: ${e.message}`); }
}

const DAY = '2026-11-02';

/* --- Slot: the time grid --------------------------------------------- */
eq(SLOTS_PER_DAY, 16, 'an 8-hour day at 30 min/slot is 16 slots');
eq(Slot.indexFromTime('09:00'), 0, '09:00 is slot 0');
eq(Slot.indexFromTime('09:30'), 1, '09:30 is slot 1');
eq(Slot.indexFromTime('16:30'), 15, '16:30 is the last slot (15)');
eq(Slot.time(0), '09:00', 'slot 0 starts at 09:00');
eq(Slot.endTime(0), '09:30', 'slot 0 ends at 09:30');
eq(Slot.label(1), '09:30–10:00', 'slot label reads start–end');
eq(Slot.toIndex(3), 3, 'a number passes through as a slot index');
eq(Slot.toIndex('10:00'), 2, 'a time string converts to a slot index');
throwsErr(() => Slot.indexFromTime('09:15'), 'an off-grid time (09:15) is refused');
throwsErr(() => Slot.indexFromTime('17:00'), '17:00 is past the last slot (out of hours)');
throwsErr(() => Slot.indexFromTime('08:30'), '08:30 is before the clinic opens');
throwsErr(() => Slot.indexFromTime('noon'), 'junk time is refused');
throwsErr(() => Slot.assertIndex(16), 'slot 16 is out of range (0–15)');
throwsErr(() => Slot.assertIndex(-1), 'a negative slot is out of range');

/* --- day validation -------------------------------------------------- */
eq(assertDay('2026-11-02'), '2026-11-02', 'a real date passes');
throwsErr(() => assertDay('2026-13-01'), 'month 13 is not a real date');
throwsErr(() => assertDay('2026-02-30'), 'Feb 30 is not a real date');
throwsErr(() => assertDay('11/02/2026'), 'wrong date format is refused');

/* --- Person is abstract ---------------------------------------------- */
throwsErr(() => new Person('Nobody'), 'cannot instantiate abstract Person');
throwsErr(() => new Patient(''), 'a person needs a name');
ok(new Patient('P') instanceof Person, 'Patient is a Person');
ok(new Doctor('D') instanceof Person, 'Doctor is a Person');
eq(new Patient('P').role, 'Patient', 'a Patient knows its role');
eq(new Doctor('D').role, 'Doctor', 'a Doctor knows its role');
// a hand-rolled subclass that forgets `role` still can't be used:
class Ghost extends Person {}
throwsErr(() => new Ghost('X').role, 'an un-overridden role throws');
throwsErr(() => new Doctor('D', { maxPerDay: 0 }), 'maxPerDay must be at least 1');
throwsErr(() => new Doctor('D', { maxPerDay: 17 }), 'maxPerDay cannot exceed 16');

/* --- Doctor enforces its own two rules ------------------------------- */
const doc = new Doctor('Solo', { id: 'D-9001' });
const a1 = new Patient('A', { id: 'P-A' });
const a2 = new Patient('B', { id: 'P-B' });
const appt = doc.book(a1, DAY, '09:00');
ok(appt instanceof Appointment, 'booking returns an Appointment');
eq(appt.time, '09:00', 'the appointment reports its start time');
eq(appt.endTime, '09:30', 'the appointment reports its end time');
eq(doc.appointmentCountOn(DAY), 1, 'the doctor has one appointment booked');
ok(!doc.isFreeAt(DAY, 0), 'slot 0 is no longer free');
ok(doc.isFreeAt(DAY, 1), 'slot 1 is still free');
// no double-booking: a second patient in the same slot is refused
throwsErr(() => doc.book(a2, DAY, '09:00'), 'a doctor refuses a second patient in the same slot');
eq(doc.appointmentCountOn(DAY), 1, 'the refused double-booking changed nothing');
// the appointment is immutable
const before = appt.slotIndex;
try { appt.slotIndex = 99; } catch (_) { /* strict mode may throw; either way it must not change */ }
eq(appt.slotIndex, before, 'an appointment is frozen (immutable)');
// a non-patient can't be booked
throwsErr(() => doc.book({ name: 'not a patient' }, DAY, '10:00'), 'book() rejects a non-Patient');

/* --- the daily cap (the spec's "16 in an 8-hour day") ---------------- */
const busy = new Doctor('Capped', { id: 'D-9002', maxPerDay: 2 });
busy.book(a1, DAY, '09:00');
busy.book(a2, DAY, '09:30');
eq(busy.appointmentCountOn(DAY), 2, 'two appointments booked under a cap of 2');
ok(busy.freeSlotsOn(DAY).length > 0, 'there are still empty slots on the clock');
// ...but the cap is reached, so a third is refused even though slots remain
throwsErr(() => busy.book(new Patient('C'), DAY, '10:00'), 'the cap refuses a 3rd booking even with open slots');
eq(busy.appointmentCountOn(DAY), 2, 'the refused booking did not count');
// the cap is per DAY: the next day starts fresh
busy.book(new Patient('D'), '2026-11-03', '09:00');
eq(busy.appointmentCountOn('2026-11-03'), 1, 'the cap resets on a new day');
// a full 16-slot day: the 16th fits, a 17th cannot (no slot left and at cap)
const full = new Doctor('Full', { id: 'D-9003' }); // default cap 16
for (let i = 0; i < 16; i++) full.book(new Patient(`F${i}`), DAY, i);
eq(full.appointmentCountOn(DAY), 16, 'a full day holds exactly 16 appointments');
throwsErr(() => full.book(new Patient('overflow'), DAY, '09:00'), 'the 17th patient of the day is refused');

/* --- Scheduler: registration + routing ------------------------------- */
const clinic = new Scheduler('Test Clinic');
const dChen = new Doctor('Chen', { id: 'D-1' });
const dFarah = new Doctor('Farah', { id: 'D-2' });
const pJo = new Patient('Jo', { id: 'P-1' });
const pSam = new Patient('Sam', { id: 'P-2' });
clinic.addDoctor(dChen); clinic.addDoctor(dFarah);
clinic.addPatient(pJo); clinic.addPatient(pSam);
eq(clinic.doctorCount, 2, 'two doctors registered');
eq(clinic.patientCount, 2, 'two patients registered');
throwsErr(() => clinic.addDoctor(dChen), 'cannot register the same doctor twice');
throwsErr(() => clinic.addDoctor(pJo), 'addDoctor() rejects a Patient');
throwsErr(() => clinic.getPatient('nope'), 'get on an unknown id throws');

clinic.book('P-1', 'D-1', DAY, '09:00'); // Jo with Chen at 09:00
eq(dChen.appointmentCountOn(DAY), 1, 'the scheduler booked through to the doctor');

/* --- the cross-doctor rule: one patient, not two places at once ------ */
// Jo with a DIFFERENT doctor at the SAME slot must be refused...
throwsErr(() => clinic.book('P-1', 'D-2', DAY, '09:00'), 'a patient cannot be in two places at the same time');
// ...and atomically: Farah's 09:00 is still free, nothing recorded
ok(dFarah.isFreeAt(DAY, 0), 'the refused cross-booking left the other doctor untouched');
eq(dFarah.appointmentCountOn(DAY), 0, 'nothing was recorded on the second doctor');
// Jo with the other doctor at a DIFFERENT slot is fine
clinic.book('P-1', 'D-2', DAY, '10:00');
eq(clinic.appointmentsFor(pJo).length, 2, "Jo's derived appointment list spans both doctors");
// a patient's list is DERIVED from the doctors, not a separate store
const joAppts = clinic.appointmentsFor('P-1');
eq(joAppts[0].time, '09:00', 'derived list is sorted by time (09:00 first)');
eq(joAppts[1].time, '10:00', 'then 10:00');

/* --- bookNext: earliest slot that works for both -------------------- */
const bn = new Scheduler('Next');
const bd = new Doctor('BusyDoc', { id: 'D-N' });
const bp = new Patient('NextPat', { id: 'P-N' });
const other = new Patient('Other', { id: 'P-O' });
bn.addDoctor(bd); bn.addPatient(bp); bn.addPatient(other);
bd.book(other, DAY, 0); // slot 0 taken by someone else
bd.book(other, DAY, 1); // slot 1 taken too
const next = bn.bookNext('P-N', 'D-N', DAY);
eq(next.slotIndex, 2, 'bookNext skips taken slots and takes the earliest free one');
// if the patient is already booked elsewhere at the earliest free slot, skip it.
// BusyDoc now holds slots 0,1,2; its earliest free slot is 3. Book NextPat with a
// SECOND doctor at slot 3, so slot 3 clashes for the patient (not for BusyDoc).
const bd2 = new Doctor('Doc2', { id: 'D-N2' });
bn.addDoctor(bd2);
bd2.book(bp, DAY, 3); // NextPat is busy at slot 3 with Doc2 (BusyDoc's slot 3 stays free)
const next2 = bn.bookNext('P-N', 'D-N', DAY);
eq(next2.slotIndex, 4, 'bookNext skips a slot where the patient is booked with another doctor');

/* --- cancel ---------------------------------------------------------- */
const cc = new Scheduler('Cancel');
const cd = new Doctor('CDoc', { id: 'D-C' });
const cp = new Patient('CPat', { id: 'P-C' });
cc.addDoctor(cd); cc.addPatient(cp);
cc.book('P-C', 'D-C', DAY, '09:00');
eq(cd.appointmentCountOn(DAY), 1, 'booked before cancel');
cc.cancel('D-C', DAY, '09:00');
eq(cd.appointmentCountOn(DAY), 0, 'cancel frees the slot');
throwsErr(() => cc.cancel('D-C', DAY, '09:00'), 'cancelling an empty slot throws');

/* --- reschedule is atomic ------------------------------------------- */
const rs = new Scheduler('Reschedule');
const rd = new Doctor('RDoc', { id: 'D-R' });
const rp = new Patient('RPat', { id: 'P-R' });
const rp2 = new Patient('RPat2', { id: 'P-R2' });
rs.addDoctor(rd); rs.addPatient(rp); rs.addPatient(rp2);
rs.book('P-R', 'D-R', DAY, '09:00');  // the one we'll move
rs.book('P-R2', 'D-R', DAY, '10:00'); // an occupied target to collide with
// moving onto an occupied slot is refused, and the original stays put (atomic)
throwsErr(() => rs.reschedule('D-R', DAY, '09:00', { toSlot: '10:00' }), 'cannot reschedule onto an occupied slot');
ok(!rd.isFreeAt(DAY, 0), 'the original 09:00 appointment is still there after a refused move');
eq(rd.appointmentsOn(DAY).length, 2, 'the refused reschedule left both appointments intact');
// a valid move: 09:00 -> 11:00
const moved = rs.reschedule('D-R', DAY, '09:00', { toSlot: '11:00' });
eq(moved.time, '11:00', 'a valid reschedule lands at the new time');
ok(rd.isFreeAt(DAY, 0), 'the old slot is freed after a successful move');
eq(rd.appointmentsOn(DAY).length, 2, 'the move did not change the appointment count');
// move across doctors onto a day with no room (capped) is refused atomically
const rd2 = new Doctor('RDoc2', { id: 'D-R2', maxPerDay: 1 });
rs.addDoctor(rd2);
rs.book('P-R2', 'D-R2', '2026-11-03', '09:00'); // fills D-R2's cap-1 day
throwsErr(() => rs.reschedule('D-R', DAY, '11:00', { toDoctor: 'D-R2', toDay: '2026-11-03', toSlot: '10:00' }),
  'cannot reschedule onto a doctor who is at capacity that day');
ok(!rd.isFreeAt(DAY, 4), "the patient's 11:00 appointment survived the refused cross-doctor move");

/* --- dayReport ------------------------------------------------------- */
const rep = clinic.dayReport(DAY);
ok(Array.isArray(rep) && rep.length === clinic.doctorCount, 'dayReport has one row per doctor');
ok(rep.every((r) => r.used + r.free <= SLOTS_PER_DAY), 'used + free never exceeds the slot count');

/* --- fixtures load and behave --------------------------------------- */
const fixtures = require('./scheduler-fixtures');
const demo = fixtures.buildClinic(core);
eq(demo.doctorCount, 3, 'fixture clinic has three doctors');
eq(demo.patientCount, 5, 'fixture clinic has five patients');
eq(demo.getDoctor('D-0003').appointmentCountOn(fixtures.DEMO_DAY), 3, "Dr. Khan's small clinic has 3 of 4 booked");
// Jordan (P-0001) is booked with two different doctors that day — derived view
eq(demo.appointmentsFor('P-0001').length, 2, 'the fixture patient spans two doctors');
// booking Jordan a third time in a slot they already hold is refused
throwsErr(() => demo.book('P-0001', 'D-0003', fixtures.DEMO_DAY, '09:30'),
  'the fixture patient cannot be double-booked at a time they already hold');

/* -------------------------------------------------------------------- */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
