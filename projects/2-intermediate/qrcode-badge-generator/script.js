/* QRCode Badge Generator
 * Validates attendee input, renders a printable name badge, and encodes the
 * attendee's contact details as a scannable vCard QR code using the vendored
 * "qrcode-generator" NPM package (global `qrcode`).
 */
(function () {
  "use strict";

  var form = document.getElementById("badge-form");
  var errorsEl = document.getElementById("errors");

  var fields = {
    name: document.getElementById("name"),
    email: document.getElementById("email"),
    twitter: document.getElementById("twitter"),
    github: document.getElementById("github"),
  };

  var badge = document.getElementById("badge");
  var badgeEmpty = document.getElementById("badge-empty");
  var printBtn = document.getElementById("print");
  var cancelBtn = document.getElementById("cancel");

  var out = {
    name: document.getElementById("b-name"),
    email: document.getElementById("b-email"),
    twitter: document.getElementById("b-twitter"),
    github: document.getElementById("b-github"),
    twitterRow: document.getElementById("b-twitter-row"),
    githubRow: document.getElementById("b-github-row"),
    qr: document.getElementById("b-qr"),
  };

  // Reasonable, not-too-strict email check.
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* ---- Bonus: auto-prepend "@" to the Twitter handle ---- */
  fields.twitter.addEventListener("blur", function () {
    var v = fields.twitter.value.trim();
    if (v && v.charAt(0) !== "@") {
      fields.twitter.value = "@" + v;
    }
  });

  /* ---- Validation ---- */
  function validate() {
    var errors = [];
    var name = fields.name.value.trim();
    var email = fields.email.value.trim();
    var twitter = fields.twitter.value.trim();

    Object.keys(fields).forEach(function (k) {
      fields[k].classList.remove("invalid");
    });

    // Required fields present
    if (!name || !email) {
      errors.push("Required fields are empty.");
      if (!name) fields.name.classList.add("invalid");
      if (!email) fields.email.classList.add("invalid");
    }

    // First AND last name
    if (name && name.split(/\s+/).length < 2) {
      errors.push("Please provide both a first and last name.");
      fields.name.classList.add("invalid");
    }

    // Email format
    if (email && !EMAIL_RE.test(email)) {
      errors.push("Email input field isn't a properly formatted email address.");
      fields.email.classList.add("invalid");
    }

    // Twitter must start with "@" (optional field)
    if (twitter && twitter.charAt(0) !== "@") {
      errors.push("Twitter account name doesn't start with '@'.");
      fields.twitter.classList.add("invalid");
    }

    return errors;
  }

  function renderErrors(errors) {
    errorsEl.innerHTML = "";
    errors.forEach(function (msg) {
      var li = document.createElement("li");
      li.textContent = msg;
      errorsEl.appendChild(li);
    });
  }

  /* ---- Build the vCard payload the QR code encodes ---- */
  function buildVCard(data) {
    var parts = data.name.split(/\s+/);
    var first = parts[0];
    var last = parts.slice(1).join(" ");

    var lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:" + last + ";" + first,
      "FN:" + data.name,
      "EMAIL;TYPE=INTERNET:" + data.email,
    ];
    if (data.twitter) {
      var handle = data.twitter.replace(/^@/, "");
      lines.push("URL;TYPE=Twitter:https://twitter.com/" + handle);
      lines.push("X-SOCIALPROFILE;TYPE=twitter:" + data.twitter);
    }
    if (data.github) {
      lines.push("URL;TYPE=GitHub:https://github.com/" + data.github);
    }
    lines.push("END:VCARD");
    return lines.join("\n");
  }

  /* ---- Render the QR code with the vendored qrcode-generator package ---- */
  function renderQR(text) {
    // typeNumber 0 = auto-fit; "M" = medium error correction (good for print).
    var qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    // Crisp, print-friendly SVG. cellSize 4px, 2-cell quiet-zone margin.
    out.qr.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }

  /* ---- Show the badge ---- */
  function renderBadge(data) {
    out.name.textContent = data.name;
    out.email.textContent = data.email;

    if (data.twitter) {
      out.twitter.textContent = data.twitter;
      out.twitterRow.hidden = false;
    } else {
      out.twitterRow.hidden = true;
    }

    if (data.github) {
      out.github.textContent = data.github;
      out.githubRow.hidden = false;
    } else {
      out.githubRow.hidden = true;
    }

    renderQR(buildVCard(data));

    badgeEmpty.hidden = true;
    badge.hidden = false;
    printBtn.disabled = false; // Bonus: enabled only after a valid badge shows.
  }

  /* ---- Create (submit) ---- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var errors = validate();
    if (errors.length) {
      renderErrors(errors);
      // A previously shown badge stays valid only while inputs are; hide it.
      return;
    }
    renderErrors([]);
    renderBadge({
      name: fields.name.value.trim(),
      email: fields.email.value.trim(),
      twitter: fields.twitter.value.trim(),
      github: fields.github.value.trim(),
    });
  });

  /* ---- Cancel: clear inputs, errors, and the badge panel ---- */
  cancelBtn.addEventListener("click", function () {
    form.reset();
    renderErrors([]);
    Object.keys(fields).forEach(function (k) {
      fields[k].classList.remove("invalid");
    });
    out.qr.innerHTML = "";
    badge.hidden = true;
    badgeEmpty.hidden = false;
    printBtn.disabled = true;
  });

  /* ---- Print (bonus) ---- */
  printBtn.addEventListener("click", function () {
    if (!printBtn.disabled) window.print();
  });
})();
