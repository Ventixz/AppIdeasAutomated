// Service worker: seeds default settings and keeps a heartbeat alarm so that
// "auto after sunset" flips even on tabs that were opened hours ago.

const DEFAULTS = { forced: false, auto: true, strength: 0.4 };

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(DEFAULTS, (current) => {
    // Only fill in anything the user hasn't already set.
    chrome.storage.local.set({ ...DEFAULTS, ...current });
  });
  chrome.alarms.create("nightlight-tick", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "nightlight-tick") return;
  // Touch storage to nudge content scripts to re-evaluate the time of day.
  chrome.storage.local.get(DEFAULTS, (s) => chrome.storage.local.set(s));
});
