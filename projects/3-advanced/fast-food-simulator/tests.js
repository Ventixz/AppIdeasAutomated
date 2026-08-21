// tests.js — dependency-free test suite for fastfood-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const {
  MIN_INTERVAL,
  MAX_INTERVAL,
  createTicket,
  validateInterval,
  isValidInterval,
  createSimulator,
} = require('./fastfood-core.js');

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

// Step the simulator repeatedly until `pred` holds (or we run out of budget),
// accumulating every emitted event.
function stepUntil(sim, pred, dt, maxSeconds) {
  dt = dt || 0.05;
  maxSeconds = maxSeconds || 600;
  const log = [];
  const started = sim.elapsed;
  while (!pred(sim, log) && sim.elapsed - started < maxSeconds && sim.running) {
    for (const e of sim.step(dt)) log.push(e);
  }
  return log;
}

// --- 1. Interval validation ----------------------------------------------

console.log('Interval validation...');
eq(isValidInterval('3'), true, 'plain positive number is valid');
eq(isValidInterval(2.5), true, 'positive float is valid');
eq(isValidInterval(''), false, 'empty string rejected');
eq(isValidInterval(null), false, 'null rejected');
eq(isValidInterval('abc'), false, 'non-numeric rejected');
eq(isValidInterval(0), false, 'zero rejected');
eq(isValidInterval(-4), false, 'negative rejected');
eq(isValidInterval(MAX_INTERVAL + 1), false, 'above max rejected');
eq(isValidInterval(MIN_INTERVAL / 2), false, 'below min rejected');
eq(validateInterval('abc').reason, 'not-a-number', 'reason surfaced for warnings');
eq(validateInterval('7').value, 7, 'valid value is coerced to a number');

// --- 2. Ticket carries two native Promises -------------------------------

console.log('Tickets are pairs of native Promises...');
{
  const t = createTicket(1);
  assert(t.prep instanceof Promise, 'prep is a native Promise');
  assert(t.serve instanceof Promise, 'serve is a native Promise');
  eq(t.prepared, false, 'ticket starts un-prepared');
  eq(t.served, false, 'ticket starts un-served');
}

// --- 3. A single customer flows all the way through ----------------------

console.log('One customer flows arrive -> order -> cook -> serve...');
{
  const sim = createSimulator({
    arrivalInterval: 1,
    fulfillInterval: 1,
    orderTakerTime: 0.5,
    serverTime: 0.5,
  });
  stepUntil(sim, (s) => s.servedCount >= 1);
  eq(sim.servedCount, 1, 'exactly one order served');
  eq(sim.servedOrders[0], 1, 'first order number is 1');
}

// --- 4. Event ordering for that customer ---------------------------------

console.log('Events fire in workflow order...');
{
  const sim = createSimulator({
    arrivalInterval: 1,
    fulfillInterval: 1,
    orderTakerTime: 0.5,
    serverTime: 0.5,
  });
  const log = stepUntil(sim, (s) => s.servedCount >= 1);
  const types = log.map((e) => e.type);
  const order = ['arrive', 'take-start', 'order-placed', 'cook-start', 'cook-done', 'pickup-ready', 'served'];
  let cursor = 0;
  for (const want of order) {
    const found = types.indexOf(want, cursor);
    assert(found !== -1, `event "${want}" appears after the previous one`);
    if (found !== -1) cursor = found + 1;
  }
}

// --- 5. Promises resolve, and prep settles before serve ------------------
// Returns a promise the runner awaits, so the ticket promises really settle.
function runPromiseTest() {
  console.log('prep resolves before serve, both with the order number...');
  const sim = createSimulator({ arrivalInterval: 1, fulfillInterval: 1, orderTakerTime: 0.2, serverTime: 0.2 });
  // Reach into the first ticket the moment it is created.
  let firstTicket = null;
  stepUntil(sim, (s) => {
    if (!firstTicket && s.kitchenQueue.length) firstTicket = s.kitchenQueue[0].ticket;
    if (!firstTicket && s.cooking) firstTicket = s.cooking.ticket;
    return s.servedCount >= 1;
  });
  assert(firstTicket, 'captured the first ticket');
  return Promise.all([firstTicket.prep, firstTicket.serve]).then(([prepN, serveN]) => {
    eq(prepN, 1, 'prep resolved with order number 1');
    eq(serveN, 1, 'serve resolved with order number 1');
    eq(firstTicket.prepared, true, 'ticket marked prepared');
    eq(firstTicket.served, true, 'ticket marked served');
  });
}

// Everything below runs synchronously; the async test above returns a promise
// that the runner awaits before this runs.
function runSyncTail() {
  // --- 6. Customers arrive at the configured interval --------------------

  console.log('Arrivals happen at the fixed interval...');
  {
    const sim = createSimulator({ arrivalInterval: 2, fulfillInterval: 100, orderTakerTime: 100, serverTime: 100 });
    // After ~5s at a 2s interval, two customers should have arrived...
    for (let i = 0; i < 100; i += 1) sim.step(0.05); // 5s
    const arrivals = sim.log.filter((e) => e.type === 'arrive').length;
    eq(arrivals, 2, 'two customers arrived in the first 5 seconds');
  }

  // --- 7. Order numbers are sequential and unique ------------------------

  console.log('Order numbers increase 1,2,3...');
  {
    const sim = createSimulator({ arrivalInterval: 1, fulfillInterval: 0.5, orderTakerTime: 0.5, serverTime: 0.5 });
    stepUntil(sim, (s) => s.servedCount >= 4);
    eq(sim.servedOrders[0], 1, 'order 1 first');
    eq(sim.servedOrders[1], 2, 'order 2 second');
    eq(sim.servedOrders[2], 3, 'order 3 third');
    eq(sim.servedOrders[3], 4, 'order 4 fourth');
  }

  // --- 8. The Cook is a bottleneck: a queue builds up --------------------

  console.log('A slow kitchen backs orders up...');
  {
    // Customers arrive fast, food cooks slowly => kitchen queue grows.
    const sim = createSimulator({ arrivalInterval: 0.5, fulfillInterval: 5, orderTakerTime: 0.1, serverTime: 0.1 });
    stepUntil(sim, (s) => s.kitchenQueue.length >= 3, 0.05, 60);
    assert(sim.kitchenQueue.length >= 3, `kitchen queue backed up (got ${sim.kitchenQueue.length})`);
  }

  // --- 9. The Server only picks up prepared orders -----------------------

  console.log('Nothing is served before it is cooked...');
  {
    const sim = createSimulator({ arrivalInterval: 1, fulfillInterval: 3, orderTakerTime: 0.2, serverTime: 0.2 });
    // Step just past the first order being taken but well before it is cooked.
    stepUntil(sim, (s) => s.log.some((e) => e.type === 'order-placed'), 0.05, 30);
    eq(sim.servedCount, 0, 'no orders served while the first is still cooking');
    eq(sim.readyOrderNumber, null, 'pickup counter empty before cooking finishes');
  }

  // --- 10. Stop halts the simulation -------------------------------------

  console.log('Stopping freezes the shop...');
  {
    const sim = createSimulator({ arrivalInterval: 1, fulfillInterval: 1 });
    for (let i = 0; i < 40; i += 1) sim.step(0.05); // 2s
    sim.stop('user');
    eq(sim.running, false, 'sim not running after stop');
    const servedAtStop = sim.servedCount;
    for (let i = 0; i < 200; i += 1) sim.step(0.05); // stepping does nothing now
    eq(sim.servedCount, servedAtStop, 'no progress after stop');
    assert(sim.log.some((e) => e.type === 'stopped' && e.reason === 'user'), 'stop event recorded');
  }

  // --- 11. Bonus: total duration ends the run ----------------------------

  console.log('A configured duration auto-stops the run...');
  {
    const sim = createSimulator({ arrivalInterval: 1, fulfillInterval: 1, duration: 3 });
    stepUntil(sim, (s) => !s.running, 0.1, 30);
    eq(sim.running, false, 'sim stopped by duration');
    eq(sim.stoppedReason, 'duration', 'stop reason is duration');
    assert(sim.elapsed >= 3, 'stopped at or after the duration');
  }

  // --- 12. pendingCount tracks everyone still in the shop ----------------

  console.log('pendingCount conserves people...');
  {
    const sim = createSimulator({ arrivalInterval: 0.5, fulfillInterval: 2, orderTakerTime: 0.3, serverTime: 0.3 });
    let maxPending = 0;
    for (let i = 0; i < 400; i += 1) {
      sim.step(0.05);
      maxPending = Math.max(maxPending, sim.pendingCount());
    }
    const arrived = sim.log.filter((e) => e.type === 'arrive').length;
    eq(sim.pendingCount() + sim.servedCount, arrived, 'pending + served == total arrived');
    assert(maxPending > 0, 'shop had work in progress at some point');
  }

  // --- 13. snapshot mirrors internal state -------------------------------

  console.log('snapshot() reflects live state...');
  {
    const sim = createSimulator({ arrivalInterval: 1, fulfillInterval: 2, orderTakerTime: 0.3, serverTime: 0.3 });
    stepUntil(sim, (s) => s.servedCount >= 1);
    const snap = sim.snapshot();
    eq(snap.servedCount, sim.servedCount, 'snapshot served count matches');
    eq(snap.orderLine, sim.orderLine.length, 'snapshot order line matches');
    eq(snap.running, true, 'snapshot running flag matches');
  }
}

// --- runner --------------------------------------------------------------
// Run the async Promise test first (its assertions need the microtask queue),
// then the synchronous tail, then report.
Promise.resolve()
  .then(runPromiseTest)
  .then(runSyncTail)
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
  });
