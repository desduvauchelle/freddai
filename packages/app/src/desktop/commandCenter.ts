/** Dashboard command center: wake word gating, project resolution and the review-card state machine. Pure and framework-free. */

export type CommandProject = { id: string; name: string };
export type CommandIntent = { kind: "go" } | { kind: "cancel" } | { kind: "text"; text: string };
export type CommandDraft = { projectId: string; instruction: string };
export type CommandState =
  | { kind: "idle" }
  | { kind: "awaitingProject"; instruction: string; misses: number }
  | { kind: "reviewing"; draft: CommandDraft };
export type CommandEvent = { type: "segment"; text: string } | { type: "edit"; text: string } | { type: "dismiss" } | { type: "launched" };
export type CommandEffect = { type: "speak"; text: string } | { type: "launch" } | { type: "none" };

export const WAKE_WORD = "Freddie";
const WAKE = /^\s*(?:(?:hey|ok|okay)[\s,]+)?(?:freddie's|freddie|freddy|freddi|freddai)(?![\p{L}\p{N}])[\s,:;.!?-]*/iu;

/** Returns the utterance after the wake word, or null when it does not start with one. */
export function stripWakeWord(text: string): string | null {
  const match = WAKE.exec(text);
  return match ? text.slice(match[0].length).trim() : null;
}

const GO = new Set(["go", "send", "send it", "do it", "go ahead"]);
const CANCEL = new Set(["cancel", "never mind", "nevermind", "scrap that", "forget it"]);
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();

export function parseCommandIntent(text: string): CommandIntent {
  const n = normalize(text);
  if (GO.has(n)) return { kind: "go" };
  if (CANCEL.has(n)) return { kind: "cancel" };
  return { kind: "text", text: text.trim() };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function nameRegex(name: string): RegExp | null {
  const tokens = name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!tokens.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${tokens.map(escape).join("[^\\p{L}\\p{N}]+")}(?![\\p{L}\\p{N}])`, "iu");
}

/** Finds the project named in the utterance (longest name wins). `instruction` may be empty. */
export function matchProject(text: string, projects: CommandProject[]): { project: CommandProject; instruction: string } | null {
  let best: { project: CommandProject; match: RegExpExecArray; len: number } | null = null;
  for (const project of projects) {
    const re = nameRegex(project.name);
    const match = re?.exec(text);
    if (!match) continue;
    const len = project.name.length;
    if (!best || len > best.len) best = { project, match, len };
  }
  // Whisper commonly spells the app/project name like the spoken wake word.
  // Resolve literal project names first so a real project named Freddy wins.
  if (!best) {
    const freddai = projects.filter(project => project.name.toLowerCase() === 'freddai');
    if (freddai.length === 1) {
      const match = /(?<![\p{L}\p{N}])(?:freddie|freddy|freddi)(?![\p{L}\p{N}])/iu.exec(text);
      if (match) best = { project: freddai[0]!, match, len: freddai[0]!.name.length };
    }
  }
  if (!best) return null;
  const { match, project } = best;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  // Leading "in X," / "for X," / "X:" is a routing prefix; a name elsewhere is part of the sentence.
  if (/^\s*(?:(?:in|for|on|to|with|inside)\s+)?$/i.test(before)) {
    return { project, instruction: after.replace(/^[\s,:;.!-]+/, "").trim() };
  }
  return { project, instruction: text.trim() };
}

export function resolveProjectFromUtterance(remainder: string, projects: CommandProject[]): { project: CommandProject; instruction: string } | null {
  const found = matchProject(remainder, projects);
  return found && found.instruction ? found : null;
}

const APPEND = /^(?:and|also)\b[\s,]*/i;
const idle: CommandState = { kind: "idle" };
const none: CommandEffect[] = [{ type: "none" }];

export function commandCenterReducer(state: CommandState, event: CommandEvent, projects: CommandProject[]): { state: CommandState; effects: CommandEffect[] } {
  if (event.type === "dismiss" || event.type === "launched") return { state: idle, effects: none };
  if (event.type === "edit") {
    return state.kind === "reviewing" ? { state: { kind: "reviewing", draft: { ...state.draft, instruction: event.text } }, effects: none } : { state, effects: none };
  }
  const text = event.text.trim();
  if (!text) return { state, effects: none };
  const ask = (instruction: string, said = "Which project?") => ({ state: { kind: "awaitingProject", instruction, misses: 0 } as CommandState, effects: [{ type: "speak", text: said } as CommandEffect] });

  if (state.kind === "idle") {
    const remainder = stripWakeWord(text);
    if (remainder === null) return { state, effects: none };
    const found = matchProject(remainder, projects);
    if (found) return { state: { kind: "reviewing", draft: { projectId: found.project.id, instruction: found.instruction } }, effects: none };
    return ask(remainder);
  }
  if (state.kind === "awaitingProject") {
    const intent = parseCommandIntent(stripWakeWord(text) ?? text);
    if (intent.kind === "cancel") return { state: idle, effects: none };
    const found = matchProject(stripWakeWord(text) ?? text, projects);
    if (!found) {
      if (state.misses >= 1) return { state: idle, effects: [{ type: "speak", text: "Never mind." }] };
      return { state: { ...state, misses: state.misses + 1 }, effects: [{ type: "speak", text: "I did not catch a project. Which project?" }] };
    }
    const instruction = state.instruction || found.instruction;
    return { state: { kind: "reviewing", draft: { projectId: found.project.id, instruction } }, effects: none };
  }
  const intent = parseCommandIntent(text);
  if (intent.kind === "go") return { state, effects: [{ type: "launch" }] };
  if (intent.kind === "cancel") return { state: idle, effects: none };
  const append = APPEND.exec(text);
  const instruction = append ? `${state.draft.instruction} ${text.slice(append[0].length)}`.trim() : text;
  return { state: { kind: "reviewing", draft: { ...state.draft, instruction } }, effects: none };
}
