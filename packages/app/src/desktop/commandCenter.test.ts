import { describe, expect, it } from 'vitest';
import { commandCenterReducer, parseCommandIntent, resolveProjectFromUtterance, stripWakeWord, type CommandState } from './commandCenter';

const projects = [{ id: 'p1', name: 'Recursive' }, { id: 'p2', name: 'Recursive Engine' }, { id: 'p3', name: 'HCCI' }];
const step = (state: CommandState, text: string) => commandCenterReducer(state, { type: 'segment', text }, projects);

describe('stripWakeWord', () => {
  it.each([
    ['Freddie, in Recursive, do x', 'in Recursive, do x'], ['hey freddy: do x', 'do x'], ['Okay Freddi do x', 'do x'],
    ["Freddie's do x", 'do x'], ['Hey Freddy, in X do Y', 'in X do Y'], ['FREDDIE.', ''],
  ])('%s', (input, out) => expect(stripWakeWord(input)).toBe(out));
  it.each(['do x', 'Fred said hi', 'fred, do x', 'Frederick, do x', 'say Freddie hello', ''])('rejects %s', input => expect(stripWakeWord(input)).toBeNull());
});

describe('parseCommandIntent', () => {
  it.each(['go', 'Send it.', 'do it', 'Go ahead!', 'send'])('go: %s', t => expect(parseCommandIntent(t)).toEqual({ kind: 'go' }));
  it.each(['cancel', 'Never mind.', 'nevermind', 'scrap that', 'Forget it'])('cancel: %s', t => expect(parseCommandIntent(t)).toEqual({ kind: 'cancel' }));
  it('keeps other text', () => expect(parseCommandIntent(' go to the store ')).toEqual({ kind: 'text', text: 'go to the store' }));
});

describe('resolveProjectFromUtterance', () => {
  it('strips an "in X," prefix', () => expect(resolveProjectFromUtterance('in HCCI, add a retry', projects)).toEqual({ project: projects[2], instruction: 'add a retry' }));
  it('strips "X:"', () => expect(resolveProjectFromUtterance('hcci: add a retry', projects)?.instruction).toBe('add a retry'));
  it('keeps a mid-sentence name', () => expect(resolveProjectFromUtterance('add a retry to the HCCI uploader', projects)).toEqual({ project: projects[2], instruction: 'add a retry to the HCCI uploader' }));
  it('prefers the longest name', () => expect(resolveProjectFromUtterance('for Recursive Engine, fix it', projects)).toEqual({ project: projects[1], instruction: 'fix it' }));
  it('returns null without a match or instruction', () => {
    expect(resolveProjectFromUtterance('add a retry', projects)).toBeNull();
    expect(resolveProjectFromUtterance('in HCCI', projects)).toBeNull();
  });
});

describe('commandCenterReducer', () => {
  it('ignores speech without the wake word', () => expect(step({ kind: 'idle' }, 'add a retry in HCCI')).toEqual({ state: { kind: 'idle' }, effects: [{ type: 'none' }] }));
  it('opens review for wake word plus project', () => expect(step({ kind: 'idle' }, 'Freddie, in HCCI, add a retry').state).toEqual({ kind: 'reviewing', draft: { projectId: 'p3', instruction: 'add a retry' } }));
  it('asks which project, then resolves without a wake word', () => {
    const asked = step({ kind: 'idle' }, 'Freddie, add a retry');
    expect(asked.state).toEqual({ kind: 'awaitingProject', instruction: 'add a retry', misses: 0 });
    expect(asked.effects).toEqual([{ type: 'speak', text: 'Which project?' }]);
    expect(step(asked.state, 'HCCI').state).toEqual({ kind: 'reviewing', draft: { projectId: 'p3', instruction: 'add a retry' } });
    expect(step(asked.state, 'banana').state.kind).toBe('awaitingProject');
    expect(step(asked.state, 'cancel').state).toEqual({ kind: 'idle' });
  });
  it('first miss stays awaiting and speaks; second miss drops to idle', () => {
    const asked = step({ kind: 'idle' }, 'Freddie, add a retry');
    const miss1 = step(asked.state, 'banana');
    expect(miss1.state).toEqual({ kind: 'awaitingProject', instruction: 'add a retry', misses: 1 });
    expect(miss1.effects).toEqual([{ type: 'speak', text: 'I did not catch a project. Which project?' }]);
    const miss2 = step(miss1.state, 'still nothing');
    expect(miss2.state).toEqual({ kind: 'idle' });
    expect(miss2.effects).toEqual([{ type: 'speak', text: 'Never mind.' }]);
  });
  it('a project name on the second try still opens the card', () => {
    const miss1 = step(step({ kind: 'idle' }, 'Freddie, add a retry').state, 'banana');
    expect(step(miss1.state, 'HCCI').state).toEqual({ kind: 'reviewing', draft: { projectId: 'p3', instruction: 'add a retry' } });
  });
  const reviewing: CommandState = { kind: 'reviewing', draft: { projectId: 'p3', instruction: 'add a retry' } };
  it('go launches, cancel dismisses', () => {
    expect(step(reviewing, 'go').effects).toEqual([{ type: 'launch' }]);
    expect(step(reviewing, 'cancel').state).toEqual({ kind: 'idle' });
  });
  it('replaces or appends the instruction', () => {
    expect(step(reviewing, 'make it exponential').state).toEqual({ kind: 'reviewing', draft: { projectId: 'p3', instruction: 'make it exponential' } });
    expect(step(reviewing, 'and add logging').state).toEqual({ kind: 'reviewing', draft: { projectId: 'p3', instruction: 'add a retry add logging' } });
  });
  it('edit, dismiss and launched events', () => {
    expect(commandCenterReducer(reviewing, { type: 'edit', text: 'x' }, projects).state).toEqual({ kind: 'reviewing', draft: { projectId: 'p3', instruction: 'x' } });
    expect(commandCenterReducer(reviewing, { type: 'launched' }, projects).state).toEqual({ kind: 'idle' });
    expect(commandCenterReducer(reviewing, { type: 'dismiss' }, projects).state).toEqual({ kind: 'idle' });
  });
});
