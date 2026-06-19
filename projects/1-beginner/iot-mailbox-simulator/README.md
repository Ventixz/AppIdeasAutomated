# IOT Mailbox Simulator

A mock of an Internet-of-Things mailbox. It "monitors" a physical mailbox by
sampling a light sensor on a fixed interval — a bright reading means the door
has been opened (mail arriving), a dark reading means it is closed. The whole
point of the exercise is **callback-driven state communication** between the
sensor and the UI.

Source idea: [app-ideas / IOT-Mailbox](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/IOT-Mailbox-App.md)

## Features

- **Control panel** with **Start Monitoring**, **Stop Monitoring** and **Reset**.
- **Notification panel** showing a live mailbox icon (📪 / 📬) and a status line.
- **Scrollable activity log** that records every operation and each callback
  from the `IOTMailbox` instance.
- **Start Monitoring** registers a callback and begins receiving light-level
  signals; a message is logged when monitoring begins.
- Every light-level callback is logged with the door state (open/closed).
- A notification fires the moment the door opens.
- **Stop Monitoring** clears the timer so no further callbacks fire, and logs it.

## Bonus features implemented

- **Start** is disabled while monitoring; **Stop** is disabled while idle.
- A **monitoring-interval field** lets you set the sampling period in ms.
- The simulator **notifies you if the door stays open** across samples.
- An **audible alert** (a short Web Audio beep) plays when the door opens.

## How `IOTMailbox` works

The spec provides an `IOTMailbox` class that signals state at a preset interval.
This port keeps that contract:

```js
const mailbox = new IOTMailbox(1000);   // sample every 1000 ms
mailbox.startMonitoring(level => { ... }); // callback gets each light level
mailbox.stopMonitoring();                // clears the interval timer
```

Each tick generates a random light level. Anything above the `lightThreshold`
(0.5) is treated as an open door, so deliveries appear at random — exactly the
unpredictability a real sensor would face. The UI tracks open/closed
*transitions* so it only notifies on change rather than on every sample.

## Run it

Open `index.html` in any browser — no build step, no dependencies, no network
required. (Audio may require a click first due to browser autoplay policies,
which the Start button satisfies.)
