/*
 * progress-node.js — the real-I/O adapter. It downloads a file over HTTP(S)
 * using N concurrent workers and drives the DOM-free ProgressAggregator from
 * progress-core.js, rendering a live bar to the terminal.
 *
 * This is where the "threading" idea earns its keep. Node is single-threaded
 * for JS, but concurrent I/O is the same coordination problem: N requests are
 * in flight at once, their 'data' events interleave unpredictably, and every
 * one of them wants to update the same progress bar. We do NOT let them. Each
 * worker owns a Range of the file, counts only its own received bytes, and
 * reports that absolute count to the aggregator. The aggregator is the single
 * owner of the total. No shared counter, no `+=`, no lock.
 *
 * If the server supports HTTP range requests (Accept-Ranges: bytes), the file
 * is split into `concurrency` contiguous parts fetched in parallel; otherwise
 * it gracefully degrades to a single stream. Either way the progress code is
 * identical — that is the payoff of keeping the engine transport-agnostic.
 *
 * Usage:
 *   node progress-node.js <url> [outfile] [--concurrency=4]
 *   node progress-node.js --demo        # no network: simulated concurrent parts
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const { URL } = require('url');
const {
  ProgressAggregator, renderBar, formatBytes, formatDuration,
} = require('./progress-core.js');

/* ---- tiny promisified HEAD/GET that follows a few redirects ---- */

function pick(urlStr) {
  return urlStr.startsWith('https:') ? https : http;
}

function request(method, urlStr, headers, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = pick(urlStr).request(u, { method, headers }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        const next = new URL(res.headers.location, urlStr).toString();
        return resolve(request(method, next, headers, redirectsLeft - 1));
      }
      resolve(res);
    });
    req.on('error', reject);
    req.end();
  });
}

/** Discover total size and whether the server supports range requests. */
async function probe(urlStr) {
  const res = await request('HEAD', urlStr, {});
  res.resume();
  const len = res.headers['content-length'];
  return {
    total: len != null ? Number(len) : null,
    acceptRanges: (res.headers['accept-ranges'] || '').includes('bytes'),
  };
}

/** Fetch byte range [start, end] of a URL, reporting absolute progress. */
function fetchRange(urlStr, id, start, end, agg, sink) {
  return new Promise((resolve, reject) => {
    const headers = start != null ? { Range: `bytes=${start}-${end}` } : {};
    pick(urlStr).get(new URL(urlStr), { headers }, (res) => {
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`worker ${id}: HTTP ${res.statusCode}`));
      }
      let got = 0;
      res.on('data', (chunk) => {
        if (sink) sink(start == null ? got : start + got, chunk);
        got += chunk.length;
        // report THIS worker's own absolute byte count — never a shared total
        agg.report(id, got);
      });
      res.on('end', () => { agg.report(id, got); resolve(got); });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/* ---- live terminal rendering ---- */

function startRenderer(agg, label) {
  if (!process.stdout.isTTY) return { stop() {} };
  const draw = () => {
    const snap = agg.snapshot();
    process.stdout.write('\r\x1b[2K' + label + ' ' + renderBar(snap, { width: 28 }));
  };
  const timer = setInterval(draw, 100);
  return {
    stop() {
      clearInterval(timer);
      draw();
      process.stdout.write('\n');
    },
  };
}

/* ---- orchestration: split into parts and run them concurrently ---- */

async function download(urlStr, outfile, concurrency = 4) {
  const { total, acceptRanges } = await probe(urlStr);
  const agg = new ProgressAggregator({ halfLifeSec: 2 });

  const parts = (acceptRanges && total && concurrency > 1)
    ? splitRanges(total, concurrency)
    : [{ start: null, end: null, size: total }];

  // pre-allocate the output file so parts can be written at their offsets
  const fd = outfile ? fs.openSync(outfile, 'w') : null;

  parts.forEach((p, i) => agg.addWorker(i, p.size));
  const label = parts.length > 1
    ? `↓ ${parts.length} parts`
    : '↓ 1 stream';
  const renderer = startRenderer(agg, label);

  try {
    await Promise.all(parts.map((p, i) => fetchRange(
      urlStr, i, p.start, p.end, agg,
      fd != null ? (absOffset, chunk) => fs.writeSync(fd, chunk, 0, chunk.length,
        (p.start || 0) + (absOffset - (p.start || 0))) : null,
    )));
  } finally {
    renderer.stop();
    if (fd != null) fs.closeSync(fd);
  }

  const snap = agg.snapshot();
  console.log(`✓ ${formatBytes(snap.done)} in ${formatDuration(snap.elapsedSec)}` +
    (outfile ? ` → ${outfile}` : ''));
  return agg;
}

function splitRanges(total, n) {
  const parts = [];
  const base = Math.floor(total / n);
  let start = 0;
  for (let i = 0; i < n; i++) {
    const size = i === n - 1 ? total - start : base;
    parts.push({ start, end: start + size - 1, size });
    start += size;
  }
  return parts;
}

/* ---- demo: no network, simulate concurrent parts arriving in bursts ---- */

async function demo() {
  const agg = new ProgressAggregator({ halfLifeSec: 1.5 });
  const parts = [2_500_000, 2_500_000, 2_500_000, 2_500_000];
  parts.forEach((size, i) => agg.addWorker(i, size));
  const got = parts.map(() => 0);
  const renderer = startRenderer(agg, '↓ demo (4 parts)');

  await new Promise((resolve) => {
    const timer = setInterval(() => {
      let allDone = true;
      for (let i = 0; i < parts.length; i++) {
        if (got[i] < parts[i]) {
          // each "worker" advances by a random burst, independently
          got[i] = Math.min(parts[i], got[i] + Math.floor(Math.random() * 180_000));
          agg.report(i, got[i]);        // absolute position, per worker
          if (got[i] < parts[i]) allDone = false;
        }
      }
      if (allDone) { clearInterval(timer); resolve(); }
    }, 60);
  });
  renderer.stop();
  const snap = agg.snapshot();
  console.log(`✓ simulated ${formatBytes(snap.done)} in ${formatDuration(snap.elapsedSec)}`);
}

/* ---- CLI ---- */

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--demo') || args.length === 0) {
    demo().catch((e) => { console.error(e.message); process.exit(1); });
  } else {
    const url = args.find((a) => !a.startsWith('--'));
    const out = args.filter((a) => !a.startsWith('--') && a !== url)[0] || null;
    const cArg = args.find((a) => a.startsWith('--concurrency='));
    const concurrency = cArg ? Math.max(1, parseInt(cArg.split('=')[1], 10)) : 4;
    download(url, out, concurrency).catch((e) => {
      console.error('\n' + e.message); process.exit(1);
    });
  }
}

module.exports = { download, probe, fetchRange, splitRanges, demo };
