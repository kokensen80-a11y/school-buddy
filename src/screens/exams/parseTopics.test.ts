// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseTopicLines } from './parseTopics';

describe('parseTopicLines', () => {
  it('strips bullets and numbering and skips empty lines', () => {
    const text = '- Hoofdstuk 1\n• Hoofdstuk 2\n\n1. Hoofdstuk 3\n2) Hoofdstuk 4\na) Bijlage\r\n* Begrippen';
    expect(parseTopicLines(text).map((t) => t.title)).toEqual([
      'Hoofdstuk 1',
      'Hoofdstuk 2',
      'Hoofdstuk 3',
      'Hoofdstuk 4',
      'Bijlage',
      'Begrippen',
    ]);
  });

  it('reads trailing times in several notations', () => {
    const parsed = parseTopicLines(
      'Hoofdstuk 3 (45 min)\n§2.1 - 30 min\nWoordjes 1 uur\nGrammatica 1,5 uur\nKaart 20m',
    );
    expect(parsed).toEqual([
      { title: 'Hoofdstuk 3', minutes: 45 },
      { title: '§2.1', minutes: 30 },
      { title: 'Woordjes', minutes: 60 },
      { title: 'Grammatica', minutes: 90 },
      { title: 'Kaart', minutes: 20 },
    ]);
  });

  it('keeps numbers that are part of the title', () => {
    expect(parseTopicLines('§2.1 t/m §2.4\nHoofdstuk 5')).toEqual([
      { title: '§2.1 t/m §2.4', minutes: undefined },
      { title: 'Hoofdstuk 5', minutes: undefined },
    ]);
  });

  it('drops duplicates, ignoring case', () => {
    expect(parseTopicLines('Celdeling\nceldeling\nMitose')).toHaveLength(2);
  });
});
