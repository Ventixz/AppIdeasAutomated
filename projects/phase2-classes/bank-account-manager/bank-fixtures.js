/*
 * bank-fixtures.js — a sample bank shared by all three front ends (the CLI, the
 * browser demo, and the tests). Building it here, once, keeps the demo data in
 * one place and proves the classes compose the way the ATM screens assume.
 *
 * The sample deliberately exercises each account's distinguishing rule:
 *   - a Checking account with an overdraft line and fee
 *   - a Savings account with interest and a withdrawal cap, already part-used
 *   - a Business account with a per-transaction fee and a large overdraft line
 */
'use strict';

function buildBank(core) {
  const { Bank, CheckingAccount, SavingsAccount, BusinessAccount } = core;
  const bank = new Bank('Riverside Community Bank');

  // Checking: $1,000 opening, may overdraw $200, $35 fee when it dips negative.
  const checking = new CheckingAccount('Ada Lovelace', {
    id: 'A-0001',
    openingBalance: '1000',
    overdraftLimit: '200',
    overdraftFee: '35',
  });

  // Savings: $5,000 opening, 1.5%/yr, 6 withdrawals per cycle; one already made.
  const savings = new SavingsAccount('Grace Hopper', {
    id: 'A-0002',
    openingBalance: '5000',
    annualInterestPercent: 1.5,
    withdrawalLimit: 6,
  });
  savings.withdraw('200', 'ATM cash');

  // Business: $12,500 opening, $0.25 per transaction, $2,000 overdraft line.
  const business = new BusinessAccount('Hopper Robotics LLC', {
    id: 'A-0003',
    openingBalance: '12500',
    transactionFee: '0.25',
    overdraftLimit: '2000',
  });
  business.withdraw('3400.50', 'supplier invoice #142');

  bank.open(checking);
  bank.open(savings);
  bank.open(business);
  return bank;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { buildBank };
if (typeof window !== 'undefined') window.BankFixtures = { buildBank };
