import { carryDueDate, isBeforeDay, parseDateInput } from './date.util';

const ymd = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

describe('parseDateInput', () => {
  it('parses date-only and ISO strings', () => {
    expect(ymd(parseDateInput('2026-10-26'))).toBe('2026-10-26');
    expect(ymd(parseDateInput('2026-10-12T00:00:00.000Z'))).toBe('2026-10-12');
  });

  it('treats blank, null and garbage as "no date"', () => {
    expect(parseDateInput('')).toBeNull();
    expect(parseDateInput(null)).toBeNull();
    expect(parseDateInput(undefined)).toBeNull();
    expect(parseDateInput('not a date')).toBeNull();
  });
});

describe('isBeforeDay', () => {
  const issue = new Date('2026-10-12T15:30:00Z');

  it('compares calendar days, not timestamps', () => {
    // Same day, earlier clock time: not "before".
    expect(isBeforeDay(new Date('2026-10-12'), issue)).toBe(false);
    expect(isBeforeDay(new Date('2026-10-11'), issue)).toBe(true);
    expect(isBeforeDay(new Date('2026-10-13'), issue)).toBe(false);
  });
});

describe('carryDueDate', () => {
  it('keeps the payment term on the new issue date', () => {
    const due = carryDueDate(
      new Date('2026-10-12'),
      new Date('2026-10-26'),
      new Date('2026-11-01T09:00:00Z'),
    );
    expect(ymd(due)).toBe('2026-11-15');
  });

  it('crosses month and year boundaries', () => {
    const due = carryDueDate(
      new Date('2026-01-01'),
      new Date('2026-01-31'),
      new Date('2026-12-15'),
    );
    expect(ymd(due)).toBe('2027-01-14');
  });

  it('returns null when the source had no due date', () => {
    expect(carryDueDate(new Date('2026-10-12'), null, new Date())).toBeNull();
  });
});
