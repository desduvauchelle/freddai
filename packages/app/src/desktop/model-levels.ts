export const levels = ['smart', 'normal', 'fast'] as const;
export type Level = typeof levels[number];
export type LevelMapping = { family: string; effort: string };
export type ModelConfiguration = Record<string, Partial<Record<Level, LevelMapping>>>;
export const levelLabel = (level: string) => level[0].toUpperCase() + level.slice(1);
export const isLevel = (model: string) => model.startsWith('freddai-level:');
export function levelMapping(provider: string, level: Level, configuration: ModelConfiguration = {}): LevelMapping {
  const families = provider === 'codex' ? { smart: 'astra', normal: 'sol', fast: 'luna' }
    : provider === 'claude' ? { smart: 'fable', normal: 'opus', fast: 'sonnet' } : { smart: '', normal: '', fast: '' };
  return configuration[provider]?.[level] ?? { family: families[level], effort: provider === 'codex' && level !== 'fast' ? 'medium' : 'default' };
}
/** Stable level identity. The host resolves the centrally saved mapping at execution time. */
export const levelValue = (_provider: string | undefined, level: Level) => `freddai-level:${level}`;
export const selectionLevel = (model: string): Level | 'custom' => !model ? 'normal' : isLevel(model) && levels.includes(model.split(':')[1] as Level) ? model.split(':')[1] as Level : 'custom';
export const levelName = (model: string) => levelLabel(selectionLevel(model));
export const levelChoices = (provider?: string) => levels.map(level => ({ value: levelValue(provider, level), label: levelLabel(level) }));
