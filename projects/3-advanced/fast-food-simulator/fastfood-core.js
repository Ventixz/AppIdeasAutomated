// fastfood-core.js — the presentation-free fast-food simulation engine.
//
// The spec asks us to model a take-away restaurant as a pipeline of simulated
// roles — Customer, Order Taker, Cook, Server — and to represent each order
// ticket with *native Promises*: "one the Server waits on while the Cook
// prepares the order and another the Customer waits on while in the serving
// line." All of that logic lives here as a pure, DOM-free module.
//
// Time is passed in as `dt` (seconds) so both the browser (index.html +
// script.js, driven by requestAnimationFrame) and the Node test suite (driven
// by stepping simulated time) exercise the exact same state machine.
//
// Two things travel through the shop in parallel:
//   * a **customer**, who arrives, orders, then stands in the serving line, and
//   * an **order ticket**, which is created by the Order Taker, cooked by the
//     Cook, then handed over by the Server.
// They are paired by order number: ticket #7 belongs to the customer who
// placed order #7.

'use strict';

// --- Defaults ------------------------------------------------------------
//
// Every interval is in seconds. The two the spec calls out — customer arrival
// and order fulfilment — plus the two bonus ones (order-taker and server
// times) are all configurable per run.

const DEFAULT_ARRIVAL_INTERVAL = 3; // "New customers arrive at a fixed interval."
const DEFAULT_FULFILL_INTERVAL = 4; // "Order tickets are fulfilled at a fixed interval."
const DEFAULT_ORDER_TAKER_TIME = 1; // bonus: time to write a ticket
const DEFAULT_SERVER_TIME = 1;      // bonus: time to hand an order over
const DEFAULT_DURATION = 0;         // bonus: 0 means "run until stopped"

// Bounds used by validation and by the UI's number inputs.
const MIN_INTERVAL = 0.1;
const MAX_INTERVAL = 600;

// --- Ticket: a pair of native Promises -----------------------------------
//
// This is the heart of the spec's Promise constraint. A ticket carries two
// promises created up front, and the engine keeps their resolver functions so
// it can settle them at the right moment as time is stepped:
//
//   * `prep`  — resolves when the Cook finishes the food. The Server waits on
//               this before it can hand the order over.
//   * `serve` — resolves when the Server hands the order to the customer. The
//               Customer waits on this while standing in the serving line.
//
// No async/await is used anywhere; ticket flow is expressed with real Promise
// objects, exactly as the spec requires.
function createTicket(orderNumber) {
  let resolvePrep;
  let resolveServe;
  const prep = new Promise((resolve) => {
    resolvePrep = resolve;
  });
  const serve = new Promise((resolve) => {
    resolveServe = resolve;
  });
  return {
    orderNumber,
    prep, // Promise<orderNumber> — settled when cooking completes
    serve, // Promise<orderNumber> — settled when the order is handed over
    _resolvePrep: resolvePrep,
    _resolveServe: resolveServe,
    prepared: false,
    served: false,
  };
}

// --- Validation ----------------------------------------------------------
//
// "Display customized warning messages when incorrect entries are made." The
// UI uses this to decide whether an interval field is acceptable, and the
// returned reason drives the warning text.
function validateInterval(value) {
  if (value === '' || value === null || value === undefined) {
    return { ok: false, reason: 'empty' };
  }
  const n = Number(value);
  if (Number.isNaN(n)) return { ok: false, reason: 'not-a-number' };
  if (n <= 0) return { ok: false, reason: 'non-positive' };
  if (n < MIN_INTERVAL) return { ok: false, reason: 'too-small' };
  if (n > MAX_INTERVAL) return { ok: false, reason: 'too-large' };
  return { ok: true, value: n };
}

function isValidInterval(value) {
  return validateInterval(value).ok;
}

// --- The simulator -------------------------------------------------------

function createSimulator(config) {
  config = config || {};

  const arrivalInterval = num(config.arrivalInterval, DEFAULT_ARRIVAL_INTERVAL);
  const fulfillInterval = num(config.fulfillInterval, DEFAULT_FULFILL_INTERVAL);
  const orderTakerTime = num(config.orderTakerTime, DEFAULT_ORDER_TAKER_TIME);
  const serverTime = num(config.serverTime, DEFAULT_SERVER_TIME);
  const duration = num(config.duration, DEFAULT_DURATION);

  const sim = {
    // --- configuration (read-only after construction) ---
    arrivalInterval,
    fulfillInterval,
    orderTakerTime,
    serverTime,
    duration,

    // --- clock / lifecycle ---
    elapsed: 0,
    running: true,
    stoppedReason: null,

    // --- counters used to number customers and orders ---
    nextCustomerId: 1,
    nextOrderNumber: 1,

    // --- Order line: customers who have arrived and are waiting to order ---
    orderLine: [], // [{ id }]

    // --- Order Taker: currently writing a ticket for one customer ---
    taking: null, // { customer, remaining } | null

    // --- Kitchen: one order cooking, the rest queued behind it ---
    cooking: null, // { ticket, customer, remaining } | null
    kitchenQueue: [], // [{ ticket, customer }] waiting for the Cook

    // --- Serving line: customers whose ticket is cooked/cooking, waiting for pickup ---
    servingLine: [], // [{ customer, ticket }]

    // --- Server: currently handing one prepared order over ---
    serving: null, // { ticket, customer, remaining } | null

    // --- Pickup counter: the order number currently ready to be called ---
    readyOrderNumber: null,

    // --- tallies ---
    servedCount: 0,
    servedOrders: [], // order numbers, in the sequence they were handed over

    // --- accumulators for the two fixed-interval spawners ---
    _arrivalClock: 0,

    // --- event log (mirrors the other advanced projects) ---
    log: [],

    step,
    stop,
    pendingCount,
    snapshot,
  };

  // Emit a structured event onto the log and return it (handy for tests).
  function emit(type, detail) {
    const event = Object.assign({ type, at: round(sim.elapsed) }, detail || {});
    sim.log.push(event);
    return event;
  }

  // Advance the whole shop by `dt` seconds and return the events produced.
  function step(dt) {
    if (!sim.running || dt <= 0) return [];
    const before = sim.log.length;

    sim.elapsed += dt;

    spawnArrivals(dt);
    runOrderTaker(dt);
    runKitchen(dt);
    runServer(dt);

    // Bonus: honour a fixed total simulation duration if one was requested.
    if (sim.duration > 0 && sim.elapsed >= sim.duration) {
      stop('duration');
    }

    return sim.log.slice(before);
  }

  // 1. Customers arrive in the order line at a fixed interval.
  function spawnArrivals(dt) {
    sim._arrivalClock += dt;
    // A long dt (or a slow interval) may cover several arrivals at once.
    while (sim._arrivalClock >= sim.arrivalInterval) {
      sim._arrivalClock -= sim.arrivalInterval;
      const customer = { id: sim.nextCustomerId };
      sim.nextCustomerId += 1;
      sim.orderLine.push(customer);
      emit('arrive', { customer: customer.id, lineLength: sim.orderLine.length });
    }
  }

  // 2. The Order Taker pulls the front customer, spends orderTakerTime writing
  //    a ticket, then sends the customer to the serving line and the ticket to
  //    the kitchen.
  function runOrderTaker(dt) {
    if (!sim.taking && sim.orderLine.length > 0) {
      const customer = sim.orderLine.shift();
      sim.taking = { customer, remaining: sim.orderTakerTime };
      emit('take-start', { customer: customer.id, orderNumber: sim.nextOrderNumber });
    }
    if (!sim.taking) return;

    sim.taking.remaining -= dt;
    if (sim.taking.remaining > 0) return;

    // Ticket written: create the paired ticket, move customer to serving line.
    const { customer } = sim.taking;
    const ticket = createTicket(sim.nextOrderNumber);
    sim.nextOrderNumber += 1;
    sim.taking = null;

    sim.kitchenQueue.push({ ticket, customer });
    sim.servingLine.push({ customer, ticket });
    emit('order-placed', {
      customer: customer.id,
      orderNumber: ticket.orderNumber,
      kitchenQueueLength: sim.kitchenQueue.length,
    });
  }

  // 3. The Cook prepares one order at a time at a fixed fulfilment interval.
  //    Finishing an order resolves its `prep` promise.
  function runKitchen(dt) {
    if (!sim.cooking && sim.kitchenQueue.length > 0) {
      const next = sim.kitchenQueue.shift();
      sim.cooking = { ticket: next.ticket, customer: next.customer, remaining: sim.fulfillInterval };
      emit('cook-start', {
        orderNumber: next.ticket.orderNumber,
        kitchenQueueLength: sim.kitchenQueue.length,
      });
    }
    if (!sim.cooking) return;

    sim.cooking.remaining -= dt;
    if (sim.cooking.remaining > 0) return;

    const { ticket } = sim.cooking;
    ticket.prepared = true;
    ticket._resolvePrep(ticket.orderNumber); // the Server's promise settles
    sim.cooking = null;
    emit('cook-done', { orderNumber: ticket.orderNumber });
  }

  // 4. The Server hands prepared orders over. It "waits on" a ticket's prep
  //    promise: an order is only eligible once cooking is done. Handing it over
  //    resolves the `serve` promise the Customer was waiting on.
  function runServer(dt) {
    if (!sim.serving) {
      const idx = sim.servingLine.findIndex((entry) => entry.ticket.prepared);
      if (idx !== -1) {
        const entry = sim.servingLine.splice(idx, 1)[0];
        sim.serving = { ticket: entry.ticket, customer: entry.customer, remaining: sim.serverTime };
        sim.readyOrderNumber = entry.ticket.orderNumber;
        emit('pickup-ready', { orderNumber: entry.ticket.orderNumber });
      }
    }
    if (!sim.serving) return;

    sim.serving.remaining -= dt;
    if (sim.serving.remaining > 0) return;

    const { ticket, customer } = sim.serving;
    ticket.served = true;
    ticket._resolveServe(ticket.orderNumber); // the Customer's promise settles
    sim.serving = null;
    sim.readyOrderNumber = null;
    sim.servedCount += 1;
    sim.servedOrders.push(ticket.orderNumber);
    emit('served', { orderNumber: ticket.orderNumber, customer: customer.id, total: sim.servedCount });
  }

  // Total number of *people* still somewhere in the shop. Each customer is
  // counted exactly once by following the person, not the ticket: a customer
  // waits in the serving line for the whole time their ticket is in the
  // kitchen, so the kitchen queue/cook are a parallel view of serving-line
  // customers and must not be added again.
  function pendingCount() {
    return (
      sim.orderLine.length +
      (sim.taking ? 1 : 0) +
      sim.servingLine.length +
      (sim.serving ? 1 : 0)
    );
  }

  function stop(reason) {
    if (!sim.running) return;
    sim.running = false;
    sim.stoppedReason = reason || 'stopped';
    emit('stopped', { reason: sim.stoppedReason });
  }

  // A plain, serialisable view of the shop for the renderer.
  function snapshot() {
    return {
      elapsed: round(sim.elapsed),
      running: sim.running,
      orderLine: sim.orderLine.length,
      taking: sim.taking ? sim.taking.customer.id : null,
      takingOrderNumber: sim.taking ? sim.nextOrderNumber : null,
      cooking: sim.cooking ? sim.cooking.ticket.orderNumber : null,
      kitchenQueue: sim.kitchenQueue.length,
      servingLine: sim.servingLine.length,
      readyOrderNumber: sim.readyOrderNumber,
      servedCount: sim.servedCount,
      pending: pendingCount(),
    };
  }

  return sim;
}

// --- tiny helpers --------------------------------------------------------

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

// --- exports (Node test suite) ------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_ARRIVAL_INTERVAL,
    DEFAULT_FULFILL_INTERVAL,
    DEFAULT_ORDER_TAKER_TIME,
    DEFAULT_SERVER_TIME,
    MIN_INTERVAL,
    MAX_INTERVAL,
    createTicket,
    validateInterval,
    isValidInterval,
    createSimulator,
  };
}
