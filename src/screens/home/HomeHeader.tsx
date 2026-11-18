import { parseTime } from '../../lib/date';

/** "goedemorgen", "goedemiddag", "goedenavond" or "goedenacht". */
export function greeting(nowMinutes: number): string {
  if (nowMinutes < parseTime('06:00')) return 'goedenacht';
  if (nowMinutes < parseTime('12:00')) return 'goedemorgen';
  if (nowMinutes < parseTime('18:00')) return 'goedemiddag';
  return 'goedenavond';
}
