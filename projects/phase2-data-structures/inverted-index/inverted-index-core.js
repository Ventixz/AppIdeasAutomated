/*
 * inverted-index-core.js — build an INVERTED INDEX over a set of text
 * documents and answer full-text search queries against it.
 *
 * A Source 2 (karan/Projects) "Data Structures" project. The karan spec reads:
 *
 *   "Inverted Index — An inverted index is a data structure used to create full
 *    text search. Given a set of text files, implement a program to create an
 *    inverted index. Also create a user interface to do a search using that
 *    inverted index which returns a list of files that contain the query
 *    term/terms. The search index can be in memory."
 *
 * An *inverted* index is the thing that makes "find every document containing
 * this word" fast. A *forward* index maps each document to the words it holds;
 * inverting it gives, for each word (a "term"), the sorted list of documents
 * that contain it — its POSTINGS LIST — and, per document, where in the text it
 * occurs (its positions). With that in hand a query is answered by merging a
 * few short sorted lists instead of re-reading every document.
 *
 * This module provides the whole pipeline, DOM-free so it runs under Node:
 *
 *   1. ANALYSIS. Raw text → a stream of normalised terms with positions. The
 *      analyzer lower-cases, splits on non-alphanumerics, and can optionally
 *      drop stop words and fold a few common suffixes (a conservative,
 *      documented heuristic stemmer). The SAME analyzer is used to build the
 *      index and to parse queries, so the two always speak the same language.
 *
 *   2. THE INDEX. term → postings list (doc ids ascending; per posting the term
 *      frequency and the list of token positions). Document lengths and
 *      document frequencies are kept for ranking.
 *
 *   3. QUERYING. A small recursive-descent boolean parser understands
 *      implicit AND, explicit OR, NOT / '-', "quoted phrases", and parentheses.
 *      It is evaluated over doc-id SETS using classic sorted-postings merges:
 *      AND = intersection, OR = union, NOT = complement, phrase = positional
 *      intersection. Matches are then ranked by TF-IDF.
 *
 * Why the answer is trustworthy — the index is only an *acceleration* of a
 * question with an obvious slow answer, so it is pinned to that slow answer:
 *
 *   - index set-algebra  ↔  per-document brute-force scan. Querying the index
 *     (merging postings) must return EXACTLY the set of documents you get by
 *     testing the very same boolean expression against each document on its own,
 *     with no index at all. The two share no code path. `tests.js` demands they
 *     agree on hand-built cases and on a long randomised fuzz loop.
 *   - postings are an invariant: ids strictly ascending and unique, tf equal to
 *     the number of recorded positions, positions ascending.
 *   - TF-IDF scores ↔ recomputed from the raw term counts.
 *
 * What is PROVED is that the index faithfully accelerates search over whatever
 * the analyzer produces. The stemmer and stop-word list are deliberately simple
 * linguistic *heuristics*; swapping them changes which words are considered
 * equal, but the index-vs-scan equivalence holds regardless, because both sides
 * run the identical analyzer.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.InvertedIndexCore = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ===========================================================================
  // 1. Analysis — raw text to a stream of normalised terms with positions
  // ===========================================================================

  // A small, conventional English stop-word list. Dropping these keeps the
  // index smaller and stops ultra-common words from dominating relevance. It is
  // a *choice*, not a correctness requirement — it can be turned off.
  var DEFAULT_STOPWORDS = (
    "a an and are as at be but by for if in into is it no not of on or such " +
    "that the their then there these they this to was will with i you he she " +
    "we me my your his her our its from have has had do does did about over"
  ).split(/\s+/);

  function stopwordSet(list) {
    var s = Object.create(null);
    for (var i = 0; i < list.length; i++) s[list[i]] = true;
    return s;
  }

  // A deliberately CONSERVATIVE suffix stemmer: it folds a handful of the most
  // common inflections (plurals and verb endings) so that "cats"/"cat" and
  // "running"/"run" collapse to one term, while refusing to touch short words
  // where chopping a suffix would be reckless. It is a heuristic, not Porter —
  // and it does not need to be perfect, because the index is only ever asked to
  // agree with a scan that runs this exact function.
  function stem(word) {
    var w = word;
    if (w.length <= 3) return w;            // too short to risk trimming
    // plural / 3rd-person: cities -> citi, boxes -> box, cats -> cat
    if (/ies$/.test(w) && w.length > 4) { w = w.slice(0, -3) + "i"; }
    else if (/(ches|shes|sses|xes|zes)$/.test(w)) { w = w.slice(0, -2); }
    else if (/ss$/.test(w)) { /* keep: "class" must not lose its s */ }
    else if (/s$/.test(w) && !/us$/.test(w)) { w = w.slice(0, -1); }
    // verb endings: running -> run, hopped -> hop, jumped -> jump
    if (/(.)\1ing$/.test(w)) { w = w.slice(0, -4); }          // doubled: runn-ing
    else if (/ing$/.test(w) && w.length > 5) { w = w.slice(0, -3); }
    if (/(.)\1ed$/.test(w)) { w = w.slice(0, -3); }           // doubled: hopp-ed
    else if (/ed$/.test(w) && w.length > 4) { w = w.slice(0, -2); }
    return w;
  }

  // Build an analyzer closure from options. `analyze` returns the ordered list
  // of {term, pos} (pos = running count of KEPT terms, so phrase positions are
  // adjacency in the surviving stream); `terms` is just the term strings.
  function makeAnalyzer(opts) {
    opts = opts || {};
    var doStem = opts.stem !== false;        // default ON
    var useStop = opts.stopwords !== false;  // default ON
    var stops = stopwordSet(
      Array.isArray(opts.stopwords) ? opts.stopwords :
      (useStop ? DEFAULT_STOPWORDS : [])
    );
    // A token is a maximal run of letters/digits. Apostrophes inside a word are
    // dropped ("don't" -> "dont") so possessives/contractions don't fragment.
    var TOKEN_RE = /[a-z0-9]+/g;

    function normalizeWord(raw) {
      var w = raw.toLowerCase();
      if (useStop && stops[w]) return null;
      if (doStem) w = stem(w);
      if (w === "") return null;
      return w;
    }

    function analyze(text) {
      if (text == null) return [];
      var cleaned = String(text).toLowerCase().replace(/['’]/g, "");
      var out = [], m, pos = 0;
      TOKEN_RE.lastIndex = 0;
      while ((m = TOKEN_RE.exec(cleaned)) !== null) {
        var t = normalizeWord(m[0]);
        if (t === null) continue;            // stop word → removed from stream
        out.push({ term: t, pos: pos });
        pos++;
      }
      return out;
    }

    function terms(text) {
      return analyze(text).map(function (x) { return x.term; });
    }

    return {
      analyze: analyze,
      terms: terms,
      stem: doStem ? stem : function (w) { return w; },
      isStop: function (w) { return useStop && !!stops[String(w).toLowerCase()]; },
      options: { stem: doStem, stopwords: useStop }
    };
  }

  // ===========================================================================
  // 2. The inverted index
  // ===========================================================================
  //
  // index = {
  //   analyzer,                      the analyzer used (shared with queries)
  //   docs:     [ {id, name, text, length, tf:{term->count}} ],
  //   postings: { term -> [ {id, tf, positions:[...]} ] }   (ids ascending)
  //   N,                             number of documents
  // }

  function buildIndex(input, opts) {
    var analyzer = makeAnalyzer(opts);
    // Accept either an array of {name,text} / [name,text] / string, or a plain
    // object {name: text}.
    var list = [];
    if (Array.isArray(input)) {
      for (var i = 0; i < input.length; i++) {
        var d = input[i];
        if (typeof d === "string") list.push({ name: "doc" + (i + 1), text: d });
        else if (Array.isArray(d)) list.push({ name: String(d[0]), text: d[1] });
        else list.push({ name: String(d.name), text: d.text == null ? "" : d.text });
      }
    } else if (input && typeof input === "object") {
      Object.keys(input).forEach(function (name) {
        list.push({ name: name, text: input[name] });
      });
    }

    var docs = [];
    var postings = Object.create(null);

    for (var id = 0; id < list.length; id++) {
      var stream = analyzer.analyze(list[id].text);
      var tf = Object.create(null);
      var positionsByTerm = Object.create(null);
      for (var k = 0; k < stream.length; k++) {
        var term = stream[k].term;
        tf[term] = (tf[term] || 0) + 1;
        (positionsByTerm[term] || (positionsByTerm[term] = [])).push(stream[k].pos);
      }
      docs.push({
        id: id,
        name: list[id].name,
        text: list[id].text == null ? "" : String(list[id].text),
        length: stream.length,
        tf: tf
      });
      // Append to each term's postings. Because we walk documents in ascending
      // id order, each postings list is naturally built in ascending-id order.
      Object.keys(positionsByTerm).forEach(function (t) {
        (postings[t] || (postings[t] = [])).push({
          id: id,
          tf: positionsByTerm[t].length,
          positions: positionsByTerm[t]
        });
      });
    }

    return { analyzer: analyzer, docs: docs, postings: postings, N: docs.length };
  }

  function postingsFor(index, term) {
    return index.postings[term] || [];
  }

  function docFrequency(index, term) {
    return postingsFor(index, term).length;
  }

  // The sorted list of doc ids containing `term` (already a normalised term).
  function termDocIds(index, term) {
    return postingsFor(index, term).map(function (p) { return p.id; });
  }

  // ---------------------------------------------------------------------------
  // Sorted-set merges — the heart of why an inverted index is fast. Every
  // postings list is sorted ascending, so union/intersection/difference are
  // linear single passes, never O(n²).
  // ---------------------------------------------------------------------------
  function intersect(a, b) {
    var out = [], i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { out.push(a[i]); i++; j++; }
      else if (a[i] < b[j]) i++;
      else j++;
    }
    return out;
  }
  function union(a, b) {
    var out = [], i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { out.push(a[i]); i++; j++; }
      else if (a[i] < b[j]) { out.push(a[i]); i++; }
      else { out.push(b[j]); j++; }
    }
    while (i < a.length) out.push(a[i++]);
    while (j < b.length) out.push(b[j++]);
    return out;
  }
  function difference(a, b) {           // a \ b  (ids in a but not b)
    var out = [], i = 0, j = 0;
    while (i < a.length) {
      if (j >= b.length || a[i] < b[j]) { out.push(a[i]); i++; }
      else if (a[i] === b[j]) { i++; j++; }
      else j++;
    }
    return out;
  }
  function allDocIds(index) {
    var out = [];
    for (var i = 0; i < index.N; i++) out.push(i);
    return out;
  }

  // Positional phrase match: the ids of documents where `terms` occur as a
  // contiguous run, in order. We intersect the docs that hold every term, then
  // check positions: some occurrence of term[0] at p must be followed by
  // term[1] at p+1, term[2] at p+2, and so on.
  function phraseDocIds(index, terms) {
    if (terms.length === 0) return [];
    if (terms.length === 1) return termDocIds(index, terms[0]);
    // candidate docs = intersection of all terms' postings
    var candidate = termDocIds(index, terms[0]);
    for (var t = 1; t < terms.length && candidate.length; t++) {
      candidate = intersect(candidate, termDocIds(index, terms[t]));
    }
    var out = [];
    for (var c = 0; c < candidate.length; c++) {
      var id = candidate[c];
      // position sets per term in this doc
      var firstPos = positionsIn(index, terms[0], id);
      var found = false;
      for (var f = 0; f < firstPos.length && !found; f++) {
        var start = firstPos[f], okRun = true;
        for (var s = 1; s < terms.length; s++) {
          if (!hasPosition(index, terms[s], id, start + s)) { okRun = false; break; }
        }
        if (okRun) found = true;
      }
      if (found) out.push(id);
    }
    return out;
  }
  function positionsIn(index, term, id) {
    var ps = postingsFor(index, term);
    for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i].positions;
    return [];
  }
  function hasPosition(index, term, id, pos) {
    var arr = positionsIn(index, term, id);
    // binary search (positions ascending)
    var lo = 0, hi = arr.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (arr[mid] === pos) return true;
      if (arr[mid] < pos) lo = mid + 1; else hi = mid - 1;
    }
    return false;
  }

  // ===========================================================================
  // 3. Query language — a tiny recursive-descent boolean parser
  // ===========================================================================
  //
  //   expr   := orexpr
  //   orexpr := andexpr ( "OR" andexpr )*
  //   andexpr:= unary ( ("AND")? unary )*          (AND is implicit)
  //   unary  := ("NOT" | "-") unary | atom
  //   atom   := "(" expr ")" | '"' word+ '"' | word
  //
  // The AST nodes:
  //   {type:"term",   term:"cat"}
  //   {type:"phrase", terms:["new","york"]}
  //   {type:"and",    children:[...]}
  //   {type:"or",     children:[...]}
  //   {type:"not",    child:{...}}
  //   {type:"empty"}                               (a query with no real terms)
  //
  // Words inside the query are run through the SAME analyzer as the documents,
  // so "Cats" in a query finds "cat" in the index. A word that the analyzer
  // drops entirely (a stop word) becomes an {type:"empty"} leaf that is treated
  // as "matches nothing" on its own but is harmless inside AND/OR.

  function tokenizeQuery(q) {
    var toks = [], i = 0, s = String(q == null ? "" : q);
    while (i < s.length) {
      var c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "(" || c === ")") { toks.push({ k: c }); i++; continue; }
      if (c === "-" ) { toks.push({ k: "-" }); i++; continue; }
      if (c === '"' || c === "“" || c === "”") {
        // read until the matching quote (or end of string)
        var j = i + 1, buf = "";
        while (j < s.length && !(s[j] === '"' || s[j] === "“" || s[j] === "”")) {
          buf += s[j]; j++;
        }
        toks.push({ k: "phrase", text: buf });
        i = (j < s.length) ? j + 1 : j;
        continue;
      }
      // a bare word: read until whitespace, paren or quote
      var w = "";
      while (i < s.length && !/[\s()"]/.test(s[i]) && s[i] !== "“" && s[i] !== "”") {
        w += s[i]; i++;
      }
      var up = w.toUpperCase();
      if (up === "AND") toks.push({ k: "AND" });
      else if (up === "OR") toks.push({ k: "OR" });
      else if (up === "NOT") toks.push({ k: "NOT" });
      else toks.push({ k: "word", text: w });
    }
    return toks;
  }

  function parseQuery(q, analyzer) {
    var toks = tokenizeQuery(q);
    var pos = 0;
    function peek() { return toks[pos]; }
    function next() { return toks[pos++]; }

    function wordAtom(text) {
      var terms = analyzer.terms(text);
      if (terms.length === 0) return { type: "empty" };
      if (terms.length === 1) return { type: "term", term: terms[0] };
      // a single query "word" that analysis split into several (rare) → phrase
      return { type: "phrase", terms: terms };
    }

    function parseAtom() {
      var t = peek();
      if (!t) return null;
      if (t.k === "(") {
        next();
        var e = parseOr();
        if (peek() && peek().k === ")") next();   // tolerate a missing ')'
        return e || { type: "empty" };
      }
      if (t.k === "phrase") {
        next();
        var terms = analyzer.terms(t.text);
        if (terms.length === 0) return { type: "empty" };
        if (terms.length === 1) return { type: "term", term: terms[0] };
        return { type: "phrase", terms: terms };
      }
      if (t.k === "word") { next(); return wordAtom(t.text); }
      return null;   // a stray operator/paren where an atom was expected
    }

    function parseUnary() {
      var t = peek();
      if (t && (t.k === "NOT" || t.k === "-")) {
        next();
        var child = parseUnary();
        if (!child) return null;
        return { type: "not", child: child };
      }
      return parseAtom();
    }

    function parseAnd() {
      var children = [];
      while (true) {
        var t = peek();
        if (!t || t.k === ")" || t.k === "OR") break;
        if (t.k === "AND") { next(); continue; }   // explicit AND is a no-op join
        var u = parseUnary();
        if (u === null) { next(); continue; }       // skip something unparseable
        children.push(u);
      }
      if (children.length === 0) return { type: "empty" };
      if (children.length === 1) return children[0];
      return { type: "and", children: children };
    }

    function parseOr() {
      var left = parseAnd();
      var parts = [left];
      while (peek() && peek().k === "OR") {
        next();
        parts.push(parseAnd());
      }
      if (parts.length === 1) return left;
      return { type: "or", children: parts };
    }

    var ast = parseOr();
    return ast || { type: "empty" };
  }

  // Collect the positive (non-negated) terms of an AST — the ones that should
  // drive relevance ranking and snippet highlighting.
  function positiveTerms(ast, acc) {
    acc = acc || [];
    if (!ast) return acc;
    switch (ast.type) {
      case "term": acc.push(ast.term); break;
      case "phrase": ast.terms.forEach(function (t) { acc.push(t); }); break;
      case "and":
      case "or": ast.children.forEach(function (c) { positiveTerms(c, acc); }); break;
      case "not": /* skip negated subtree */ break;
    }
    return acc;
  }

  // ---------------------------------------------------------------------------
  // Evaluate an AST over the index, returning a SORTED list of matching doc ids
  // by merging postings lists. This is the "fast" path.
  // ---------------------------------------------------------------------------
  function evaluate(index, ast) {
    switch (ast.type) {
      case "empty":  return [];
      case "term":   return termDocIds(index, ast.term);
      case "phrase": return phraseDocIds(index, ast.terms);
      case "not":    return difference(allDocIds(index), evaluate(index, ast.child));
      case "and": {
        var nonEmpty = ast.children.filter(function (c) { return c.type !== "empty"; });
        if (nonEmpty.length === 0) return [];
        var acc = evaluate(index, nonEmpty[0]);
        for (var i = 1; i < nonEmpty.length && acc.length; i++) {
          acc = intersect(acc, evaluate(index, nonEmpty[i]));
        }
        return acc;
      }
      case "or": {
        var acc2 = [];
        for (var j = 0; j < ast.children.length; j++) {
          if (ast.children[j].type === "empty") continue;
          acc2 = union(acc2, evaluate(index, ast.children[j]));
        }
        return acc2;
      }
      default: return [];
    }
  }

  // ===========================================================================
  // 4. The brute-force ORACLE — the same boolean question, answered without any
  //    index, by scanning each document on its own. `tests.js` requires that
  //    this and `evaluate` return identical sets for every query.
  // ===========================================================================

  // Per-document analysis cache for the oracle: term set + ordered term stream.
  function docAnalysis(index, id) {
    var d = index.docs[id];
    if (!d._oracle) {
      var stream = index.analyzer.terms(d.text);
      var set = Object.create(null);
      for (var i = 0; i < stream.length; i++) set[stream[i]] = true;
      d._oracle = { stream: stream, set: set };
    }
    return d._oracle;
  }

  function docContainsTerm(index, id, term) {
    return !!docAnalysis(index, id).set[term];
  }
  function docContainsPhrase(index, id, terms) {
    if (terms.length === 0) return false;
    var stream = docAnalysis(index, id).stream;
    for (var i = 0; i + terms.length <= stream.length; i++) {
      var ok = true;
      for (var j = 0; j < terms.length; j++) {
        if (stream[i + j] !== terms[j]) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }
  function docMatches(index, id, ast) {
    switch (ast.type) {
      case "empty":  return false;
      case "term":   return docContainsTerm(index, id, ast.term);
      case "phrase": return docContainsPhrase(index, id, ast.terms);
      case "not":    return !docMatches(index, id, ast.child);
      case "and": {
        // Stop-word-only ('empty') children carry no constraint — drop them, to
        // match `evaluate`, which filters them out of the postings merge.
        var andKids = ast.children.filter(function (c) { return c.type !== "empty"; });
        if (andKids.length === 0) return false;
        return andKids.every(function (c) { return docMatches(index, id, c); });
      }
      case "or": {
        var orKids = ast.children.filter(function (c) { return c.type !== "empty"; });
        if (orKids.length === 0) return false;
        return orKids.some(function (c) { return docMatches(index, id, c); });
      }
      default: return false;
    }
  }
  // Scan every document; return the sorted ids where the AST holds.
  function scanMatch(index, ast) {
    var out = [];
    for (var id = 0; id < index.N; id++) if (docMatches(index, id, ast)) out.push(id);
    return out;
  }

  // ===========================================================================
  // 5. Ranking — TF-IDF over the query's positive terms
  // ===========================================================================
  //
  //   tf weight = 1 + log10(tf)        (sub-linear: the 10th occurrence counts
  //                                     for less than the 1st)
  //   idf       = log10(N / df)        (a term in every doc carries no signal)
  //   score(d)  = Σ over positive query terms of  tfweight(t,d) * idf(t)
  //
  function idf(index, term) {
    var df = docFrequency(index, term);
    if (df === 0) return 0;
    return Math.log(index.N / df) / Math.LN10;
  }
  function tfWeight(count) {
    return count > 0 ? 1 + Math.log(count) / Math.LN10 : 0;
  }
  function scoreDoc(index, id, terms) {
    var d = index.docs[id], s = 0;
    for (var i = 0; i < terms.length; i++) {
      var c = d.tf[terms[i]] || 0;
      if (c > 0) s += tfWeight(c) * idf(index, terms[i]);
    }
    return s;
  }

  // ===========================================================================
  // 6. The one public entry point the UI calls: parse → evaluate → rank
  // ===========================================================================
  //
  // Returns { ast, terms, results:[ {id, name, score, tf:{term->count}} ] }
  // ordered by descending score, ties broken by ascending id (stable, so the
  // original document order shows through when scores match).
  function search(index, query) {
    var ast = parseQuery(query, index.analyzer);
    var ids = evaluate(index, ast);
    var terms = dedupe(positiveTerms(ast));
    var results = ids.map(function (id) {
      var tfMap = Object.create(null);
      terms.forEach(function (t) { tfMap[t] = index.docs[id].tf[t] || 0; });
      return {
        id: id,
        name: index.docs[id].name,
        score: scoreDoc(index, id, terms),
        tf: tfMap
      };
    });
    results.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.id - b.id;
    });
    return { ast: ast, terms: terms, results: results };
  }

  function dedupe(arr) {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < arr.length; i++) {
      if (!seen[arr[i]]) { seen[arr[i]] = true; out.push(arr[i]); }
    }
    return out;
  }

  // A compact human string for an AST, handy for the UI and for test messages.
  function describe(ast) {
    switch (ast.type) {
      case "empty":  return "∅";
      case "term":   return ast.term;
      case "phrase": return '"' + ast.terms.join(" ") + '"';
      case "not":    return "NOT " + describe(ast.child);
      case "and":    return "(" + ast.children.map(describe).join(" AND ") + ")";
      case "or":     return "(" + ast.children.map(describe).join(" OR ") + ")";
      default:       return "?";
    }
  }

  // Validate the structural invariants of the index (used by the tests and by
  // the UI's live "Verified" line). Returns {ok, errors:[...]}.
  function checkInvariants(index) {
    var errors = [];
    Object.keys(index.postings).forEach(function (term) {
      var list = index.postings[term];
      var prev = -1;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (p.id <= prev) errors.push("postings for '" + term + "' not strictly ascending at id " + p.id);
        prev = p.id;
        if (p.tf !== p.positions.length) errors.push("tf≠#positions for '" + term + "' in doc " + p.id);
        for (var j = 1; j < p.positions.length; j++) {
          if (p.positions[j] <= p.positions[j - 1]) errors.push("positions not ascending for '" + term + "' in doc " + p.id);
        }
      }
    });
    return { ok: errors.length === 0, errors: errors };
  }

  // ===========================================================================
  // Exports
  // ===========================================================================
  return {
    // analysis
    makeAnalyzer: makeAnalyzer,
    stem: stem,
    DEFAULT_STOPWORDS: DEFAULT_STOPWORDS,
    // index
    buildIndex: buildIndex,
    postingsFor: postingsFor,
    docFrequency: docFrequency,
    termDocIds: termDocIds,
    allDocIds: allDocIds,
    phraseDocIds: phraseDocIds,
    // set merges
    intersect: intersect,
    union: union,
    difference: difference,
    // query
    tokenizeQuery: tokenizeQuery,
    parseQuery: parseQuery,
    positiveTerms: positiveTerms,
    evaluate: evaluate,
    describe: describe,
    // oracle
    scanMatch: scanMatch,
    docMatches: docMatches,
    // ranking + entry point
    idf: idf,
    tfWeight: tfWeight,
    scoreDoc: scoreDoc,
    search: search,
    // invariants
    checkInvariants: checkInvariants
  };
});
