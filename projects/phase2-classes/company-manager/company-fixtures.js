/*
 * company-fixtures.js — a sample company shared by all three front ends, so the
 * CLI, the browser demo and (optionally) the tests start from the same roster.
 * `buildCompany(core)` takes the core module (Node `require` or `window`) and
 * returns a populated Company, including an org chart and a couple of logged
 * timesheets, so a pay run has something to show immediately.
 */
'use strict';

function buildCompany(core) {
  const { Company, HourlyEmployee, SalariedEmployee, Manager, Executive } = core;

  const co = new Company('Northwind Robotics');

  // --- the people, one of each kind (and then some) ---------------------
  const ceo   = new Executive('Dana Okafor', '320000', { id: 'E-0001', annualBonus: '80000', profitSharePercent: 2.5 });
  const cto   = new Executive('Ravi Mehta',  '295000', { id: 'E-0002', annualBonus: '70000', profitSharePercent: 1.5 });
  const engMgr = new Manager('Lena Fischer', '175000', { id: 'E-0003', annualBonus: '25000' });
  const sales  = new SalariedEmployee('Tom Alvarez', '92000', { id: 'E-0004' });
  const dev    = new SalariedEmployee('Priya Nair',  '138000', { id: 'E-0005' });
  const tech1  = new HourlyEmployee('Sam Lee',   '38.50', { id: 'E-0006' });
  const tech2  = new HourlyEmployee('Jordan Kim', '41.00', { id: 'E-0007' });

  for (const p of [ceo, cto, engMgr, sales, dev, tech1, tech2]) co.hire(p);

  // --- the org chart ----------------------------------------------------
  ceo.addReport(cto);
  ceo.addReport(sales);
  cto.addReport(engMgr);
  engMgr.addReport(dev);
  engMgr.addReport(tech1);
  engMgr.addReport(tech2);

  // --- two timesheets, so hourly pay (and overtime) is non-trivial ------
  tech1.logWeek(40).logWeek(45);   // second week has 5 overtime hours
  tech2.logWeek(38.5).logWeek(40); // a partial week, no overtime

  return co;
}

const fixturesApi = { buildCompany };

if (typeof module !== 'undefined' && module.exports) module.exports = fixturesApi;
if (typeof window !== 'undefined') window.CompanyFixtures = fixturesApi;
