// elevator-core.js — the presentation-free elevator engine.
//
// The spec asks for a four-floor building with one elevator, a FIFO queue of
// call requests, and a five-second dwell at each floor for a panel choice. All
// of that logic lives here as a pure, DOM-free module. Time is passed in as
// `dt` (seconds) so both the browser (index.html + script.js) and the Node
// test suite can drive the exact same state machine — one with real frames,
// the other by stepping simulated time.
//
// Everything about the elevator is expressed in "floors": position 1.0 means
// resting on floor 1, position 2.5 means midway between floors 2 and 3, and so
// on. The floors themselves are numbered from 1 (ground) upward.

'use strict';

// --- Defaults ------------------------------------------------------------

const DEFAULT_FLOORS = 4;         // four-floor building, per the spec
const DEFAULT_HOME = 1;           // "Return to floor one when idle."
const DEFAULT_SPEED = 1.5;        // floors per second while travelling
const DEFAULT_DWELL_SECONDS = 5;  // "Wait 5 seconds at each floor for panel input."
const DEFAULT_QUEUE_CAPACITY = 8; // developer-defined; the alarm fires at this.

// State machine.
//
//   IDLE     -> nothing to do, sitting at some floor
//   MOVING   -> travelling between floors toward `target`
//   WAITING  -> arrived at a floor, counting down the dwell window
//
// The transitions happen inside step(dt); everything else is either a caller
// pushing new demand into the queues or a reader inspecting state.
const STATE = {
  IDLE: 'idle',
  MOVING: 'moving',
  WAITING: 'waiting',
};

// A "call" is a hall button press. Direction is 'up' or 'down'. The top floor
// never has an up-call button, the ground floor never has a down-call button.
function isValidCall(call, floors) {
  if (!call || typeof call !== 'object') return false;
  if (!Number.isInteger(call.floor)) return false;
  if (call.floor < 1 || call.floor > floors) return false;
  if (call.direction !== 'up' && call.direction !== 'down') return false;
  if (call.floor === 1 && call.direction === 'down') return false;
  if (call.floor === floors && call.direction === 'up') return false;
  return true;
}

// --- Elevator ------------------------------------------------------------

// createElevator builds the state machine. Options:
//   floors           number of floors (default 4)
//   home             idle-return floor (default 1)
//   speed            floors per second (default 1.5)
//   dwellSeconds     wait window at each stop (default 5)
//   queueCapacity    alarm fires when the queue reaches this size (default 8)
//   startFloor       initial resting floor (default = home)
//
// Callers should read `state`, `floor`, `queue`, `panel`, and the events
// returned by `step(dt)` to drive their UI or their tests.
function createElevator(options = {}) {
  const floors = options.floors || DEFAULT_FLOORS;
  const home = options.home || DEFAULT_HOME;
  const speed = options.speed != null ? options.speed : DEFAULT_SPEED;
  const dwellSeconds =
    options.dwellSeconds != null ? options.dwellSeconds : DEFAULT_DWELL_SECONDS;
  const queueCapacity =
    options.queueCapacity != null ? options.queueCapacity : DEFAULT_QUEUE_CAPACITY;

  if (floors < 2) throw new Error('An elevator needs at least two floors.');
  if (home < 1 || home > floors) throw new Error('home floor is out of range.');

  const state = {
    floors,
    home,
    speed,
    dwellSeconds,
    queueCapacity,
    position: options.startFloor != null ? options.startFloor : home,
    target: null,       // floor we're currently moving to, or null
    direction: null,    // 'up' | 'down' while moving; null when idle
    activeCall: null,   // the call this trip is servicing (from hall queue)
    activePanel: null,  // the panel request this trip is servicing (from panel)
    phase: STATE.IDLE,
    dwellRemaining: 0,  // seconds left on the wait window
    calls: [],          // FIFO of hall calls
    panel: [],          // FIFO of in-car panel selections
    elapsed: 0,         // total simulated seconds
    stops: 0,           // count of completed dwells (a "trip serviced")
    capacityAlarmed: false, // latch: alarm only fires on the transition
  };

  // The "single-handler" constraint from the spec is a UI concern — one
  // listener across all hall buttons, one across all panel buttons — but the
  // engine still enforces the contract: pass in {floor, direction}, get back
  // the queue index (or -1 if the call was invalid or already queued).
  function pressHall(call) {
    if (!isValidCall(call, floors)) return -1;
    // Coalesce duplicates: pressing "up" on floor 2 twice is one request.
    const dupe = state.calls.findIndex(
      (c) => c.floor === call.floor && c.direction === call.direction,
    );
    if (dupe !== -1) return dupe;
    // Also skip if we're already actively serving this exact call.
    if (
      state.activeCall &&
      state.activeCall.floor === call.floor &&
      state.activeCall.direction === call.direction
    ) {
      return -1;
    }
    state.calls.push({ floor: call.floor, direction: call.direction });
    return state.calls.length - 1;
  }

  // Panel button pressed inside the car. Only valid during the dwell window
  // (that's the whole point of the 5-second wait) OR while idle; if the car
  // is mid-flight the press is ignored, matching the spec's "wait period at
  // each floor for panel button input".
  function pressPanel(floor) {
    if (!Number.isInteger(floor)) return -1;
    if (floor < 1 || floor > floors) return -1;
    // Ignore no-ops: pressing your current floor while you're standing on it.
    if (state.phase === STATE.WAITING && floor === Math.round(state.position)) {
      return -1;
    }
    // Ignore mid-flight presses; the dwell window is the interaction window.
    if (state.phase === STATE.MOVING) return -1;
    // De-dupe against pending panel picks.
    const dupe = state.panel.indexOf(floor);
    if (dupe !== -1) return dupe;
    state.panel.push(floor);
    // A fresh panel press should cut the dwell short and start moving now —
    // that's the point of the 5-second window ("timeout triggers processing
    // the next request", so a real request should cancel the timeout).
    if (state.phase === STATE.WAITING) state.dwellRemaining = 0;
    return state.panel.length - 1;
  }

  // Whether the queue is at or over the developer-defined capacity. Presented
  // as a helper so the browser layer can sound the alarm without knowing the
  // number.
  function isQueueFull() {
    return state.calls.length + state.panel.length >= queueCapacity;
  }

  // Kick off (or continue) motion toward a floor. Direction is derived from
  // the current position so the caller doesn't have to think about it.
  function beginTravel(targetFloor) {
    state.target = targetFloor;
    if (targetFloor > state.position) state.direction = 'up';
    else if (targetFloor < state.position) state.direction = 'down';
    else state.direction = null;
    state.phase = state.direction ? STATE.MOVING : STATE.WAITING;
    if (state.phase === STATE.WAITING) state.dwellRemaining = dwellSeconds;
  }

  // Pick the next thing to service. Panel picks (already-onboard passengers)
  // outrank fresh hall calls — the person in the car finishes their trip
  // before we go pick anyone new up. Otherwise it's strict FIFO across the
  // hall queue, exactly as the spec asks.
  function pickNextTarget() {
    if (state.panel.length > 0) {
      const next = state.panel.shift();
      state.activePanel = next;
      state.activeCall = null;
      return next;
    }
    if (state.calls.length > 0) {
      const next = state.calls.shift();
      state.activeCall = next;
      state.activePanel = null;
      return next.floor;
    }
    // Nothing to do — head home to floor 1 if we're not already there.
    state.activeCall = null;
    state.activePanel = null;
    if (Math.round(state.position) !== home) return home;
    return null;
  }

  // Arrive at a floor: emit an 'arrive' event, snap position, start the dwell
  // window. This is where the panel gets its 5 seconds to speak up.
  function arrive(events) {
    state.position = state.target;
    state.stops += 1;
    const activeCall = state.activeCall;
    state.activeCall = null;
    state.activePanel = null;
    state.target = null;
    state.direction = null;
    state.phase = STATE.WAITING;
    state.dwellRemaining = dwellSeconds;
    events.push({
      type: 'arrive',
      floor: state.position,
      time: state.elapsed,
      servedCall: activeCall || null,
    });
  }

  // Advance the machine by dt seconds. Returns the events that happened this
  // step so a presentation layer can log them: dispatch, arrive, dwell start,
  // dwell timeout, queue-full alarm, and return-home.
  function step(dt) {
    const events = [];
    if (dt <= 0) return events;
    state.elapsed += dt;

    // Capacity alarm: fires once on the transition from below-cap to at-cap.
    if (isQueueFull() && !state.capacityAlarmed) {
      state.capacityAlarmed = true;
      events.push({ type: 'queue-full', size: state.calls.length + state.panel.length, time: state.elapsed });
    } else if (!isQueueFull() && state.capacityAlarmed) {
      state.capacityAlarmed = false;
    }

    if (state.phase === STATE.IDLE) {
      const target = pickNextTarget();
      if (target === null) return events;
      beginTravel(target);
      events.push({
        type: 'dispatch',
        from: state.position,
        to: state.target,
        servedCall: state.activeCall,
        time: state.elapsed,
      });
      // We've decided to move — fall through so the same dt still moves us.
    }

    if (state.phase === STATE.MOVING) {
      const dir = state.direction === 'up' ? 1 : -1;
      const remaining = Math.abs(state.target - state.position);
      const travel = speed * dt;
      if (travel >= remaining) {
        arrive(events);
      } else {
        state.position += dir * travel;
      }
      return events;
    }

    if (state.phase === STATE.WAITING) {
      state.dwellRemaining -= dt;
      if (state.dwellRemaining <= 0) {
        // Dwell window closed. Either service the next thing in the queues,
        // or return to the home floor, or sit idle.
        events.push({ type: 'dwell-timeout', floor: state.position, time: state.elapsed });
        const next = pickNextTarget();
        if (next === null) {
          state.phase = STATE.IDLE;
          state.target = null;
          state.direction = null;
        } else if (next === Math.round(state.position)) {
          // Panel picked our current floor; effectively another dwell window.
          state.dwellRemaining = dwellSeconds;
        } else {
          const wasReturningHome = state.activeCall === null && state.activePanel === null;
          beginTravel(next);
          events.push({
            type: wasReturningHome ? 'return-home' : 'dispatch',
            from: state.position,
            to: state.target,
            servedCall: state.activeCall,
            time: state.elapsed,
          });
        }
      }
      return events;
    }
    return events;
  }

  // Run the machine forward until it's idle at home with empty queues, or
  // until we hit maxSeconds. Used by the tests to replay whole scenarios.
  function runToIdle(maxSeconds, dt) {
    const step_dt = dt || 0.05;
    const cap = maxSeconds || 600;
    const log = [];
    while (
      (state.phase !== STATE.IDLE ||
        state.calls.length > 0 ||
        state.panel.length > 0 ||
        Math.round(state.position) !== home) &&
      state.elapsed < cap
    ) {
      const events = step(step_dt);
      for (const e of events) log.push(e);
    }
    return { log, elapsed: state.elapsed, finalFloor: state.position };
  }

  return {
    state,
    STATE,
    pressHall,
    pressPanel,
    isQueueFull,
    step,
    runToIdle,
    // Read-only accessors so external code doesn't have to poke `state`.
    get floors() { return floors; },
    get position() { return state.position; },
    get target() { return state.target; },
    get direction() { return state.direction; },
    get phase() { return state.phase; },
    get queue() { return state.calls.slice(); },
    get panel() { return state.panel.slice(); },
    get elapsed() { return state.elapsed; },
    get dwellRemaining() { return Math.max(0, state.dwellRemaining); },
  };
}

const api = {
  DEFAULT_FLOORS,
  DEFAULT_HOME,
  DEFAULT_SPEED,
  DEFAULT_DWELL_SECONDS,
  DEFAULT_QUEUE_CAPACITY,
  STATE,
  isValidCall,
  createElevator,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.ElevatorCore = api;
}
