import { expect, it } from 'vitest';
import { levelChoices, levelMapping, levelName, selectionLevel } from './model-levels';
import { chooseSelection } from '../mobile/native-home';
it('uses stable level identities on every provider and recognizes legacy mappings', () => {
  expect(levelChoices('codex').map(c => c.value)).toEqual(['freddai-level:smart','freddai-level:normal','freddai-level:fast']);
  expect(levelName('')).toBe('Normal'); expect(selectionLevel('gpt-x')).toBe('custom');
  expect(levelName('freddai-level:smart:astra:medium')).toBe('Smart');
  expect(levelChoices('gemini')).toHaveLength(3);
});
it('reads centralized mappings rather than device-local preferences', () => {
  expect(levelMapping('codex','smart')).toEqual({ family:'astra',effort:'medium' });
  expect(levelMapping('claude','normal')).toEqual({ family:'opus',effort:'default' });
  expect(levelMapping('codex','smart',{ codex:{smart:{family:'sol',effort:'high'}} })).toEqual({family:'sol',effort:'high'});
});
it('native Custom picks a listed model and cancellation stays cancelled', async () => {
  const replies = ['__custom', 'gpt-special'];
  expect(await chooseSelection(async () => replies.shift() ?? null, 'codex', [{ model: 'gpt-special', displayName: 'GPT Special', isDefault: true, supportedReasoningEfforts: [] }] as never, { model: '', effort: 'default' })).toEqual({ model: 'gpt-special', effort: 'default' });
  expect(await chooseSelection(async () => null, 'codex', [], { model: '', effort: 'default' })).toBeNull();
});
