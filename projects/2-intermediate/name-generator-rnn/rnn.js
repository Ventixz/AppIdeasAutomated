/*
 * A character-level Recurrent Neural Network — a GRU cell trained with
 * backpropagation through time (BPTT) and Adam. Pure JavaScript, no libraries,
 * no DOM: the same file runs in the browser (attaching to `window.NameRNN`) and
 * under Node (via `module.exports`) so the math can be unit-tested.
 *
 * The network learns the letter-by-letter patterns of a list of names, then
 * samples brand-new names one character at a time from the probability
 * distribution it learned — optionally seeded with a prefix the user picks.
 */
(function (root) {
  'use strict';

  // ---- tiny linear-algebra helpers (row-major arrays) --------------------
  function zeros(n) { return new Float64Array(n); }
  function mat(rows, cols) { return { rows: rows, cols: cols, w: new Float64Array(rows * cols) }; }

  // Xavier-ish random init in [-s, s].
  function randMat(rows, cols, rng, scale) {
    var m = mat(rows, cols);
    var s = scale != null ? scale : Math.sqrt(6 / (rows + cols));
    for (var i = 0; i < m.w.length; i++) m.w[i] = (rng() * 2 - 1) * s;
    return m;
  }

  // y = M * x   (M: rows×cols, x: length cols) -> length rows
  function mulVec(M, x) {
    var out = zeros(M.rows);
    for (var r = 0; r < M.rows; r++) {
      var sum = 0, base = r * M.cols;
      for (var c = 0; c < M.cols; c++) sum += M.w[base + c] * x[c];
      out[r] = sum;
    }
    return out;
  }

  function sigmoid(v) { var o = zeros(v.length); for (var i = 0; i < v.length; i++) o[i] = 1 / (1 + Math.exp(-v[i])); return o; }
  function tanh(v) { var o = zeros(v.length); for (var i = 0; i < v.length; i++) o[i] = Math.tanh(v[i]); return o; }

  // A deterministic little PRNG so training/sampling is reproducible in tests.
  function makeRng(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  // ---- the model ----------------------------------------------------------
  function NameRNN(opts) {
    opts = opts || {};
    this.hidden = opts.hidden || 48;
    this.lr = opts.lr || 0.01;
    this.clip = opts.clip || 5;
    this.rng = makeRng(opts.seed || 12345);
    this.vocab = [];       // index -> char
    this.charToIx = {};    // char -> index
    this.built = false;
  }

  var STOP = '\n'; // start-of-name and end-of-name delimiter

  NameRNN.prototype.buildVocab = function (names) {
    var set = {};
    set[STOP] = true;
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      for (var j = 0; j < n.length; j++) set[n[j]] = true;
    }
    this.vocab = Object.keys(set).sort();
    this.charToIx = {};
    for (var k = 0; k < this.vocab.length; k++) this.charToIx[this.vocab[k]] = k;
  };

  NameRNN.prototype.initParams = function () {
    var H = this.hidden, V = this.vocab.length, rng = this.rng;
    // Gate weights: input (H×V) and recurrent (H×H) for update(z), reset(r), candidate(h).
    this.p = {
      Wz: randMat(H, V, rng), Uz: randMat(H, H, rng), bz: mat(H, 1),
      Wr: randMat(H, V, rng), Ur: randMat(H, H, rng), br: mat(H, 1),
      Wh: randMat(H, V, rng), Uh: randMat(H, H, rng), bh: mat(H, 1),
      Wy: randMat(V, H, rng), by: mat(V, 1)
    };
    // Adam moment buffers, one per parameter tensor.
    this.m = {}; this.v = {}; this.t = 0;
    for (var key in this.p) {
      this.m[key] = new Float64Array(this.p[key].w.length);
      this.v[key] = new Float64Array(this.p[key].w.length);
    }
    this.built = true;
  };

  NameRNN.prototype.train = function (names) {
    if (!this.built) { this.buildVocab(names); this.initParams(); }
  };

  // One-hot column for a character index.
  NameRNN.prototype.oneHot = function (ix) {
    var x = zeros(this.vocab.length); x[ix] = 1; return x;
  };

  // Forward + backward over a single name; returns the cross-entropy loss and
  // accumulates gradients into `grads`. This is the heart of BPTT.
  NameRNN.prototype.lossAndGrad = function (name, grads) {
    var H = this.hidden, V = this.vocab.length, p = this.p;
    // Build the timestep sequence: inputs are STOP + name chars, targets are
    // name chars + STOP (so the net learns where names end).
    var seq = [this.charToIx[STOP]];
    for (var c = 0; c < name.length; c++) seq.push(this.charToIx[name[c]]);
    var targets = seq.slice(1); targets.push(this.charToIx[STOP]);
    var T = targets.length;

    var xs = [], hs = [], zs = [], rs = [], hcs = [], hr = [];
    var hprev = zeros(H);
    hs[-1] = hprev;
    var loss = 0;

    // ---- forward ----
    for (var t = 0; t < T; t++) {
      var x = this.oneHot(seq[t]); xs[t] = x;
      var hp = hs[t - 1];
      var Wzx = mulVec(p.Wz, x), Uzh = mulVec(p.Uz, hp);
      var Wrx = mulVec(p.Wr, x), Urh = mulVec(p.Ur, hp);
      var z = zeros(H), r = zeros(H);
      for (var i = 0; i < H; i++) {
        z[i] = 1 / (1 + Math.exp(-(Wzx[i] + Uzh[i] + p.bz.w[i])));
        r[i] = 1 / (1 + Math.exp(-(Wrx[i] + Urh[i] + p.br.w[i])));
      }
      var rh = zeros(H);
      for (i = 0; i < H; i++) rh[i] = r[i] * hp[i];
      var Whx = mulVec(p.Wh, x), Uhrh = mulVec(p.Uh, rh);
      var hc = zeros(H), h = zeros(H);
      for (i = 0; i < H; i++) {
        hc[i] = Math.tanh(Whx[i] + Uhrh[i] + p.bh.w[i]);
        h[i] = (1 - z[i]) * hp[i] + z[i] * hc[i];
      }
      zs[t] = z; rs[t] = r; hcs[t] = hc; hr[t] = rh; hs[t] = h;

      // output layer + softmax
      var y = mulVec(p.Wy, h);
      for (i = 0; i < V; i++) y[i] += p.by.w[i];
      var max = -Infinity; for (i = 0; i < V; i++) if (y[i] > max) max = y[i];
      var sum = 0, ps = zeros(V);
      for (i = 0; i < V; i++) { ps[i] = Math.exp(y[i] - max); sum += ps[i]; }
      for (i = 0; i < V; i++) ps[i] /= sum;
      loss += -Math.log(Math.max(ps[targets[t]], 1e-12));
      xs[t].ps = ps; // stash prob for backward
    }

    // ---- backward ----
    var dhnext = zeros(H);
    for (t = T - 1; t >= 0; t--) {
      var psb = xs[t].ps;
      var dy = zeros(V);
      for (i = 0; i < V; i++) dy[i] = psb[i];
      dy[targets[t]] -= 1;

      // output layer grads
      var hcur = hs[t];
      for (var o = 0; o < V; o++) {
        grads.by.w[o] += dy[o];
        var bo = o * H;
        for (var q = 0; q < H; q++) grads.Wy.w[bo + q] += dy[o] * hcur[q];
      }
      // dh from output
      var dh = zeros(H);
      for (q = 0; q < H; q++) {
        var acc = 0;
        for (o = 0; o < V; o++) acc += p.Wy.w[o * H + q] * dy[o];
        dh[q] = acc + dhnext[q];
      }

      var zt = zs[t], rt = rs[t], hct = hcs[t], hpv = hs[t - 1], rht = hr[t];
      var xt = xs[t];
      var dhc = zeros(H), dz = zeros(H), dhprev = zeros(H);
      for (i = 0; i < H; i++) {
        dhc[i] = dh[i] * zt[i] * (1 - hct[i] * hct[i]);          // through tanh
        dz[i] = dh[i] * (hct[i] - hpv[i]) * zt[i] * (1 - zt[i]); // through sigmoid
        dhprev[i] += dh[i] * (1 - zt[i]);                         // direct path
      }
      // candidate weights Wh (x), Uh (r∘hprev), bh
      var dUhrh = zeros(H); // = dhc (since candidate pre-activation deriv already applied)
      for (i = 0; i < H; i++) dUhrh[i] = dhc[i];
      for (i = 0; i < H; i++) {
        grads.bh.w[i] += dhc[i];
        var bi = i * V;
        for (var cc = 0; cc < V; cc++) grads.Wh.w[bi + cc] += dhc[i] * xt[cc];
        var biH = i * H;
        for (q = 0; q < H; q++) grads.Uh.w[biH + q] += dhc[i] * rht[q];
      }
      // back through Uh into r∘hprev
      var drh = zeros(H);
      for (q = 0; q < H; q++) {
        var a = 0;
        for (i = 0; i < H; i++) a += p.Uh.w[i * H + q] * dUhrh[i];
        drh[q] = a;
      }
      var dr = zeros(H);
      for (i = 0; i < H; i++) {
        dr[i] = drh[i] * hpv[i] * rt[i] * (1 - rt[i]); // through reset sigmoid
        dhprev[i] += drh[i] * rt[i];                    // r∘hprev path into hprev
      }
      // z gate weights Wz/Uz/bz and r gate weights Wr/Ur/br
      for (i = 0; i < H; i++) {
        grads.bz.w[i] += dz[i];
        grads.br.w[i] += dr[i];
        var biV = i * V;
        for (cc = 0; cc < V; cc++) {
          grads.Wz.w[biV + cc] += dz[i] * xt[cc];
          grads.Wr.w[biV + cc] += dr[i] * xt[cc];
        }
        var biH2 = i * H;
        for (q = 0; q < H; q++) {
          grads.Uz.w[biH2 + q] += dz[i] * hpv[q];
          grads.Ur.w[biH2 + q] += dr[i] * hpv[q];
        }
      }
      // back through Uz, Ur into hprev
      for (q = 0; q < H; q++) {
        var az = 0, ar = 0;
        for (i = 0; i < H; i++) { az += p.Uz.w[i * H + q] * dz[i]; ar += p.Ur.w[i * H + q] * dr[i]; }
        dhprev[q] += az + ar;
      }
      dhnext = dhprev;
    }
    return loss / T;
  };

  NameRNN.prototype.newGrads = function () {
    var g = {};
    for (var key in this.p) g[key] = { rows: this.p[key].rows, cols: this.p[key].cols, w: new Float64Array(this.p[key].w.length) };
    return g;
  };

  // One Adam step over a mini-batch of names. Returns the mean loss.
  NameRNN.prototype.step = function (batch) {
    var grads = this.newGrads();
    var loss = 0;
    for (var b = 0; b < batch.length; b++) loss += this.lossAndGrad(batch[b], grads);
    loss /= batch.length;

    // average + clip gradients
    var clip = this.clip;
    for (var key in grads) {
      var gw = grads[key].w;
      for (var i = 0; i < gw.length; i++) {
        gw[i] /= batch.length;
        if (gw[i] > clip) gw[i] = clip; else if (gw[i] < -clip) gw[i] = -clip;
      }
    }
    // Adam update
    this.t++;
    var b1 = 0.9, b2 = 0.999, eps = 1e-8, lr = this.lr;
    var c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
    for (key in this.p) {
      var pw = this.p[key].w, m = this.m[key], v = this.v[key], g = grads[key].w;
      for (i = 0; i < pw.length; i++) {
        m[i] = b1 * m[i] + (1 - b1) * g[i];
        v[i] = b2 * v[i] + (1 - b2) * g[i] * g[i];
        var mhat = m[i] / c1, vhat = v[i] / c2;
        pw[i] -= lr * mhat / (Math.sqrt(vhat) + eps);
      }
    }
    return loss;
  };

  // Sample a name. `prefix` seeds the hidden state and is prepended to the
  // result. Temperature > 1 makes names weirder; < 1 makes them safer.
  NameRNN.prototype.sample = function (prefix, temperature, maxLen) {
    if (!this.built) throw new Error('train the model first');
    temperature = temperature || 1.0;
    maxLen = maxLen || 12;
    var H = this.hidden, V = this.vocab.length, p = this.p;
    prefix = (prefix || '').toLowerCase();

    var h = zeros(H);
    var name = '';
    var prevIx = this.charToIx[STOP];

    // Warm up the hidden state with the prefix characters we already know.
    var seedChars = [];
    for (var s = 0; s < prefix.length; s++) if (this.charToIx[prefix[s]] != null) seedChars.push(prefix[s]);
    var forced = seedChars.slice();

    for (var t = 0; t < maxLen; t++) {
      h = this.stepForward(prevIx, h);
      var y = mulVec(p.Wy, h);
      for (var i = 0; i < V; i++) y[i] += p.by.w[i];
      // softmax with temperature
      var max = -Infinity; for (i = 0; i < V; i++) { y[i] /= temperature; if (y[i] > max) max = y[i]; }
      var sum = 0, ps = zeros(V);
      for (i = 0; i < V; i++) { ps[i] = Math.exp(y[i] - max); sum += ps[i]; }
      for (i = 0; i < V; i++) ps[i] /= sum;

      var nextChar;
      if (forced.length) {
        nextChar = forced.shift();           // still replaying the seed
      } else {
        var ix = this.sampleIx(ps);
        nextChar = this.vocab[ix];
      }
      if (nextChar === STOP) break;
      name += nextChar;
      prevIx = this.charToIx[nextChar];
    }
    return name;
  };

  // Advance the hidden state one timestep given the previous char index.
  NameRNN.prototype.stepForward = function (prevIx, hp) {
    var H = this.hidden, p = this.p;
    var x = this.oneHot(prevIx);
    var Wzx = mulVec(p.Wz, x), Uzh = mulVec(p.Uz, hp);
    var Wrx = mulVec(p.Wr, x), Urh = mulVec(p.Ur, hp);
    var z = zeros(H), r = zeros(H);
    for (var i = 0; i < H; i++) {
      z[i] = 1 / (1 + Math.exp(-(Wzx[i] + Uzh[i] + p.bz.w[i])));
      r[i] = 1 / (1 + Math.exp(-(Wrx[i] + Urh[i] + p.br.w[i])));
    }
    var rh = zeros(H);
    for (i = 0; i < H; i++) rh[i] = r[i] * hp[i];
    var Whx = mulVec(p.Wh, x), Uhrh = mulVec(p.Uh, rh);
    var h = zeros(H);
    for (i = 0; i < H; i++) {
      var hc = Math.tanh(Whx[i] + Uhrh[i] + p.bh.w[i]);
      h[i] = (1 - z[i]) * hp[i] + z[i] * hc;
    }
    return h;
  };

  NameRNN.prototype.sampleIx = function (ps) {
    var rnd = this.rng(), acc = 0;
    for (var i = 0; i < ps.length; i++) { acc += ps[i]; if (rnd < acc) return i; }
    return ps.length - 1;
  };

  // ---- export -------------------------------------------------------------
  if (typeof module !== 'undefined' && module.exports) module.exports = { NameRNN: NameRNN, makeRng: makeRng };
  else root.NameRNN = NameRNN;
})(typeof window !== 'undefined' ? window : this);
