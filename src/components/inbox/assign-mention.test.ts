import { describe, expect, it } from 'vitest';
import {
  assignQuery,
  buildAssignCandidates,
  filterAssignCandidates,
  type AssignCandidate,
} from './assign-mention';

const LABELS = {
  takeIt: 'Assumir',
  unassign: 'Deixar sem responsável',
  unnamed: 'Sem nome',
};

const PROFILES = [
  { user_id: 'u1', full_name: 'Thales' },
  { user_id: 'u2', full_name: 'Ana Paula' },
  { user_id: 'u3', full_name: 'Joana' },
  { user_id: 'u4', full_name: '   ' },
];

describe('assignQuery', () => {
  it('opens on a leading @ and returns what follows', () => {
    expect(assignQuery('@')).toBe('');
    expect(assignQuery('@an')).toBe('an');
  });

  it('stays closed when @ is not the first character', () => {
    // Mid-sentence an @ is an email address or something the customer wrote.
    for (const text of ['oi @ana', 'cliente@exemplo.com', ' @ana']) {
      expect(assignQuery(text), text).toBeNull();
    }
  });

  it('closes once a space is typed', () => {
    // `@ana ` is somebody who moved on to writing a message.
    expect(assignQuery('@ana ')).toBeNull();
    expect(assignQuery('@ana pode')).toBeNull();
  });

  it('stays closed for ordinary text', () => {
    expect(assignQuery('')).toBeNull();
    expect(assignQuery('bom dia')).toBeNull();
  });
});

describe('filterAssignCandidates', () => {
  const candidates: AssignCandidate[] = [
    { userId: 'u2', label: 'Ana Paula' },
    { userId: 'u3', label: 'Joana' },
    { userId: 'u1', label: 'Thales' },
  ];

  it('matches on word prefix, not loose substring', () => {
    // "Joana" contains "an" — matching it would be the noise that makes
    // people stop trusting the list.
    expect(
      filterAssignCandidates(candidates, 'an').map((c) => c.label)
    ).toEqual(['Ana Paula']);
  });

  it('matches any word, not just the first', () => {
    expect(
      filterAssignCandidates(candidates, 'pau').map((c) => c.label)
    ).toEqual(['Ana Paula']);
  });

  it('is case-insensitive', () => {
    expect(filterAssignCandidates(candidates, 'THA')).toHaveLength(1);
  });

  it('returns everything for an empty query', () => {
    expect(filterAssignCandidates(candidates, '')).toHaveLength(3);
    expect(filterAssignCandidates(candidates, '  ')).toHaveLength(3);
  });
});

describe('buildAssignCandidates', () => {
  it('puts taking it first and unassigning last', () => {
    const out = buildAssignCandidates(PROFILES, 'u1', LABELS, 'u2');
    expect(out[0]).toMatchObject({ userId: 'u1', isSelf: true });
    expect(out[out.length - 1]).toMatchObject({
      userId: null,
      isUnassign: true,
    });
  });

  it("omits 'take it' when you already own the thread", () => {
    const out = buildAssignCandidates(PROFILES, 'u1', LABELS, 'u1');
    expect(out.some((c) => c.isSelf)).toBe(false);
  });

  it("omits 'unassign' when nobody owns it", () => {
    // There is nothing to return to the queue.
    const out = buildAssignCandidates(PROFILES, 'u1', LABELS, null);
    expect(out.some((c) => c.isUnassign)).toBe(false);
  });

  it('never lists the signed-in user twice', () => {
    const out = buildAssignCandidates(PROFILES, 'u1', LABELS, 'u2');
    expect(out.filter((c) => c.userId === 'u1')).toHaveLength(1);
  });

  it('falls back to a label for a profile with no name', () => {
    const out = buildAssignCandidates(PROFILES, null, LABELS, null);
    expect(out.find((c) => c.userId === 'u4')?.label).toBe(LABELS.unnamed);
  });

  it('works with nobody signed in', () => {
    const out = buildAssignCandidates(PROFILES, null, LABELS, null);
    expect(out.map((c) => c.userId)).toEqual(['u1', 'u2', 'u3', 'u4']);
  });
});
