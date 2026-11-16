/**
 * Turns a pasted list (one topic per line) into topic drafts.
 * Strips bullets and numbering, drops empty lines and duplicates, and reads a trailing
 * time such as "(45 min)", "30 min", "1 uur" or "1,5 uur" as that topic's time.
 */
import type { Difficulty } from '../../types';

export interface ParsedTopic {
  title: string;
  /** Minutes found in the line, or undefined to use the default. */
  minutes?: number;
}

const BULLET = /^\s*(?:[-*•·–—+>]+|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s+/;
const TIME = /[\s,:;(–—-]*\(?\s*(\d+(?:[.,]\d+)?)\s*(min(?:uten|uut)?|m|uur|u|h)\s*\)?\s*$/i;

export function parseTopicLines(text: string): ParsedTopic[] {
  const seen = new Set<string>();
  const result: ParsedTopic[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(BULLET, '').trim();
    let minutes: number | undefined;
    const time = line.match(TIME);
    if (time && time.index !== undefined && time.index > 0) {
      const amount = Number(time[1].replace(',', '.'));
      const unit = time[2].toLowerCase();
      const value = unit.startsWith('m') ? amount : amount * 60;
      if (value > 0) minutes = Math.min(600, Math.max(5, Math.round(value / 5) * 5));
      line = line.slice(0, time.index).trim();
    }
    line = line.replace(/[\s,:;–—-]+$/, '').trim();
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ title: line, minutes });
  }
  return result;
}

/** Topic drafts ready for the store, using the defaults where a line had no time. */
export function toTopicDrafts(
  parsed: ParsedTopic[],
  defaults: { minutes: number; difficulty: Difficulty },
) {
  return parsed.map((p) => ({
    title: p.title,
    estMinutes: p.minutes ?? defaults.minutes,
    difficulty: defaults.difficulty,
    mastered: false,
  }));
}
