/*
 * script.js — the browser presentation layer for the Slack Archiver.
 *
 * All the real logic — the mock channels.history API, the de-duplicating
 * archive, owner-based access control, the extraction tick, export, and the
 * retrieval query — lives in archiver-core.js. This file only wires the DOM to
 * that engine, persists the archive to the browser's storage (the "database"),
 * and runs the automatic tick on a timer.
 */

(function () {
  "use strict";

  const Core = window.ArchiverCore;
  const STORAGE_KEY = "slack-archiver.db.v1";

  // --- The mock workspace -------------------------------------------------
  // Deterministic so the same demo data appears every load.
  const slack = Core.createMockSlack({
    channels: [
      { id: "C_GEN", name: "general" },
      { id: "C_RAND", name: "random" },
      { id: "C_ENG", name: "engineering" },
      { id: "C_INC", name: "incidents" },
    ],
    messagesPerChannel: 260,
    seed: 7,
  });

  // The set of people who can be "signed in", each with a role.
  const USERS = [
    { id: "U1", name: "grace (owner)", role: "owner" },
    { id: "U2", name: "ada", role: "member" },
    { id: "U3", name: "linus", role: "member" },
  ];

  // --- Load the archive from storage (or start empty) ---------------------
  let archive;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    archive = saved ? Core.deserialize(saved) : Core.createArchive();
  } catch (e) {
    archive = Core.createArchive();
  }

  // The service wraps that archive. Subscriptions live only in memory (which
  // channels are being archived is a session choice), the messages persist.
  const svc = Core.createArchiverService({ slack: slack, archive: archive });

  let currentUser = USERS[0];
  let autoTimer = null;

  // --- Element handles ----------------------------------------------------
  const userSelect = document.getElementById("user-select");
  const roleNote = document.getElementById("role-note");
  const channelList = document.getElementById("channel-list");
  const startBtn = document.getElementById("start-btn");
  const tickBtn = document.getElementById("tick-btn");
  const engineStatus = document.getElementById("engine-status");
  const warningEl = document.getElementById("warning");
  const rateLimitEl = document.getElementById("rate-limit");
  const viewChannel = document.getElementById("view-channel");
  const exportJsonBtn = document.getElementById("export-json");
  const exportTextBtn = document.getElementById("export-text");
  const searchInput = document.getElementById("search");
  const searchCount = document.getElementById("search-count");
  const messagesEl = document.getElementById("messages");

  rateLimitEl.textContent = Core.RATE_LIMIT;

  // --- Persistence --------------------------------------------------------
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, Core.serialize(archive));
    } catch (e) {
      /* storage unavailable — the app still works for this session */
    }
  }

  // --- Warnings -----------------------------------------------------------
  function showWarning(message) {
    warningEl.textContent = message;
    warningEl.hidden = false;
  }
  function clearWarning() {
    warningEl.textContent = "";
    warningEl.hidden = true;
  }

  // --- Access-control helpers ---------------------------------------------
  function isOwner() {
    return Core.canArchive(currentUser);
  }

  // --- Rendering ----------------------------------------------------------

  function renderIdentity() {
    userSelect.innerHTML = USERS.map(function (u) {
      return '<option value="' + u.id + '">' + u.name + "</option>";
    }).join("");
    userSelect.value = currentUser.id;
    roleNote.textContent = currentUser.role;
    roleNote.className =
      "role-note " + (isOwner() ? "role-owner" : "role-member");
  }

  function channelName(id) {
    const ch = slack.channels.find(function (c) {
      return c.id === id;
    });
    return ch ? ch.name : id;
  }

  function renderChannels() {
    channelList.innerHTML = slack.channels
      .map(function (ch) {
        const on = svc.isSubscribed(ch.id);
        const archived = Core.archivedCount(archive, ch.id);
        const total = slack.totalMessages(ch.id);
        return (
          '<li class="channel-item">' +
          "<div>" +
          '<span class="channel-name">' +
          ch.name +
          "</span>" +
          '<div class="channel-meta">' +
          archived +
          " / " +
          total +
          " archived</div>" +
          "</div>" +
          '<button type="button" class="toggle-btn' +
          (on ? " on" : "") +
          '" data-channel="' +
          ch.id +
          '"' +
          (isOwner() ? "" : " disabled") +
          ">" +
          (on ? "Archiving" : "Add") +
          "</button>" +
          "</li>"
        );
      })
      .join("");
  }

  function renderEngineControls() {
    const running = svc.isRunning();
    startBtn.textContent = running
      ? "Stop auto-archiving"
      : "Start auto-archiving";
    startBtn.classList.toggle("stop", running);
    startBtn.disabled = !isOwner();
    tickBtn.disabled = !isOwner();

    engineStatus.classList.toggle("running", running);
    if (!isOwner()) {
      engineStatus.textContent =
        "You're signed in as a member — only a Team owner may archive.";
    } else if (running) {
      engineStatus.textContent =
        "Auto-archiving — pulling a page from each subscribed channel every second.";
    } else {
      engineStatus.textContent = "Idle — not archiving.";
    }
  }

  function renderChannelPicker() {
    // The viewer lists every channel that has anything archived.
    const ids = Core.archivedChannels(archive);
    const prev = viewChannel.value;
    if (ids.length === 0) {
      viewChannel.innerHTML = '<option value="">(nothing archived)</option>';
    } else {
      viewChannel.innerHTML = ids
        .map(function (id) {
          return (
            '<option value="' +
            id +
            '">#' +
            channelName(id) +
            " (" +
            Core.archivedCount(archive, id) +
            ")</option>"
          );
        })
        .join("");
      if (ids.indexOf(prev) !== -1) viewChannel.value = prev;
    }
    const disabled = ids.length === 0;
    exportJsonBtn.disabled = disabled;
    exportTextBtn.disabled = disabled;
  }

  // fmt a Slack ts as a readable local time.
  function fmtTs(ts) {
    const d = new Date(parseFloat(ts) * 1000);
    return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderMessages() {
    const channelId = viewChannel.value;
    if (!channelId) {
      messagesEl.innerHTML = '<li class="empty">Nothing archived yet.</li>';
      searchCount.textContent = "";
      return;
    }
    const q = searchInput.value.trim();
    // The viewer *is* a client of the bonus retrieval API.
    const rows = Core.queryArchive(archive, channelId, q ? { text: q } : {});
    const total = Core.archivedCount(archive, channelId);
    searchCount.textContent = q
      ? rows.length + " of " + total + " match"
      : total + " messages";

    if (rows.length === 0) {
      messagesEl.innerHTML =
        '<li class="empty">No messages match your search.</li>';
      return;
    }
    messagesEl.innerHTML = rows
      .map(function (m) {
        return (
          '<li class="message">' +
          '<span class="when">' +
          fmtTs(m.ts) +
          "</span>" +
          '<span class="who">' +
          escapeHtml(m.user) +
          "</span>" +
          '<span class="text">' +
          escapeHtml(m.text) +
          "</span>" +
          "</li>"
        );
      })
      .join("");
  }

  function renderAll() {
    renderIdentity();
    renderChannels();
    renderEngineControls();
    renderChannelPicker();
    renderMessages();
  }

  // --- Extraction ---------------------------------------------------------

  function runPass() {
    clearWarning();
    let report;
    try {
      report = svc.tick();
    } catch (e) {
      showWarning(e.message);
      return;
    }
    save();
    renderChannels();
    renderChannelPicker();
    renderMessages();

    // If auto mode is on and everything is fully drained, stop on its own.
    const anyMore = Object.keys(report).some(function (id) {
      return report[id].hasMore;
    });
    if (svc.isRunning() && Object.keys(report).length > 0 && !anyMore) {
      const drained = Object.keys(report).every(function (id) {
        return report[id].added === 0;
      });
      if (drained) {
        stopAuto();
        engineStatus.textContent =
          "Caught up — every subscribed channel is fully archived.";
      }
    }
  }

  function startAuto() {
    try {
      svc.start(currentUser);
    } catch (e) {
      showWarning(e.message);
      return;
    }
    autoTimer = setInterval(runPass, 1000);
    runPass(); // pull the first page immediately
    renderEngineControls();
  }

  function stopAuto() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
    try {
      svc.stop(currentUser);
    } catch (e) {
      /* a member can't stop, but a member can't have started either */
    }
    renderEngineControls();
  }

  // --- Export (download without leaving the page) -------------------------

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- Wiring -------------------------------------------------------------

  userSelect.addEventListener("change", function () {
    // Switching users while auto mode runs is fine — but if you drop to a
    // member, halt archiving to respect the owner-only rule.
    const next = USERS.find(function (u) {
      return u.id === userSelect.value;
    });
    currentUser = next || USERS[0];
    if (!isOwner() && svc.isRunning()) {
      stopAuto();
    }
    clearWarning();
    renderAll();
  });

  channelList.addEventListener("click", function (e) {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-channel");
    clearWarning();
    try {
      if (svc.isSubscribed(id)) {
        svc.removeChannel(currentUser, id);
      } else {
        svc.addChannel(currentUser, id);
      }
    } catch (err) {
      showWarning(err.message);
      return;
    }
    renderChannels();
  });

  startBtn.addEventListener("click", function () {
    if (svc.isRunning()) {
      stopAuto();
    } else {
      startAuto();
    }
  });

  tickBtn.addEventListener("click", function () {
    // A single manual pass. Owners only; the engine enforces it, but we also
    // need a "started" flag for tick() to do anything, so start-and-stop
    // around one pass when idle.
    if (!isOwner()) {
      showWarning("Only a Team owner may archive.");
      return;
    }
    const wasRunning = svc.isRunning();
    if (!wasRunning) svc.start(currentUser);
    runPass();
    if (!wasRunning) svc.stop(currentUser);
    renderEngineControls();
  });

  viewChannel.addEventListener("change", renderMessages);
  searchInput.addEventListener("input", renderMessages);

  exportJsonBtn.addEventListener("click", function () {
    const id = viewChannel.value;
    if (!id) return;
    download(
      channelName(id) + "-archive.json",
      Core.exportChannel(archive, id, "json"),
      "application/json"
    );
  });

  exportTextBtn.addEventListener("click", function () {
    const id = viewChannel.value;
    if (!id) return;
    download(
      channelName(id) + "-archive.txt",
      Core.exportChannel(archive, id, "text"),
      "text/plain"
    );
  });

  renderAll();
})();
