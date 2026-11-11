import { expect, it } from 'vitest';
import { levelChoices, levelMapping, levelName, selectionLevel } from './model-levels';
import { chooseModel } from '../mobile/native-home';
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
it('native Custom chooses an exact model and preserves cancellation', async () => {
  const replies=['__custom','__custom_id'];
  expect(await chooseModel(async()=>replies.shift()??null,'codex',[],'',async()=> 'gpt-special')).toBe('gpt-special');
  expect(await chooseModel(async()=>null,'codex',[],'')).toBeNull();
});
