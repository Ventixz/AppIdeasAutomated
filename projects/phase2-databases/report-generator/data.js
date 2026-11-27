'use strict';
/*
 * data.js — the "tables that hold records" the task asks for.
 *
 * Two datasets. Money is stored as INTEGER CENTS (amountCents), never floating
 * dollars — that is what lets a report's subtotals reconcile to the grand total
 * exactly. Dates are ISO 'YYYY-MM-DD' strings so month/year grouping is a prefix.
 */

const SALES = {
  name: 'Sales',
  columns: [
    { name: 'region', label: 'Region', type: 'string' },
    { name: 'category', label: 'Category', type: 'string' },
    { name: 'product', label: 'Product', type: 'string' },
    { name: 'rep', label: 'Rep', type: 'string' },
    { name: 'date', label: 'Date', type: 'date' },
    { name: 'units', label: 'Units', type: 'int' },
    { name: 'amountCents', label: 'Amount', type: 'money' },
    { name: 'costCents', label: 'Cost', type: 'money' },
  ],
  rows: [
    { region: 'East', category: 'Hardware', product: 'Laptop', rep: 'Ada', date: '2026-01-07', units: 3, amountCents: 359700, costCents: 240000 },
    { region: 'East', category: 'Hardware', product: 'Monitor', rep: 'Ada', date: '2026-01-19', units: 6, amountCents: 119400, costCents: 72000 },
    { region: 'East', category: 'Hardware', product: 'Keyboard', rep: 'Ben', date: '2026-02-03', units: 10, amountCents: 59900, costCents: 25000 },
    { region: 'East', category: 'Software', product: 'IDE License', rep: 'Ada', date: '2026-01-22', units: 4, amountCents: 79600, costCents: 12000 },
    { region: 'East', category: 'Software', product: 'Antivirus', rep: 'Ben', date: '2026-02-11', units: 8, amountCents: 31920, costCents: 6400 },
    { region: 'East', category: 'Services', product: 'Onboarding', rep: 'Ben', date: '2026-03-02', units: 1, amountCents: 150000, costCents: 40000 },
    { region: 'East', category: 'Services', product: 'Support Plan', rep: 'Ada', date: '2026-03-15', units: 2, amountCents: 240000, costCents: 50000 },

    { region: 'North', category: 'Hardware', product: 'Laptop', rep: 'Cleo', date: '2026-01-05', units: 5, amountCents: 599500, costCents: 400000 },
    { region: 'North', category: 'Hardware', product: 'Dock', rep: 'Cleo', date: '2026-02-14', units: 7, amountCents: 104300, costCents: 49000 },
    { region: 'North', category: 'Software', product: 'IDE License', rep: 'Dev', date: '2026-01-28', units: 9, amountCents: 179100, costCents: 27000 },
    { region: 'North', category: 'Software', product: 'Cloud Backup', rep: 'Cleo', date: '2026-02-20', units: 12, amountCents: 71880, costCents: 18000 },
    { region: 'North', category: 'Software', product: 'Antivirus', rep: 'Dev', date: '2026-03-09', units: 6, amountCents: 23940, costCents: 4800 },
    { region: 'North', category: 'Services', product: 'Onboarding', rep: 'Dev', date: '2026-03-21', units: 3, amountCents: 450000, costCents: 120000 },
    { region: 'North', category: 'Services', product: 'Training', rep: 'Cleo', date: '2026-03-28', units: 2, amountCents: 300000, costCents: 80000 },

    { region: 'South', category: 'Hardware', product: 'Monitor', rep: 'Eve', date: '2026-01-11', units: 4, amountCents: 79600, costCents: 48000 },
    { region: 'South', category: 'Hardware', product: 'Keyboard', rep: 'Eve', date: '2026-02-08', units: 15, amountCents: 89850, costCents: 37500 },
    { region: 'South', category: 'Hardware', product: 'Laptop', rep: 'Finn', date: '2026-02-26', units: 2, amountCents: 239800, costCents: 160000 },
    { region: 'South', category: 'Software', product: 'Cloud Backup', rep: 'Finn', date: '2026-01-30', units: 20, amountCents: 119800, costCents: 30000 },
    { region: 'South', category: 'Software', product: 'IDE License', rep: 'Eve', date: '2026-03-04', units: 3, amountCents: 59700, costCents: 9000 },
    { region: 'South', category: 'Services', product: 'Support Plan', rep: 'Finn', date: '2026-03-18', units: 1, amountCents: 120000, costCents: 25000 },
    { region: 'South', category: 'Services', product: 'Training', rep: 'Eve', date: '2026-03-25', units: 1, amountCents: 150000, costCents: 40000 },
    { region: 'South', category: 'Services', product: 'Consulting', rep: 'Finn', date: '2026-03-31', units: 5, amountCents: 625000, costCents: 150000 },
  ],
};

const TICKETS = {
  name: 'Support Tickets',
  columns: [
    { name: 'team', label: 'Team', type: 'string' },
    { name: 'priority', label: 'Priority', type: 'string' },
    { name: 'agent', label: 'Agent', type: 'string' },
    { name: 'channel', label: 'Channel', type: 'string' },
    { name: 'opened', label: 'Opened', type: 'date' },
    { name: 'resolveMins', label: 'Resolve (min)', type: 'int' },
    { name: 'reopened', label: 'Reopened', type: 'int' },
  ],
  rows: [
    { team: 'Billing', priority: 'High', agent: 'Ivy', channel: 'Email', opened: '2026-01-04', resolveMins: 120, reopened: 0 },
    { team: 'Billing', priority: 'Low', agent: 'Ivy', channel: 'Chat', opened: '2026-01-12', resolveMins: 35, reopened: 0 },
    { team: 'Billing', priority: 'Urgent', agent: 'Jax', channel: 'Phone', opened: '2026-01-20', resolveMins: 45, reopened: 1 },
    { team: 'Billing', priority: 'Medium', agent: 'Jax', channel: 'Email', opened: '2026-02-02', resolveMins: 80, reopened: 0 },
    { team: 'Billing', priority: 'High', agent: 'Ivy', channel: 'Phone', opened: '2026-02-18', resolveMins: 150, reopened: 0 },
    { team: 'Technical', priority: 'Urgent', agent: 'Kim', channel: 'Phone', opened: '2026-01-06', resolveMins: 240, reopened: 2 },
    { team: 'Technical', priority: 'High', agent: 'Kim', channel: 'Chat', opened: '2026-01-15', resolveMins: 90, reopened: 0 },
    { team: 'Technical', priority: 'High', agent: 'Leo', channel: 'Email', opened: '2026-01-27', resolveMins: 200, reopened: 1 },
    { team: 'Technical', priority: 'Medium', agent: 'Leo', channel: 'Chat', opened: '2026-02-09', resolveMins: 60, reopened: 0 },
    { team: 'Technical', priority: 'Low', agent: 'Kim', channel: 'Email', opened: '2026-02-22', resolveMins: null, reopened: 0 },
    { team: 'Technical', priority: 'Urgent', agent: 'Leo', channel: 'Phone', opened: '2026-03-01', resolveMins: 300, reopened: 0 },
    { team: 'Onboarding', priority: 'Medium', agent: 'Mae', channel: 'Chat', opened: '2026-01-09', resolveMins: 55, reopened: 0 },
    { team: 'Onboarding', priority: 'Low', agent: 'Mae', channel: 'Email', opened: '2026-02-05', resolveMins: 40, reopened: 0 },
    { team: 'Onboarding', priority: 'High', agent: 'Mae', channel: 'Phone', opened: '2026-03-12', resolveMins: 110, reopened: 1 },
  ],
};

const DATASETS = { sales: SALES, tickets: TICKETS };

if (typeof module !== 'undefined' && module.exports) module.exports = { SALES, TICKETS, DATASETS };
if (typeof window !== 'undefined') window.ReportData = { SALES, TICKETS, DATASETS };
