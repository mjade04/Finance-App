/** Raised when user input or a journal entry fails business validation. */
export class ValidationError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [String(errors)];
    super(list.join(' '));
    this.name = 'ValidationError';
    this.errors = list;
  }
}

/** Raised when a ledger operation is not permitted (e.g. double reversal). */
export class LedgerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LedgerError';
  }
}
