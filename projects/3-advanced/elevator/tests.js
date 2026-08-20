// tests.js — dependency-free test suite for elevator-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const {
  DEFAULT_FLOORS,
  DEFAULT_HOME,
  DEFAULT_DWELL_SECONDS,
  DEFAULT_QUEUE_CAPACITY,
  STATE,
  isValidCall,
  createElevator,
} = require('./elevator-core.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}
function eq(a, b, msg) {
  assert(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}
function near(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, `${msg} (expected ~${b}±${tol}, got ${a})`);
}

// Small helper: step the elevator repeatedly, accumulating events. Some tests
// want to run "until arrived at floor N" or "until idle".
function stepUntil(el, pred, dt, maxSeconds) {
  dt = dt || 0.05;
  maxSeconds = maxSeconds || 300;
  const log = [];
  const started = el.elapsed;
  while (!pred(el, log) && el.elapsed - started < maxSeconds) {
    const events = el.step(dt);
    for (const e of events) log.push(e);
  }
  return log;
}

// --- 1. isValidCall: hall-call validation --------------------------------

console.log('Hall call validation...');
eq(isValidCall({ floor: 2, direction: 'up' }, 4), true, 'floor 2 up is valid');
eq(isValidCall({ floor: 3, direction: 'down' }, 4), true, 'floor 3 down is valid');
eq(isValidCall({ floor: 1, direction: 'up' }, 4), true, 'floor 1 up is valid');
eq(isValidCall({ floor: 4, direction: 'down' }, 4), true, 'top floor can call down');
// The edges: no down button on floor 1, no up button on the top floor.
eq(isValidCall({ floor: 1, direction: 'down' }, 4), false, 'ground floor cannot call down');
eq(isValidCall({ floor: 4, direction: 'up' }, 4), false, 'top floor cannot call up');
eq(isValidCall({ floor: 0, direction: 'up' }, 4), false, 'floor 0 rejected');
eq(isValidCall({ floor: 5, direction: 'up' }, 4), false, 'above top rejected');
eq(isValidCall({ floor: 2, direction: 'sideways' }, 4), false, 'bad direction rejected');
eq(isValidCall(null, 4), false, 'null rejected');
eq(isValidCall({ floor: 2.5, direction: 'up' }, 4), false, 'non-integer floor rejected');

// --- 2. Defaults from the spec -------------------------------------------

console.log('Spec defaults...');
eq(DEFAULT_FLOORS, 4, 'four floors, per the spec');
eq(DEFAULT_HOME, 1, 'idle-return floor is 1');
eq(DEFAULT_DWELL_SECONDS, 5, 'dwell window is 5 seconds');
assert(DEFAULT_QUEUE_CAPACITY >= 1, 'capacity is a positive integer');

// --- 3. Fresh elevator starts on the home floor, idle --------------------

console.log('Initial state...');
{
  const el = createElevator();
  eq(el.floors, 4, 'floors default');
  eq(el.position, 1, 'starts on floor 1');
  eq(el.phase, STATE.IDLE, 'starts idle');
  eq(el.direction, null, 'no direction when idle');
  eq(el.queue.length, 0, 'empty hall queue');
  eq(el.panel.length, 0, 'empty panel queue');
}

// --- 4. FIFO servicing of hall calls -------------------------------------

console.log('FIFO servicing of hall calls...');
{
  // Queue three calls in a specific order and check that the elevator visits
  // them in *submission* order — not "nearest first" — as the spec insists.
  // From the ground floor, "nearest first" would service floor 2 before 3.
  const el = createElevator({ dwellSeconds: 0.1, speed: 4 });
  eq(el.pressHall({ floor: 3, direction: 'up' }), 0, 'first call queued at 0');
  eq(el.pressHall({ floor: 2, direction: 'up' }), 1, 'second call queued at 1');
  eq(el.pressHall({ floor: 4, direction: 'down' }), 2, 'third call queued at 2');

  const log = stepUntil(el, (e, l) => l.filter((x) => x.type === 'arrive').length >= 3, 0.05, 60);
  const arrivals = log.filter((e) => e.type === 'arrive').map((e) => e.floor);
  eq(arrivals[0], 3, 'first arrival: floor 3 (the first call, not the nearest)');
  eq(arrivals[1], 2, 'second arrival: floor 2 (submission order)');
  eq(arrivals[2], 4, 'third arrival: floor 4');
}

// --- 5. Duplicate call coalescing ----------------------------------------

console.log('Duplicate press coalescing...');
{
  const el = createElevator();
  el.pressHall({ floor: 2, direction: 'up' });
  el.pressHall({ floor: 2, direction: 'up' });
  el.pressHall({ floor: 2, direction: 'up' });
  eq(el.queue.length, 1, 'pressing up on 2 five times is one queued call');
  // But up and down at the same floor are two different calls.
  el.pressHall({ floor: 3, direction: 'down' });
  el.pressHall({ floor: 3, direction: 'up' });
  eq(el.queue.length, 3, 'up and down at same floor are distinct');
}

// --- 6. Invalid presses do not queue -------------------------------------

console.log('Invalid presses are ignored...');
{
  const el = createElevator();
  eq(el.pressHall({ floor: 1, direction: 'down' }), -1, 'no down on ground floor');
  eq(el.pressHall({ floor: 4, direction: 'up' }), -1, 'no up on top floor');
  eq(el.pressHall({ floor: 99, direction: 'up' }), -1, 'out of range');
  eq(el.queue.length, 0, 'nothing was queued');
}

// --- 7. Dwell window and timeout -----------------------------------------

console.log('Dwell window: 5s to press a panel button...');
{
  const el = createElevator({ speed: 100 }); // near-instant motion
  el.pressHall({ floor: 3, direction: 'up' });
  // Fly to floor 3.
  stepUntil(el, (e, l) => l.some((x) => x.type === 'arrive'), 0.05, 5);
  eq(el.phase, STATE.WAITING, 'now waiting on floor 3');
  near(el.dwellRemaining, DEFAULT_DWELL_SECONDS, 0.2, 'roughly 5s left on the dwell');
  // Let the whole window expire without a panel press.
  const log = stepUntil(el, (e, l) => l.some((x) => x.type === 'dwell-timeout'), 0.1, 20);
  const timeout = log.find((e) => e.type === 'dwell-timeout');
  assert(timeout, 'a dwell-timeout event was emitted after the window closed');
}

// --- 8. Panel press within the dwell window shortens the wait ------------

console.log('Panel press during dwell fires the trip immediately...');
{
  const el = createElevator({ speed: 100 });
  el.pressHall({ floor: 2, direction: 'up' });
  stepUntil(el, (e, l) => l.some((x) => x.type === 'arrive'), 0.05, 5);
  eq(el.phase, STATE.WAITING, 'waiting on floor 2');
  // Passenger picks floor 4 — dwell should collapse to 0, then dispatch.
  el.pressPanel(4);
  eq(el.dwellRemaining, 0, 'a real panel press cancels the dwell timer');
  const log = stepUntil(el, (e, l) => l.filter((x) => x.type === 'arrive').length >= 2, 0.05, 30);
  const arrivals = log.filter((e) => e.type === 'arrive').map((e) => e.floor);
  eq(arrivals[0], 4, 'next arrival is the panel choice');
}

// --- 9. Panel selections outrank fresh hall calls ------------------------

console.log('Panel selection takes priority over the hall queue...');
{
  const el = createElevator({ speed: 100 });
  el.pressHall({ floor: 3, direction: 'up' });
  const log1 = stepUntil(el, (e, l) => l.some((x) => x.type === 'arrive'), 0.05, 5);
  // Someone got on and picked floor 4.
  el.pressPanel(4);
  // Meanwhile the hall queue gets a stale call at floor 2.
  el.pressHall({ floor: 2, direction: 'up' });
  const log2 = stepUntil(el, (e, l) => l.filter((x) => x.type === 'arrive').length >= 2, 0.05, 30);
  const arrivals = log1.concat(log2).filter((e) => e.type === 'arrive').map((e) => e.floor);
  eq(arrivals[0], 3, 'first: the hall call we already served');
  eq(arrivals[1], 4, 'second: the panel pick (before new hall calls)');
  eq(arrivals[2], 2, 'third: the queued hall call');
}

// --- 10. Return home when idle -------------------------------------------

console.log('Return-to-1 when the queues drain...');
{
  const el = createElevator({ speed: 100, dwellSeconds: 0.2 });
  el.pressHall({ floor: 4, direction: 'down' });
  const log = stepUntil(el, (e, l) => l.some((x) => x.type === 'return-home'), 0.05, 60);
  const home = log.find((e) => e.type === 'return-home');
  assert(home, 'a return-home dispatch was emitted');
  eq(home.to, 1, 'return dispatch heads to floor 1');
  // Finish the trip and verify we settle idle on floor 1.
  stepUntil(el, (e) => e.phase === STATE.IDLE && Math.round(e.position) === 1, 0.05, 30);
  eq(el.phase, STATE.IDLE, 'settled idle');
  eq(Math.round(el.position), 1, 'sitting on floor 1');
}

// --- 11. Ignoring nonsense presses ---------------------------------------

console.log('Panel press paths...');
{
  const el = createElevator();
  eq(el.pressPanel(0), -1, 'floor 0 rejected');
  eq(el.pressPanel(5), -1, 'above top rejected');
  eq(el.pressPanel('lobby'), -1, 'non-integer rejected');
  el.pressHall({ floor: 3, direction: 'up' });
  el.step(0.1); // now moving; presses during flight should be ignored
  eq(el.phase, STATE.MOVING, 'moving');
  eq(el.pressPanel(2), -1, 'panel press ignored mid-flight');
}

// --- 12. Queue-full alarm --------------------------------------------------

console.log('Queue-full alarm event...');
{
  // Don't step until we've saturated the queue — step() would pop the head
  // and drop us back below cap before the alarm has a chance to fire.
  const el = createElevator({ queueCapacity: 3 });
  el.pressHall({ floor: 2, direction: 'up' });
  el.pressHall({ floor: 3, direction: 'up' });
  eq(el.isQueueFull(), false, 'below cap');
  el.pressHall({ floor: 4, direction: 'down' });
  eq(el.isQueueFull(), true, 'at cap');
  const events = el.step(0.001);
  const alarm = events.find((e) => e.type === 'queue-full');
  assert(alarm, 'a queue-full event fires when the queue reaches cap');
  eq(alarm.size, 3, 'alarm carries the queue size');
  // Once step() shifts the head off, we drop back under cap; the alarm should
  // not re-fire on the next step.
  const events2 = el.step(0.001);
  assert(!events2.find((e) => e.type === 'queue-full'), 'alarm is a latched edge, not a level');
}

// --- 13. Movement kinematics ---------------------------------------------

console.log('Kinematics: position advances at `speed` floors/second...');
{
  const el = createElevator({ speed: 2 }); // 2 floors per second
  el.pressHall({ floor: 4, direction: 'down' });
  // First step transitions from IDLE to MOVING via dispatch; account for that.
  el.step(0.5);
  // After ~0.5s of travel from floor 1 at 2 floors/s, position should be ~2.
  near(el.position, 2, 0.15, 'roughly at floor 2 after 0.5s');
  el.step(0.5);
  near(el.position, 3, 0.15, 'roughly at floor 3 after 1.0s');
}

// --- 14. Full scenario: mixed hall + panel -------------------------------

console.log('End-to-end scenario replays deterministically...');
{
  const el = createElevator({ speed: 4, dwellSeconds: 1 });
  el.pressHall({ floor: 3, direction: 'up' });
  el.pressHall({ floor: 4, direction: 'down' });
  el.pressHall({ floor: 2, direction: 'up' });
  const result = el.runToIdle(120, 0.05);
  const arrivals = result.log.filter((e) => e.type === 'arrive').map((e) => e.floor);
  eq(arrivals[0], 3, 'served first call first');
  eq(arrivals[1], 4, 'served second call second');
  eq(arrivals[2], 2, 'served third call third');
  eq(Math.round(result.finalFloor), 1, 'came home to floor 1');
  assert(result.log.some((e) => e.type === 'return-home'), 'emitted return-home along the way');
}

// --- 15. Invariants: elevator never leaves the shaft ---------------------

console.log('Position stays within the building...');
{
  const el = createElevator({ speed: 5, dwellSeconds: 0.2 });
  el.pressHall({ floor: 4, direction: 'down' });
  el.pressHall({ floor: 2, direction: 'up' });
  el.pressHall({ floor: 3, direction: 'up' });
  let minPos = Infinity;
  let maxPos = -Infinity;
  for (let i = 0; i < 400; i += 1) {
    el.step(0.05);
    if (el.position < minPos) minPos = el.position;
    if (el.position > maxPos) maxPos = el.position;
  }
  assert(minPos >= 1 - 1e-6, `position never dips below 1 (got ${minPos})`);
  assert(maxPos <= 4 + 1e-6, `position never rises above 4 (got ${maxPos})`);
}

// --- Report --------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
