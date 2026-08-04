/*
 * script.js — wires the DOM to ReceiptCore (pure math) and ReceiptDB (storage).
 *
 * State lives in a single `cart` array; every mutation goes through ReceiptCore
 * and then re-renders. The DOM is never the source of truth.
 */
(function () {
  'use strict';

  var Core = window.ReceiptCore;
  var DB = window.ReceiptDB;
  var inventory = window.INVENTORY;

  var cart = [];

  // --- element handles -----------------------------------------------------
  var grid = document.getElementById('item-grid');
  var linesEl = document.getElementById('receipt-lines');
  var emptyEl = document.getElementById('receipt-empty');
  var totalEl = document.getElementById('total');
  var timeEl = document.getElementById('receipt-time');
  var customerEl = document.getElementById('customer');
  var toastEl = document.getElementById('toast');
  var reportSummary = document.getElementById('report-summary');
  var reportBody = document.getElementById('report-body');

  // --- helpers -------------------------------------------------------------
  function formatDateTime(ms) {
    var d = new Date(ms);
    return d.toLocaleString(undefined, {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  var toastTimer = null;
  function toast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (kind ? ' ' + kind : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.className = 'toast';
    }, 2600);
  }

  // --- build the item buttons once ----------------------------------------
  function buildGrid() {
    inventory.forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item-btn';
      btn.dataset.itemNo = String(item.itemNo);

      var thumb = document.createElement('span');
      thumb.className = 'item-thumb';
      thumb.textContent = item.emoji || '🛒';

      var desc = document.createElement('span');
      desc.className = 'item-desc';
      desc.textContent = item.description;

      var meta = document.createElement('span');
      meta.className = 'item-meta';
      meta.textContent = '#' + item.itemNo + ' · ' + Core.formatMoney(Core.toCents(item.unitPrice));

      btn.appendChild(thumb);
      btn.appendChild(desc);
      btn.appendChild(meta);
      btn.addEventListener('click', function () {
        cart = Core.addItem(cart, inventory, item.itemNo);
        renderCart();
      });
      grid.appendChild(btn);
    });
  }

  // --- render the current sale --------------------------------------------
  function renderCart() {
    linesEl.textContent = '';

    if (cart.length === 0) {
      emptyEl.style.display = '';
      timeEl.textContent = '';
    } else {
      emptyEl.style.display = 'none';
      timeEl.textContent = 'Started ' + formatDateTime(Date.now());

      cart.forEach(function (line) {
        var li = document.createElement('li');
        li.className = 'receipt-line';

        var name = document.createElement('span');
        name.className = 'line-name';
        name.textContent = line.description;

        var qty = document.createElement('span');
        qty.className = 'line-qty';
        qty.textContent = '×' + line.qty;

        var amt = document.createElement('span');
        amt.className = 'line-amt';
        amt.textContent = Core.formatMoney(Core.lineTotalCents(line));

        li.appendChild(name);
        li.appendChild(qty);
        li.appendChild(amt);
        linesEl.appendChild(li);
      });
    }

    totalEl.textContent = Core.formatMoney(Core.totalCents(cart));
  }

  // --- checkout: persist and reset ----------------------------------------
  function checkout() {
    if (cart.length === 0) {
      toast('Nothing to check out.', 'warn');
      return;
    }
    var receipt = Core.buildReceipt(cart, Date.now(), customerEl.value);
    DB.addReceipt(receipt).then(function () {
      toast('Sale saved · ' + Core.formatMoney(receipt.totalCents) +
            ' for ' + receipt.customer, 'ok');
      cart = [];
      customerEl.value = '';
      renderCart();
    }).catch(function (err) {
      toast('Could not save: ' + err.message, 'warn');
    });
  }

  // --- daily sales report --------------------------------------------------
  function showDailySales() {
    DB.getAllReceipts().then(function (receipts) {
      var sum = Core.summarize(receipts);
      reportSummary.textContent =
        receipts.length === 0
          ? 'No sales recorded yet.'
          : sum.receiptCount + ' sale' + (sum.receiptCount === 1 ? '' : 's') +
            ' · ' + sum.itemCount + ' item' + (sum.itemCount === 1 ? '' : 's') +
            ' · ' + Core.formatMoney(sum.totalCents) + ' total';

      reportBody.textContent = '';
      receipts.forEach(function (r) {
        var card = document.createElement('div');
        card.className = 'report-card';

        var head = document.createElement('div');
        head.className = 'report-card-head';
        var who = document.createElement('strong');
        who.textContent = r.customer;
        var when = document.createElement('span');
        when.className = 'report-when';
        when.textContent = formatDateTime(r.timestamp);
        head.appendChild(who);
        head.appendChild(when);

        var ul = document.createElement('ul');
        ul.className = 'report-items';
        r.items.forEach(function (it) {
          var li = document.createElement('li');
          li.textContent = it.qty + ' × ' + it.description + ' — ' +
            Core.formatMoney(it.lineTotalCents);
          ul.appendChild(li);
        });

        var foot = document.createElement('div');
        foot.className = 'report-card-total';
        foot.textContent = 'Total ' + Core.formatMoney(r.totalCents);

        card.appendChild(head);
        card.appendChild(ul);
        card.appendChild(foot);
        reportBody.appendChild(card);
      });
    });
  }

  function clearDatabase() {
    DB.getAllReceipts().then(function (receipts) {
      if (receipts.length === 0) {
        reportSummary.textContent = 'Nothing to clear.';
        reportBody.textContent = '';
        return;
      }
      var ok = window.confirm('Delete all ' + receipts.length +
        ' stored receipt(s)? This cannot be undone.');
      if (!ok) return;
      DB.clearAll().then(function () {
        reportSummary.textContent = 'All receipts cleared.';
        reportBody.textContent = '';
        toast('Database wiped.', 'ok');
      });
    });
  }

  // --- wire up -------------------------------------------------------------
  document.getElementById('clear-entry').addEventListener('click', function () {
    cart = Core.clearEntry(cart);
    renderCart();
  });
  document.getElementById('cancel-all').addEventListener('click', function () {
    cart = Core.cancelAll();
    renderCart();
  });
  document.getElementById('checkout').addEventListener('click', checkout);
  document.getElementById('daily-sales').addEventListener('click', showDailySales);
  document.getElementById('clear-db').addEventListener('click', clearDatabase);

  buildGrid();
  renderCart();
})();
