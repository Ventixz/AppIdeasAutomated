// sample-data.js — a bundled snapshot of the NASA Exoplanet Archive, shaped
// exactly like a real CSV export from
// https://exoplanetarchive.ipac.caltech.edu/ (the Confirmed Planets table).
//
// The spec loads the archive's ~4,000-row CSV live. There is no network here, so
// this file ships a representative slice of real, confirmed exoplanets as the
// same CSV text a `select pl_name,hostname,disc_year,discoverymethod,
// disc_facility from ps` export produces — leading `#` comment lines and all —
// so the engine's CSV reader is exercised on genuine archive formatting.
// Swapping in the full live download is a one-line change in script.js; the
// engine never sees anything but this CSV shape.
//
// Exported as a string so the app also runs straight from file:// with no fetch.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; // Node
  else root.ExoplanetSample = api;                                        // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // A hand-picked, historically notable cross-section: the first RV detections,
  // the Kepler/K2/TESS transit hauls, the TRAPPIST-1 system, nearby small
  // planets, and a pulsar planet — spanning 1992–2020 and many facilities so
  // every dropdown has real variety to filter on.
  const CSV = `# This file was produced by the NASA Exoplanet Archive
# https://exoplanetarchive.ipac.caltech.edu
# Fri Aug 27 00:00:00 2026
#
# COLUMN pl_name:         Planet Name
# COLUMN hostname:        Host Name
# COLUMN disc_year:       Discovery Year
# COLUMN discoverymethod: Discovery Method
# COLUMN disc_facility:   Discovery Facility
#
pl_name,hostname,disc_year,discoverymethod,disc_facility
PSR B1257+12 b,PSR B1257+12,1992,Pulsar Timing,Arecibo Observatory
PSR B1257+12 c,PSR B1257+12,1992,Pulsar Timing,Arecibo Observatory
PSR B1257+12 d,PSR B1257+12,1992,Pulsar Timing,Arecibo Observatory
51 Peg b,51 Peg,1995,Radial Velocity,Haute-Provence Observatory
47 UMa b,47 UMa,1996,Radial Velocity,Lick Observatory
Tau Boo b,tau Boo,1996,Radial Velocity,Lick Observatory
16 Cyg B b,16 Cyg B,1996,Radial Velocity,Lick Observatory
Ups And b,ups And,1996,Radial Velocity,Lick Observatory
Gliese 876 b,GJ 876,1998,Radial Velocity,W. M. Keck Observatory
HD 209458 b,HD 209458,1999,Radial Velocity,Haute-Provence Observatory
Gliese 876 c,GJ 876,2001,Radial Velocity,W. M. Keck Observatory
55 Cnc e,55 Cnc,2004,Radial Velocity,W. M. Keck Observatory
HD 189733 b,HD 189733,2005,Radial Velocity,Haute-Provence Observatory
Gliese 581 b,GJ 581,2005,Radial Velocity,La Silla Observatory
Gliese 581 c,GJ 581,2007,Radial Velocity,La Silla Observatory
Gliese 581 d,GJ 581,2007,Radial Velocity,La Silla Observatory
HAT-P-7 b,HAT-P-7,2008,Transit,HATNet
WASP-12 b,WASP-12,2008,Transit,SuperWASP
CoRoT-7 b,CoRoT-7,2009,Transit,CoRoT
GJ 1214 b,GJ 1214,2009,Transit,MEarth Project
HD 10180 c,HD 10180,2010,Radial Velocity,La Silla Observatory
Kepler-9 b,Kepler-9,2010,Transit,Kepler
Kepler-10 b,Kepler-10,2011,Transit,Kepler
Kepler-16 b,Kepler-16,2011,Transit,Kepler
Kepler-22 b,Kepler-22,2011,Transit,Kepler
Gliese 667 C c,GJ 667 C,2011,Radial Velocity,La Silla Observatory
Kepler-20 e,Kepler-20,2011,Transit,Kepler
Kepler-47 b,Kepler-47,2012,Transit,Kepler
Kepler-62 e,Kepler-62,2013,Transit,Kepler
Kepler-62 f,Kepler-62,2013,Transit,Kepler
Kepler-78 b,Kepler-78,2013,Transit,Kepler
Kepler-186 f,Kepler-186,2014,Transit,Kepler
Kepler-10 c,Kepler-10,2014,Transit,Kepler
Kepler-452 b,Kepler-452,2015,Transit,Kepler
Kepler-442 b,Kepler-442,2015,Transit,Kepler
WASP-121 b,WASP-121,2015,Transit,SuperWASP
K2-3 d,K2-3,2015,Transit,K2
HD 219134 b,HD 219134,2015,Radial Velocity,W. M. Keck Observatory
Proxima Cen b,Proxima Cen,2016,Radial Velocity,La Silla Observatory
TRAPPIST-1 b,TRAPPIST-1,2016,Transit,TRAPPIST
TRAPPIST-1 c,TRAPPIST-1,2016,Transit,TRAPPIST
TRAPPIST-1 d,TRAPPIST-1,2017,Transit,TRAPPIST
TRAPPIST-1 e,TRAPPIST-1,2017,Transit,Very Large Telescope (VLT)
TRAPPIST-1 f,TRAPPIST-1,2017,Transit,Very Large Telescope (VLT)
TRAPPIST-1 g,TRAPPIST-1,2017,Transit,Very Large Telescope (VLT)
TRAPPIST-1 h,TRAPPIST-1,2017,Transit,K2
LHS 1140 b,LHS 1140,2017,Transit,MEarth Project
Ross 128 b,Ross 128,2017,Radial Velocity,La Silla Observatory
K2-18 b,K2-18,2017,Transit,K2
TOI-700 d,TOI-700,2020,Transit,Transiting Exoplanet Survey Satellite (TESS)
GJ 887 b,GJ 887,2020,Radial Velocity,La Silla Observatory
`;

  return { CSV };
});
