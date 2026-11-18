import { describe, expect, it } from 'vitest';
import { scanExamText } from './examScan';

const today = '2026-11-18';
const subjects = [
  { id: 's-bio', name: 'Biologie' },
  { id: 's-wib', name: 'Wiskunde B' },
];

describe('scanExamText', () => {
  it('reads a Magister style screenshot', () => {
    const text = `09:41
Toets
Biologie H4 en 5
Datum: donderdag 26 november 2026
Tijd: 10:15 - 11:05
Lokaal: B204`;
    const [r] = scanExamText(text, { today, subjects });
    expect(r).toMatchObject({
      date: '2026-11-26',
      time: '10:15',
      endTime: '11:05',
      location: 'B204',
      subjectId: 's-bio',
      kind: 'toets',
      title: 'Hoofdstuk 4 en 5',
      topics: ['Hoofdstuk 4', 'Hoofdstuk 5'],
    });
  });

  it('reads weight, a material list and remarks', () => {
    const text = `Proefwerk Geschiedenis
Datum: 3 december
Weging: 3
Leerstof:
H2 t/m 4
§5.1 en 5.2
Begrippenlijst, tijdlijn
Let op: rekenmachine niet toegestaan`;
    const [r] = scanExamText(text, { today, subjects });
    expect(r.weight).toBe(3);
    expect(r.topics).toEqual(['Hoofdstuk 2', 'Hoofdstuk 3', 'Hoofdstuk 4', '§5.1 en 5.2', 'Begrippenlijst', 'Tijdlijn']);
    expect(r.notes).toEqual(['Rekenmachine niet toegestaan']);
    expect(scanExamText('Toets Engels 3/12 telt 2x', { today, subjects })[0].weight).toBe(2);
    expect(scanExamText('Toets Engels 3/12 weging 20%', { today, subjects })[0].weight).toBeUndefined();
  });

  it('reads a note with a written month and no year', () => {
    const [r] = scanExamText('SO aardrijkskunde op di 2 dec om 9 uur in de aula', { today, subjects });
    expect(r).toMatchObject({ date: '2026-12-02', time: '09:00', location: 'Aula', subjectName: 'Aardrijkskunde', kind: 'so' });
  });

  it('rolls a date without year that already passed into next year', () => {
    const [r] = scanExamText('Proefwerk Engels 14-01', { today, subjects });
    expect(r.date).toBe('2027-01-14');
    expect(r.subjectName).toBe('Engels');
  });

  it('matches OCR typos and subject codes to own subjects', () => {
    expect(scanExamText('Biolgie toets 3/12', { today, subjects })[0].subjectId).toBe('s-bio');
    expect(scanExamText('ma 30-11 WISB 2e uur', { today, subjects })[0].subjectId).toBe('s-wib');
  });

  it('finds the subject from school codes, a label or the word after the kind', () => {
    const one = (t: string) => scanExamText(t, { today, subjects })[0];
    expect(one('bi - Toets H4\n4 december').subjectId).toBe('s-bio');
    expect(one('netl: SO woordjes 4 dec').subjectName).toBe('Nederlands');
    expect(one('Vak: Kunstgeschiedenis\nDatum: 4 december').subjectName).toBe('Kunstgeschiedenis');
    expect(one('Toets Robotica op 4 december').subjectName).toBe('Robotica');
    expect(one('Toets Hoofdstuk 3 op 4/12').subjectName).toBeUndefined();
    expect(one('Info\nToets 4/12').subjectName).toBeUndefined();
  });

  it('does not take paragraph numbers or times for dates', () => {
    const [r] = scanExamText('Leren §4.1 en §4.2\nToets 9.30 uur', { today, subjects });
    expect(r.date).toBeUndefined();
    expect(r.time).toBe('09:30');
  });

  it('splits a toetsrooster into one result per date', () => {
    const text = `Toetsweek 2
ma 7 december  Nederlands  08:30-10:00  A1.12
di 8 december  Biologie  10:30-11:30  B2.04
wo 9 december  Wiskunde B  08:30-10:30  Aula`;
    const results = scanExamText(text, { today, subjects });
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.date)).toEqual(['2026-12-07', '2026-12-08', '2026-12-09']);
    expect(results[0]).toMatchObject({ subjectName: 'Nederlands', time: '08:30', location: 'A1.12' });
    expect(results[1]).toMatchObject({ subjectId: 's-bio', time: '10:30', location: 'B2.04' });
    expect(results[2]).toMatchObject({ subjectId: 's-wib', location: 'Aula' });
  });

  it('returns nothing for text without exam details', () => {
    expect(scanExamText('', { today, subjects })).toEqual([]);
    expect(scanExamText('Hallo hoe gaat het', { today, subjects })).toEqual([]);
  });
});
