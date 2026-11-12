// All times in VoLine / cues / music / sfx.at are in SECONDS from the start of the short (30 fps).
export type VoLine = { id: string; start: number; duration: number; text: string };
export type ShortTimeline = { id: string; fps: 30; durationInFrames: number; vo: VoLine[]; cues: Record<string, number>; music: { turn: number; lift: number; hit: number; end: number }; sfx: { name: string; at: number; gain: number }[] };
