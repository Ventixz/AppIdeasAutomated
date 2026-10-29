/*
 * scheduler-fixtures.js — a sample clinic shared by all three front ends (the
 * CLI, the browser demo, and the tests). Building it here, once, keeps the demo
 * data in one place and proves the classes compose the way the screens assume.
 *
 * The sample deliberately exercises every rule:
 *   - three doctors, one (Dr. Khan) on a reduced 4-appointment clinic so the
 *     daily cap is reachable in the demo without filling all 16 slots;
 *   - a patient (Jordan Lee) booked with two different doctors at two different
 *     times — fine — which also sets up the "can't be in two places at once"
 *     rule when you try to book them twice in the same slot;
 *   - a day left with free slots so there is something to book.
 */
'use strict';

const DEMO_DAY = '2026-11-02';

function buildClinic(core) {
  const { Scheduler, Doctor, Patient } = core;
  const clinic = new Scheduler('Mercy Family Clinic');

  const chen = new Doctor('Alice Chen', { id: 'D-0001', specialization: 'Cardiology' });
  const farah = new Doctor('Omar Farah', { id: 'D-0002', specialization: 'Pediatrics' });
  const khan = new Doctor('Nadia Khan', { id: 'D-0003', specialization: 'Dermatology', maxPerDay: 4 });
  [chen, farah, khan].forEach((d) => clinic.addDoctor(d));

  const patients = [
    new Patient('Jordan Lee', { id: 'P-0001', reason: 'annual checkup' }),
    new Patient('Sam Rivera', { id: 'P-0002', reason: 'chest pain follow-up' }),
    new Patient('Priya Nair', { id: 'P-0003', reason: 'rash' }),
    new Patient('Mateo Garcia', { id: 'P-0004', reason: 'vaccination' }),
    new Patient('Wei Zhang', { id: 'P-0005', reason: 'mole check' }),
  ];
  patients.forEach((p) => clinic.addPatient(p));

  // A handful of bookings on the demo day.
  clinic.book('P-0002', 'D-0001', DEMO_DAY, '09:00'); // Sam with Dr. Chen, 09:00
  clinic.book('P-0001', 'D-0001', DEMO_DAY, '09:30'); // Jordan with Dr. Chen, 09:30
  clinic.book('P-0004', 'D-0002', DEMO_DAY, '09:00'); // Mateo with Dr. Farah, 09:00
  clinic.book('P-0001', 'D-0002', DEMO_DAY, '10:00'); // Jordan ALSO with Dr. Farah, 10:00 (fine — different time)

  // Fill Dr. Khan's small clinic nearly to its cap (4): three of four taken.
  clinic.book('P-0003', 'D-0003', DEMO_DAY, '09:00'); // Priya
  clinic.book('P-0005', 'D-0003', DEMO_DAY, '09:30'); // Wei
  clinic.book('P-0002', 'D-0003', DEMO_DAY, '10:00'); // Sam

  return clinic;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { buildClinic, DEMO_DAY };
if (typeof window !== 'undefined') window.ClinicFixtures = { buildClinic, DEMO_DAY };
