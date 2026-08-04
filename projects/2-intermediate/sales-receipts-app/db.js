/*
 * db.js — a tiny Promise wrapper around IndexedDB for storing receipts.
 *
 * Per the spec, the browser database holds NO confidential or personally
 * identifiable information — only item numbers, descriptions, prices, an
 * optional free-text customer label, and a timestamp.
 *
 * This file is browser-only (IndexedDB lives in the browser); the testable
 * math lives in receipt-core.js instead.
 */
(function (global) {
  'use strict';

  var DB_NAME = 'sales-receipts-db';
  var STORE = 'receipts';
  var VERSION = 1;

  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var result = fn(store);
        t.oncomplete = function () { resolve(result && result.value); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  // Save a receipt record; resolves once the transaction commits.
  function addReceipt(receipt) {
    return tx('readwrite', function (store) {
      var box = {};
      var req = store.add(receipt);
      req.onsuccess = function () { box.value = req.result; };
      return box;
    });
  }

  // Return every stored receipt, oldest first.
  function getAllReceipts() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var out = [];
        var t = db.transaction(STORE, 'readonly');
        var req = t.objectStore(STORE).openCursor();
        req.onsuccess = function () {
          var cur = req.result;
          if (cur) { out.push(cur.value); cur.continue(); }
          else { resolve(out); }
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // Delete every receipt (the "Clear All" report reset).
  function clearAll() {
    return tx('readwrite', function (store) {
      store.clear();
      return {};
    });
  }

  global.ReceiptDB = {
    addReceipt: addReceipt,
    getAllReceipts: getAllReceipts,
    clearAll: clearAll
  };
})(typeof window !== 'undefined' ? window : globalThis);
