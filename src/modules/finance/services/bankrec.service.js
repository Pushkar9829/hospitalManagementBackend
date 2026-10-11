import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withTransaction } from '../../../core/db/model.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { Account, Journal } from '../models/finance.models.js';
import { BankStatementLine } from '../models/treasury.models.js';
import { ensureChart, post, todayIST } from './finance.service.js';

/**
 * Bank reconciliation (spec "Bank reconciliation"): import the bank statement, match each line
 * to the journal that put it in the books (automatically by amount and date, or by hand), book
 * what only the bank knows (charges, interest) and print the reconciliation statement.
 */

const POSTED = { status: { $in: ['POSTED', 'REVERSED'] } };
const DAY = 86_400_000;
const shift = (d, days) =>
  new Date(new Date(`${d}T12:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);
/** How far apart the bank's date and the books' date may be for an automatic match. */
export const MATCH_WINDOW_DAYS = 5;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

async function bankAccount(accountId) {
  await ensureChart();
  const a = accountId
    ? await Account.findById(accountId).lean()
    : await Account.findOne({ key: 'BANK' }).lean();
  if (!a) throw errors.notFound('Bank account');
  if (a.type !== 'ASSET')
    throw new AppError(422, 'NOT_A_BANK', `${a.name} is not a bank or cash account.`);
  return a;
}

const lineOut = (l) => ({
  id: String(l._id),
  date: l.date,
  description: l.description ?? '',
  ref: l.ref ?? '',
  amount: l.amount,
  balance: l.balance ?? null,
  status: l.status,
  journalId: l.journalId ? String(l.journalId) : null,
  matchedBy: l.matchedBy ?? null,
  note: l.note ?? null,
  version: l.version ?? 0,
});

/** The bank account's postings in the books: one row per journal, signed like the statement. */
async function bookEntries(account, { to, from } = {}) {
  const rows = await Journal.find({
    ...POSTED,
    'lines.accountId': account._id,
    ...(from || to
      ? { date: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } }
      : {}),
  })
    .sort({ date: 1, createdAt: 1 })
    .lean();
  return rows.map((j) => {
    const mine = j.lines.filter((l) => String(l.accountId) === String(account._id));
    return {
      journalId: String(j._id),
      voucherNo: j.voucherNo,
      date: j.date,
      narration: j.narration ?? '',
      amount: mine.reduce((t, l) => t + l.debit - l.credit, 0),
    };
  });
}

// ---------------------------------------------------------------- import

export const importInput = z.object({
  accountId: z.string().optional(),
  lines: z
    .array(
      z.object({
        date: ymd,
        description: z.string().trim().max(200).default(''),
        ref: z.string().trim().max(60).default(''),
        amount: z
          .number()
          .int()
          .refine((v) => v !== 0, 'An amount cannot be zero'),
        balance: z.number().int().optional(),
      }),
    )
    .min(1)
    .max(2000),
});

/**
 * Imports statement lines (the screen turns the bank's CSV into deposits and withdrawals). A line
 * already imported (same date, amount and reference or description) is skipped, so a statement
 * can be loaded again with overlapping dates. Matches automatically afterwards.
 */
export async function importStatement({ accountId, lines }) {
  const account = await bankAccount(accountId);
  const batch = randomUUID();
  let added = 0;
  let skipped = 0;
  for (const l of lines) {
    const dup = await BankStatementLine.exists({
      accountId: account._id,
      date: l.date,
      amount: l.amount,
      ...(l.ref ? { ref: l.ref } : { description: l.description }),
    });
    if (dup) {
      skipped += 1;
      continue;
    }
    await BankStatementLine.create([{ ...l, accountId: account._id, batch }]);
    added += 1;
  }
  const auto = await autoMatch({ accountId: String(account._id) });
  return { added, skipped, matched: auto.matched };
}

// ---------------------------------------------------------------- matching

async function matchedJournalIds(account) {
  const rows = await BankStatementLine.find({ accountId: account._id, journalId: { $ne: null } })
    .select('journalId')
    .lean();
  return new Set(rows.map((r) => String(r.journalId)));
}

/**
 * Matches unmatched statement lines to book entries of the same amount within the date window.
 * Only a line with exactly one candidate (and a candidate wanted by exactly one line) matches; the
 * rest are left for a person.
 */
export async function autoMatch({ accountId } = {}) {
  const account = await bankAccount(accountId);
  const open = await BankStatementLine.find({ accountId: account._id, status: 'UNMATCHED' })
    .sort({ date: 1 })
    .lean();
  if (!open.length) return { matched: 0 };
  const taken = await matchedJournalIds(account);
  const from = shift(open[0].date, -MATCH_WINDOW_DAYS);
  const to = shift(open.at(-1).date, MATCH_WINDOW_DAYS);
  const books = (await bookEntries(account, { from, to })).filter((b) => !taken.has(b.journalId));
  const candidates = new Map(
    open.map((l) => [
      String(l._id),
      books.filter(
        (b) =>
          b.amount === l.amount &&
          b.date >= shift(l.date, -MATCH_WINDOW_DAYS) &&
          b.date <= shift(l.date, MATCH_WINDOW_DAYS),
      ),
    ]),
  );
  const wanted = new Map();
  for (const list of candidates.values())
    for (const b of list) wanted.set(b.journalId, (wanted.get(b.journalId) ?? 0) + 1);
  let matched = 0;
  for (const l of open) {
    const list = candidates.get(String(l._id));
    if (list.length !== 1 || wanted.get(list[0].journalId) !== 1) continue;
    await BankStatementLine.updateOne(
      { _id: l._id, status: 'UNMATCHED' },
      { $set: { status: 'MATCHED', journalId: list[0].journalId, matchedBy: 'AUTO' } },
    );
    matched += 1;
  }
  return { matched };
}

async function findLine(id) {
  const l = await BankStatementLine.findById(id);
  if (!l) throw errors.notFound('Statement line');
  return l;
}

export const matchInput = z.object({
  journalId: z.string(),
  version: z.number().int().min(0),
});

/** Matches a line by hand to a book entry of the same amount and direction. */
export async function matchLine(id, { journalId, version }) {
  const l = await findLine(id);
  if (l.version !== version) throw errors.versionConflict();
  if (l.status !== 'UNMATCHED')
    throw new AppError(409, 'INVALID_STATE', 'Unmatch or restore the line first.');
  const account = await bankAccount(String(l.accountId));
  const entry = (await bookEntries(account, {})).find((b) => b.journalId === journalId);
  if (!entry) throw errors.notFound('Book entry for this bank account');
  if (entry.amount !== l.amount)
    throw new AppError(
      422,
      'AMOUNT_MISMATCH',
      'The book entry is for a different amount. Book the difference (for example bank charges) first.',
    );
  if (await BankStatementLine.exists({ accountId: l.accountId, journalId }))
    throw new AppError(409, 'ALREADY_MATCHED', 'That book entry is matched to another line.');
  l.set({ status: 'MATCHED', journalId, matchedBy: 'MANUAL' });
  await l.save();
  return lineOut(l.toObject());
}

export const versionInput = z.object({ version: z.number().int().min(0) });

export async function unmatchLine(id, { version }) {
  const l = await findLine(id);
  if (l.version !== version) throw errors.versionConflict();
  l.set({ status: 'UNMATCHED', journalId: undefined, matchedBy: undefined, note: undefined });
  await l.save();
  return lineOut(l.toObject());
}

export const ignoreInput = z.object({
  version: z.number().int().min(0),
  note: z.string().trim().min(3).max(200),
});

/** A line that needs no entry (for example a reversal the bank made and undid the same day). */
export async function ignoreLine(id, { version, note }) {
  const l = await findLine(id);
  if (l.version !== version) throw errors.versionConflict();
  if (l.status !== 'UNMATCHED') throw new AppError(409, 'INVALID_STATE', 'Only an open line.');
  l.set({ status: 'IGNORED', note });
  await l.save();
  return lineOut(l.toObject());
}

export const bookInput = z.object({
  version: z.number().int().min(0),
  accountId: z.string(),
  narration: z.string().trim().min(3).max(200),
});

/**
 * Books what only the bank knows (charges, interest, a direct debit) against an account and
 * matches the line to the new journal: a withdrawal debits that account, a deposit credits it.
 */
export async function bookLine(id, { version, accountId, narration }) {
  const l = await findLine(id);
  if (l.version !== version) throw errors.versionConflict();
  if (l.status !== 'UNMATCHED') throw new AppError(409, 'INVALID_STATE', 'Only an open line.');
  const other = await Account.findById(accountId).lean();
  if (!other || other.isActive === false) throw errors.notFound('Account');
  if (String(other._id) === String(l.accountId))
    throw new AppError(422, 'SAME_ACCOUNT', 'Pick the other side of the entry.');
  return withTransaction(async () => {
    const amount = Math.abs(l.amount);
    const deposit = l.amount > 0;
    const j = await post({
      type: deposit ? 'RECEIPT' : 'PAYMENT',
      date: l.date,
      narration,
      source: { kind: 'BANK_STATEMENT', ref: String(l._id) },
      lines: deposit
        ? [
            { accountId: l.accountId, debit: amount },
            { accountId: other._id, credit: amount },
          ]
        : [
            { accountId: other._id, debit: amount },
            { accountId: l.accountId, credit: amount },
          ],
    });
    l.set({ status: 'MATCHED', journalId: j._id, matchedBy: 'CREATED' });
    await l.save();
    return { ...lineOut(l.toObject()), voucherNo: j.voucherNo };
  });
}

// ---------------------------------------------------------------- the reconciliation

export const recQuery = z.object({ accountId: z.string().optional(), asOf: ymd.optional() });

/**
 * The bank reconciliation statement as of a date: balance per books, entries in the books the
 * bank has not shown yet (cheques not presented, deposits not credited), entries in the bank not
 * in the books yet, and the balance per bank it all adds up to, against the statement's own.
 */
export async function reconciliation({ accountId, asOf = todayIST() } = {}) {
  const account = await bankAccount(accountId);
  const books = await bookEntries(account, { to: asOf });
  const statement = await BankStatementLine.find({ accountId: account._id, date: { $lte: asOf } })
    .sort({ date: 1, createdAt: 1 })
    .lean();
  const matched = new Set(
    (
      await BankStatementLine.find({
        accountId: account._id,
        journalId: { $ne: null },
        date: { $lte: asOf },
      })
        .select('journalId')
        .lean()
    ).map((r) => String(r.journalId)),
  );
  const bookBalance = books.reduce((t, b) => t + b.amount, 0);
  const notInBank = books.filter((b) => !matched.has(b.journalId));
  const notInBooks = statement.filter((l) => l.status === 'UNMATCHED');
  // Books + what the bank has that the books do not − what the books have that the bank does not.
  const computedBank =
    bookBalance +
    notInBooks.reduce((t, l) => t + l.amount, 0) -
    notInBank.reduce((t, b) => t + b.amount, 0);
  const lastWithBalance = [...statement].reverse().find((l) => l.balance != null);
  const statementBalance = lastWithBalance?.balance ?? null;
  return {
    account: { id: String(account._id), code: account.code, name: account.name },
    asOf,
    bookBalance,
    chequesNotPresented: notInBank
      .filter((b) => b.amount < 0)
      .map((b) => ({ ...b, amount: -b.amount })),
    depositsNotCredited: notInBank.filter((b) => b.amount > 0),
    bankOnly: notInBooks.map(lineOut),
    computedBankBalance: computedBank,
    statementBalance,
    statementBalanceOn: lastWithBalance?.date ?? null,
    // Only meaningful when the statement printed a running balance on its last line.
    difference: statementBalance == null ? null : statementBalance - computedBank,
    counts: {
      lines: statement.length,
      matched: statement.filter((l) => l.status === 'MATCHED').length,
      ignored: statement.filter((l) => l.status === 'IGNORED').length,
      open: notInBooks.length,
    },
  };
}

export const linesQuery = z.object({
  accountId: z.string().optional(),
  status: z.enum(['UNMATCHED', 'MATCHED', 'IGNORED']).optional(),
  from: ymd.optional(),
  to: ymd.optional(),
});

/** Statement lines, with the book entries an open line could be matched to. */
export async function statementLines({ accountId, status, from, to } = {}) {
  const account = await bankAccount(accountId);
  const rows = await BankStatementLine.find({
    accountId: account._id,
    ...(status ? { status } : {}),
    ...(from || to
      ? { date: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } }
      : {}),
  })
    .sort({ date: -1, createdAt: -1 })
    .limit(500)
    .lean();
  const taken = await matchedJournalIds(account);
  const open = rows.filter((r) => r.status === 'UNMATCHED');
  let books = [];
  if (open.length) {
    const dates = open.map((r) => r.date).sort();
    books = (
      await bookEntries(account, { from: shift(dates[0], -30), to: shift(dates.at(-1), 30) })
    ).filter((b) => !taken.has(b.journalId));
  }
  const voucher = new Map();
  const ids = rows.filter((r) => r.journalId).map((r) => r.journalId);
  if (ids.length)
    for (const j of await Journal.find({ _id: { $in: ids } })
      .select('voucherNo')
      .lean())
      voucher.set(String(j._id), j.voucherNo);
  return {
    account: { id: String(account._id), code: account.code, name: account.name },
    items: rows.map((r) => ({
      ...lineOut(r),
      voucherNo: r.journalId ? (voucher.get(String(r.journalId)) ?? null) : null,
      candidates:
        r.status === 'UNMATCHED'
          ? books
              .filter((b) => Math.sign(b.amount) === Math.sign(r.amount))
              .sort((a, b) => Math.abs(a.amount - r.amount) - Math.abs(b.amount - r.amount))
              .slice(0, 20)
          : undefined,
    })),
  };
}
