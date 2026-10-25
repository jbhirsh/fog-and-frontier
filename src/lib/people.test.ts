import { describe, expect, it } from 'vitest';
import { namesByEmail, personLabel } from './people';

describe('namesByEmail', () => {
  it('maps each lowercased email to its first name, skipping blank or missing ones', () => {
    const names = namesByEmail([
      { email: ' Jessicabhirsh@Gmail.com ', displayName: ' Jessica ' },
      { email: 'tarunkhubchandani@example.com', displayName: 'Tarun' },
      { email: 'blank@example.com', displayName: '   ' },
      { email: 'none@example.com', displayName: null },
      { email: 'absent@example.com' },
    ]);
    expect([...names]).toEqual([
      ['jessicabhirsh@gmail.com', 'Jessica'],
      ['tarunkhubchandani@example.com', 'Tarun'],
    ]);
  });
});

describe('namesByEmail: a shared first name', () => {
  it('names neither of two accounts called the same, so they stay apart', () => {
    const names = namesByEmail([
      { email: 'tarun.k@example.com', displayName: 'Tarun' },
      { email: 'tarun.s@example.com', displayName: 'Tarun' },
      { email: 'jess@example.com', displayName: 'Jessica' },
    ]);
    expect([...names]).toEqual([['jess@example.com', 'Jessica']]);
    expect(personLabel('tarun.k@example.com', names)).toBe('Tarun K');
  });
});

describe('personLabel', () => {
  const names = namesByEmail([{ email: 'tarunkhubchandani@example.com', displayName: 'Tarun' }]);

  it('names someone by their first name, whatever the email’s case', () => {
    expect(personLabel('TarunKhubchandani@Example.com ', names)).toBe('Tarun');
  });

  it('falls back to the name their email gives', () => {
    expect(personLabel('jess.hirsh@example.com', names)).toBe('Jess Hirsh');
    expect(personLabel('tarunkhubchandani@other.com', new Map())).toBe('Tarunkhubchandani');
  });
});
