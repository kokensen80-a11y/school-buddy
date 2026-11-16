// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dateRange,
  diffDays,
  formatDateLong,
  formatDateShort,
  formatDuration,
  formatMonthYear,
  formatRelative,
  formatTime,
  isValidISODate,
  isValidTime,
  monthGrid,
  parseTime,
  startOfWeek,
  toDateTime,
  toISODate,
  weekDates,
  weekNumber,
  weekdayIndex,
} from './date';

describe('date arithmetic', () => {
  it('adds days across month, year and DST boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30'); // DST starts 29 March in NL
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26'); // DST ends 25 October in NL
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // leap year
    expect(addDays('2026-11-16', -16)).toBe('2026-10-31');
  });

  it('diffs days', () => {
    expect(diffDays('2026-11-16', '2026-11-16')).toBe(0);
    expect(diffDays('2026-11-16', '2026-11-23')).toBe(7);
    expect(diffDays('2026-11-23', '2026-11-16')).toBe(-7);
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('knows weekdays (0 = Monday)', () => {
    expect(weekdayIndex('2026-11-16')).toBe(0); // Monday
    expect(weekdayIndex('2026-11-22')).toBe(6); // Sunday
    expect(startOfWeek('2026-11-19')).toBe('2026-11-16');
    expect(weekDates('2026-11-22')).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
  });

  it('builds a month grid of full weeks', () => {
    const grid = monthGrid('2026-11-16');
    expect(grid[0][0]).toBe('2026-10-26');
    expect(grid.at(-1)!.at(-1)).toBe('2026-12-06');
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid.flat()).toContain('2026-11-01');
    expect(grid.flat()).toContain('2026-11-30');
  });

  it('adds months', () => {
    expect(addMonths('2026-11-16', 1)).toBe('2026-12-01');
    expect(addMonths('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
  });

  it('builds date ranges', () => {
    expect(dateRange('2026-11-29', '2026-12-01')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01']);
    expect(dateRange('2026-11-16', '2026-11-15')).toEqual([]);
  });

  it('computes ISO week numbers', () => {
    expect(weekNumber('2026-11-16')).toBe(47);
    expect(weekNumber('2026-01-01')).toBe(1);
    expect(weekNumber('2027-01-03')).toBe(53);
  });
});

describe('validation and conversion', () => {
  it('validates dates', () => {
    expect(isValidISODate('2026-11-16')).toBe(true);
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('16-11-2026')).toBe(false);
    expect(isValidISODate(undefined)).toBe(false);
  });

  it('validates and converts times', () => {
    expect(isValidTime('07:30')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(parseTime('07:30')).toBe(450);
    expect(formatTime(450)).toBe('07:30');
    expect(formatTime(2000)).toBe('23:59');
  });

  it('round-trips local dates', () => {
    const d = toDateTime('2026-11-16', '15:45');
    expect(toISODate(d)).toBe('2026-11-16');
    expect(d.getHours()).toBe(15);
    expect(d.getMinutes()).toBe(45);
  });
});

describe('Dutch formatting', () => {
  it('formats dates', () => {
    expect(formatDateLong('2026-11-16', '2026-11-01')).toBe('maandag 16 november');
    expect(formatDateLong('2027-01-04', '2026-11-01')).toBe('maandag 4 januari 2027');
    expect(formatDateShort('2026-11-16')).toBe('ma 16 nov');
    expect(formatMonthYear('2026-11-16')).toBe('november 2026');
  });

  it('formats relative days', () => {
    const today = '2026-11-16';
    expect(formatRelative('2026-11-16', today)).toBe('vandaag');
    expect(formatRelative('2026-11-17', today)).toBe('morgen');
    expect(formatRelative('2026-11-18', today)).toBe('overmorgen');
    expect(formatRelative('2026-11-21', today)).toBe('over 5 dagen');
    expect(formatRelative('2026-11-15', today)).toBe('gisteren');
    expect(formatRelative('2026-11-13', today)).toBe('3 dagen geleden');
  });

  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 uur');
    expect(formatDuration(90)).toBe('1 u 30 min');
    expect(formatDuration(120)).toBe('2 uur');
  });
});
