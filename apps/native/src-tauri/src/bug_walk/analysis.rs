//! Pure pieces of the Bug walk pipeline: transcript formatting, the analysis prompt, lenient parsing of the
//! analysis reply, frame planning and `report.md` rendering. No IO, so everything here is unit-tested.

use super::Region;
use crate::voice::transcribe::Segment;
use serde_json::Value;

/// Never attach more than the runtime's per-message limit (`attachments::import` allows 20).
pub const MAX_FRAMES: usize = 20;
pub const FALLBACK_FRAME_EVERY_S: f64 = 10.0;

#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    pub start: f64,
    pub end: f64,
    pub frame_at: f64,
    pub title: String,
    pub expected: String,
    pub actual: String,
    pub quote: String,
    pub severity: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FrameKind {
    At,
    End,
    Interval,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlannedFrame {
    /// Index into the items list (0 for interval frames).
    pub item: usize,
    pub kind: FrameKind,
    pub time: f64,
}

/// `mm:ss.s`, e.g. 41.8 -> "00:41.8".
pub fn timestamp(secs: f64) -> String {
    let tenths = (secs.max(0.0) * 10.0).round() as u64;
    format!("{:02}:{:02}.{}", tenths / 600, (tenths / 10) % 60, tenths % 10)
}

/// `mm:ss`, rounded to the nearest second, e.g. 41.8 -> "00:42".
pub fn short_timestamp(secs: f64) -> String {
    let s = secs.max(0.0).round() as u64;
    format!("{:02}:{:02}", s / 60, s % 60)
}

/// One "[mm:ss.s] text" line per Whisper segment. Falls back to a single line when the engine returned no segments.
pub fn transcript_lines(segments: &[Segment], full_text: &str) -> String {
    let lines: Vec<String> = segments
        .iter()
        .filter(|s| !s.text.trim().is_empty())
        .map(|s| format!("[{}] {}", timestamp(s.start_s as f64), s.text.trim()))
        .collect();
    if lines.is_empty() && !full_text.trim().is_empty() {
        return format!("[{}] {}", timestamp(0.0), full_text.trim());
    }
    lines.join("\n")
}

/// "1280x800 px region", or for a device recording (region carries a title, e.g. "Screen recording from iPhone") "Screen recording from iPhone, 1170x2532 px".
fn recording_desc(region: &Region) -> String {
    let size = format!("{:.0}x{:.0} px", region.width, region.height);
    match region.title.as_deref().filter(|t| !t.is_empty()) {
        Some(t) if region.kind != super::TargetKind::Window => format!("{t}, {size}"),
        _ => format!("{size} region"),
    }
}

pub fn analysis_prompt(transcript: &str, region: &Region, duration_s: f64) -> String {
    format!(
        "You are analysing a screen recording of someone walking through an app and describing bugs out loud. \
You cannot see the video, only the timestamped transcript of their voice. Turn it into a list of distinct bugs.\n\n\
Recording: {what}, {dur} long.\n\n\
Rules:\n\
- Split one long rant into several items when it describes several problems.\n\
- Merge repeats of the same problem into one item.\n\
- Drop chatter, narration and anything that is not a problem or a requested change.\n\
- Keep the user's exact words in `quote` (join the relevant lines, no paraphrasing).\n\
- Set `frame_at` (seconds into the recording) to where the user was most likely pointing at the problem, usually the first \"here\" or \"this\".\n\
- \"fix this\" is a strong signal that something is a bug but is not required.\n\
- `start` and `end` bound the part of the transcript the item covers, in seconds.\n\
- `severity` is one of \"high\", \"medium\", \"low\".\n\
- Do not use any tools and do not read or edit any files.\n\n\
Reply with JSON only, no prose, no code fences, in exactly this shape:\n\
{{\"items\":[{{\"start\":41.8,\"end\":49.2,\"frame_at\":44.1,\"title\":\"Save button does nothing\",\"expected\":\"Loading state then a success toast\",\"actual\":\"Nothing happens on click\",\"quote\":\"When I click save here nothing happens\",\"severity\":\"high\"}}]}}\n\n\
Transcript:\n{transcript}\n",
        what = recording_desc(region),
        dur = short_timestamp(duration_s),
    )
}

fn num(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())).filter(|n| n.is_finite())
}

fn text(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or("").trim().to_string()
}

/// Lenient parse: strips code fences and surrounding prose by taking the first `{` to the last `}`.
/// Items with no title, quote or actual are dropped. A reply that is not JSON is an error, never a guess.
pub fn parse_analysis(reply: &str) -> Result<Vec<Item>, String> {
    let (Some(open), Some(close)) = (reply.find('{'), reply.rfind('}')) else {
        return Err(format!("The analysis reply was not JSON: {}", reply.trim().chars().take(200).collect::<String>()));
    };
    if close < open {
        return Err("The analysis reply was not JSON".into());
    }
    // Stream-parse the first JSON value so trailing prose (even prose containing braces) is ignored.
    let value: Value = serde_json::Deserializer::from_str(&reply[open..]).into_iter::<Value>().next().ok_or("The analysis reply was not JSON")?
        .map_err(|e| format!("The analysis reply was not valid JSON: {e}"))?;
    let items = value["items"].as_array().ok_or("The analysis reply has no `items` list")?;
    Ok(items
        .iter()
        .filter_map(|v| {
            let (title, quote, actual) = (text(v, "title"), text(v, "quote"), text(v, "actual"));
            if title.is_empty() && quote.is_empty() && actual.is_empty() {
                return None;
            }
            let start = num(&v["start"]).unwrap_or(0.0).max(0.0);
            let end = num(&v["end"]).unwrap_or(start).max(start);
            let frame_at = num(&v["frame_at"]).unwrap_or(start).max(0.0);
            let severity = match text(v, "severity").to_lowercase().as_str() {
                s @ ("high" | "medium" | "low") => s.to_string(),
                _ => "medium".to_string(),
            };
            Some(Item {
                start,
                end,
                frame_at,
                title: if title.is_empty() { "Untitled".into() } else { title },
                expected: text(v, "expected"),
                actual,
                quote,
                severity,
            })
        })
        .collect())
}

fn clamp_time(t: f64, duration_s: f64) -> f64 {
    t.clamp(0.0, (duration_s - 0.1).max(0.0))
}

/// One frame at `frame_at` per item, plus one at `end` when the item spans more than 3 s. Capped at
/// `MAX_FRAMES`: every item's first frame has priority over any end frame, and output stays in item order.
pub fn plan_frames(items: &[Item], duration_s: f64) -> Vec<PlannedFrame> {
    let mut budget = MAX_FRAMES;
    let mut at: Vec<bool> = vec![false; items.len()];
    for slot in at.iter_mut() {
        if budget == 0 { break; }
        *slot = true;
        budget -= 1;
    }
    let mut end: Vec<bool> = vec![false; items.len()];
    for (i, item) in items.iter().enumerate() {
        if budget == 0 { break; }
        if at[i] && item.end - item.start > 3.0 && (clamp_time(item.end, duration_s) - clamp_time(item.frame_at, duration_s)).abs() > 0.05 {
            end[i] = true;
            budget -= 1;
        }
    }
    let mut out = vec![];
    for (i, item) in items.iter().enumerate() {
        if at[i] { out.push(PlannedFrame { item: i, kind: FrameKind::At, time: clamp_time(item.frame_at, duration_s) }); }
        if end[i] { out.push(PlannedFrame { item: i, kind: FrameKind::End, time: clamp_time(item.end, duration_s) }); }
    }
    out
}

/// One frame every 10 s for the "send transcript as is" fallback, widened so it never exceeds `MAX_FRAMES`.
pub fn fallback_frames(duration_s: f64) -> Vec<PlannedFrame> {
    let step = FALLBACK_FRAME_EVERY_S.max((duration_s / MAX_FRAMES as f64).ceil());
    let mut out = vec![];
    let mut t = 0.0;
    while t < duration_s.max(0.1) && out.len() < MAX_FRAMES {
        out.push(PlannedFrame { item: 0, kind: FrameKind::Interval, time: clamp_time(t, duration_s) });
        t += step;
    }
    out
}

pub fn frame_name(number: usize) -> String {
    format!("{number:02}.png")
}

const FIX_INSTRUCTIONS: &str = "Work through every item in order. For each one, find the component in the screenshot, make the fix, and reply with a checklist: item number, what you changed, file:line. Ask only if an item is genuinely ambiguous.";

/// "region 1280×800" or, for an app window, "window Safari — Title 1280×800".
fn region_label(region: &Region) -> String {
    let size = format!("{:.0}×{:.0}", region.width, region.height);
    if region.kind != super::TargetKind::Window {
        return match region.title.as_deref().filter(|t| !t.is_empty()) {
            Some(t) => format!("{t} {size}"),
            None => format!("region {size}"),
        };
    }
    let app = region.app_name.as_deref().filter(|s| !s.is_empty()).unwrap_or("app");
    match region.title.as_deref().filter(|s| !s.is_empty()) {
        Some(t) => format!("window {app} — {t} {size}"),
        None => format!("window {app} {size}"),
    }
}

/// `when` is a pre-formatted local "YYYY-MM-DD HH:MM". Frame number N is `frames[N-1]` (attachment `NN.png`).
pub fn render_report(when: &str, region: &Region, items: &[Item], frames: &[PlannedFrame], transcript: &str) -> String {
    let mut out = format!(
        "# Bug walk — {when} — {}\n\n{} {}. Each item has a screenshot with the cursor showing where I was pointing.\n",
        region_label(region),
        items.len(),
        if items.len() == 1 { "item" } else { "items" },
    );
    for (i, item) in items.iter().enumerate() {
        out.push_str(&format!("\n## {}. {} ({}) — {}\n", i + 1, item.title, short_timestamp(item.start), item.severity));
        for (n, f) in frames.iter().enumerate().filter(|(_, f)| f.item == i) {
            let label = if f.kind == FrameKind::End { format!("item {} end", i + 1) } else { format!("item {}", i + 1) };
            out.push_str(&format!("![{label}](attachment:{})\n", frame_name(n + 1)));
        }
        if !item.expected.is_empty() { out.push_str(&format!("Expected: {}.\n", item.expected.trim_end_matches('.'))); }
        if !item.actual.is_empty() { out.push_str(&format!("Actual: {}.\n", item.actual.trim_end_matches('.'))); }
        for line in item.quote.lines() { out.push_str(&format!("> {line}\n")); }
    }
    out.push_str(&format!("\n## Fix instructions\n{FIX_INSTRUCTIONS}\n\n## Transcript\n{}\n", transcript.trim()));
    out
}

pub const CONTEXT_PAD_S: f64 = 15.0;

const ITEM_FIX_INSTRUCTIONS: &str = "Fix this one bug: find the component in the screenshot, make the fix, and reply with what you changed, file:line. Ask only if it is genuinely ambiguous.";

/// Parses the leading `[mm:ss.s]` of a transcript line into seconds.
fn line_start(line: &str) -> Option<f64> {
    let inner = line.strip_prefix('[')?.split(']').next()?;
    let (m, s) = inner.split_once(':')?;
    Some(m.parse::<f64>().ok()? * 60.0 + s.parse::<f64>().ok()?)
}

/// The transcript lines overlapping `[start - 15 s, end + 15 s]`. A line runs until the next line starts; lines
/// without a parseable timestamp are kept with the previous line.
pub fn context_lines(transcript: &str, start: f64, end: f64) -> String {
    let (lo, hi) = (start - CONTEXT_PAD_S, end + CONTEXT_PAD_S);
    let lines: Vec<&str> = transcript.lines().filter(|l| !l.trim().is_empty()).collect();
    let starts: Vec<Option<f64>> = lines.iter().map(|l| line_start(l)).collect();
    let mut keep = vec![];
    for (i, line) in lines.iter().enumerate() {
        let Some(s) = starts[i] else { continue };
        let next = starts[i + 1..].iter().flatten().next().copied().unwrap_or(f64::INFINITY);
        if s <= hi && next > lo { keep.push(*line); }
    }
    keep.join("\n")
}

/// Report for one item of a "One per bug" walk. `frame_count` frames (`01.png`..) belong to this item only;
/// `index` is 0-based within `total`.
pub fn render_item_report(index: usize, total: usize, item: &Item, frame_kinds: &[FrameKind], transcript: &str) -> String {
    let n = index + 1;
    let mut out = format!("# Bug walk item {n} of {total} — {} ({}) — {}\n\n", item.title, short_timestamp(item.start), item.severity);
    for (k, kind) in frame_kinds.iter().enumerate() {
        let label = if *kind == FrameKind::End { format!("item {n} end") } else { format!("item {n}") };
        out.push_str(&format!("![{label}](attachment:{})\n", frame_name(k + 1)));
    }
    if !item.expected.is_empty() { out.push_str(&format!("Expected: {}.\n", item.expected.trim_end_matches('.'))); }
    if !item.actual.is_empty() { out.push_str(&format!("Actual: {}.\n", item.actual.trim_end_matches('.'))); }
    for line in item.quote.lines() { out.push_str(&format!("> {line}\n")); }
    out.push_str(&format!("\n## Context\n{}\n\n## Fix instructions\n{ITEM_FIX_INSTRUCTIONS}\n", context_lines(transcript, item.start, item.end)));
    out
}

/// Report for the loud "send transcript as is" fallback: no analysis, one frame every 10 s.
pub fn render_transcript_report(when: &str, region: &Region, frames: &[PlannedFrame], transcript: &str) -> String {
    let mut out = format!(
        "# Bug walk (raw transcript) — {when} — {}\n\nAutomatic analysis was unavailable, so this is my full voice transcript with a screenshot every few seconds (cursor visible). Find every bug I describe and fix them.\n\n## Screenshots\n",
        region_label(region)
    );
    for (n, f) in frames.iter().enumerate() {
        out.push_str(&format!("{} ![frame at {}](attachment:{})\n", short_timestamp(f.time), short_timestamp(f.time), frame_name(n + 1)));
    }
    out.push_str(&format!("\n## Fix instructions\n{FIX_INSTRUCTIONS}\n\n## Transcript\n{}\n", transcript.trim()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region() -> Region {
        Region { width: 1280.0, height: 800.0, scale: 2.0, ..Default::default() }
    }
    fn item(start: f64, end: f64, frame_at: f64, title: &str) -> Item {
        Item { start, end, frame_at, title: title.into(), expected: String::new(), actual: String::new(), quote: String::new(), severity: "medium".into() }
    }

    #[test]
    fn formats_transcript_lines() {
        let seg = |s: f32, e: f32, t: &str| Segment { start_s: s, end_s: e, text: t.into() };
        let lines = transcript_lines(&[seg(0.0, 2.0, " Hello there "), seg(41.84, 49.0, "Save does nothing"), seg(125.0, 126.0, "  ")], "x");
        assert_eq!(lines, "[00:00.0] Hello there\n[00:41.8] Save does nothing");
        assert_eq!(transcript_lines(&[], " whole text "), "[00:00.0] whole text");
        assert_eq!(transcript_lines(&[], ""), "");
        assert_eq!(timestamp(3725.96), "62:06.0");
        assert_eq!(short_timestamp(41.8), "00:42");
    }

    #[test]
    fn parses_fenced_and_chatty_replies() {
        let body = r#"{"items":[{"start":41.8,"end":49.2,"frame_at":44.1,"title":"Save button does nothing","expected":"Toast","actual":"Nothing","quote":"fix this","severity":"HIGH"}]}"#;
        for reply in [body.to_string(), format!("```json\n{body}\n```"), format!("Sure! Here you go:\n{body}\nHope that helps {{really}}")] {
            let items = parse_analysis(&reply).unwrap_or_else(|e| panic!("{e} for {reply}"));
            assert_eq!(items.len(), 1);
            assert_eq!((items[0].start, items[0].end, items[0].frame_at, items[0].severity.as_str()), (41.8, 49.2, 44.1, "high"));
        }
    }

    #[test]
    fn parse_is_lenient_about_items_but_loud_about_non_json() {
        let items = parse_analysis(r#"{"items":[{},{"title":"  ","quote":""},{"start":"3.5","title":"A","severity":"urgent"}]}"#).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!((items[0].start, items[0].end, items[0].frame_at, items[0].severity.as_str()), (3.5, 3.5, 3.5, "medium"));
        assert!(parse_analysis(r#"{"items":[]}"#).unwrap().is_empty());
        assert!(parse_analysis("I could not find any bugs.").unwrap_err().contains("not JSON"));
        assert!(parse_analysis(r#"{"bugs":[]}"#).unwrap_err().contains("items"));
        assert!(parse_analysis("{ nope }").unwrap_err().contains("valid JSON"));
    }

    #[test]
    fn plans_frames_with_end_frames_for_long_items_and_a_cap() {
        let items = [item(1.0, 2.0, 1.5, "short"), item(10.0, 20.0, 12.0, "long")];
        let plan = plan_frames(&items, 60.0);
        assert_eq!(plan.iter().map(|p| (p.item, p.kind, p.time)).collect::<Vec<_>>(), vec![(0, FrameKind::At, 1.5), (1, FrameKind::At, 12.0), (1, FrameKind::End, 20.0)]);
        assert_eq!(plan_frames(&[item(0.0, 5.0, 100.0, "late")], 10.0)[0].time, 9.9);
        let many: Vec<Item> = (0..25).map(|i| item(i as f64 * 10.0, i as f64 * 10.0 + 8.0, i as f64 * 10.0 + 1.0, "x")).collect();
        let plan = plan_frames(&many, 1000.0);
        assert_eq!(plan.len(), MAX_FRAMES);
        assert!(plan.iter().all(|p| p.kind == FrameKind::At), "first frames win over end frames when over the cap");
        let few: Vec<Item> = (0..15).map(|i| item(i as f64 * 10.0, i as f64 * 10.0 + 8.0, i as f64 * 10.0 + 1.0, "x")).collect();
        assert_eq!(plan_frames(&few, 1000.0).len(), MAX_FRAMES);
    }

    #[test]
    fn fallback_frames_every_ten_seconds_within_the_cap() {
        let times: Vec<f64> = fallback_frames(35.0).iter().map(|f| f.time).collect();
        assert_eq!(times, vec![0.0, 10.0, 20.0, 30.0]);
        let long = fallback_frames(1800.0);
        assert!(long.len() <= MAX_FRAMES && long.len() > 15);
        assert_eq!(fallback_frames(0.0).len(), 1);
    }

    #[test]
    fn renders_two_item_report() {
        let mut a = item(41.8, 49.2, 44.1, "Save button does nothing");
        a.expected = "Loading state then a success toast".into();
        a.actual = "Nothing happens on click".into();
        a.quote = "When I click save here nothing happens… fix this".into();
        a.severity = "high".into();
        let mut b = item(70.0, 71.0, 70.5, "Header overlaps sidebar");
        b.actual = "It overlaps".into();
        b.quote = "line one\nline two".into();
        let items = [a, b];
        let frames = plan_frames(&items, 120.0);
        let report = render_report("2026-11-11 14:32", &region(), &items, &frames, "[00:41.8] When I click save\n");
        let expected = "\
# Bug walk — 2026-11-11 14:32 — region 1280×800

2 items. Each item has a screenshot with the cursor showing where I was pointing.

## 1. Save button does nothing (00:42) — high
![item 1](attachment:01.png)
![item 1 end](attachment:02.png)
Expected: Loading state then a success toast.
Actual: Nothing happens on click.
> When I click save here nothing happens… fix this

## 2. Header overlaps sidebar (01:10) — medium
![item 2](attachment:03.png)
Actual: It overlaps.
> line one
> line two

## Fix instructions
Work through every item in order. For each one, find the component in the screenshot, make the fix, and reply with a checklist: item number, what you changed, file:line. Ask only if an item is genuinely ambiguous.

## Transcript
[00:41.8] When I click save
";
        assert_eq!(report, expected);
    }

    #[test]
    fn renders_per_item_reports_and_context_window() {
        let transcript = "[00:00.0] intro\n[00:20.0] before\n[00:41.8] When I click save\n[01:05.0] after\n[01:30.0] far away";
        let mut a = item(41.8, 49.2, 44.1, "Save button does nothing");
        a.expected = "Loading state".into();
        a.actual = "Nothing happens".into();
        a.quote = "fix this".into();
        a.severity = "high".into();
        let b = item(100.0, 101.0, 100.5, "Header");
        let r = render_item_report(0, 2, &a, &[FrameKind::At, FrameKind::End], transcript);
        assert_eq!(r, "\
# Bug walk item 1 of 2 — Save button does nothing (00:42) — high

![item 1](attachment:01.png)
![item 1 end](attachment:02.png)
Expected: Loading state.
Actual: Nothing happens.
> fix this

## Context
[00:20.0] before
[00:41.8] When I click save

## Fix instructions
Fix this one bug: find the component in the screenshot, make the fix, and reply with what you changed, file:line. Ask only if it is genuinely ambiguous.
");
        // window 26.8..64.2: "before" (20.0-41.8) overlaps; "after" starts at 65.0 so is out.
        assert_eq!(context_lines(transcript, 41.8, 49.2), "[00:20.0] before\n[00:41.8] When I click save");
        let r2 = render_item_report(1, 2, &b, &[FrameKind::At], transcript);
        assert!(r2.starts_with("# Bug walk item 2 of 2 — Header (01:40) — medium\n"));
        assert!(r2.contains("## Context\n[01:05.0] after\n[01:30.0] far away\n"));
    }

    #[test]
    fn renders_transcript_fallback_report() {
        let frames = fallback_frames(25.0);
        let report = render_transcript_report("2026-11-11 14:32", &region(), &frames, "[00:01.0] hi");
        assert!(report.contains("00:10 ![frame at 00:10](attachment:02.png)"));
        assert!(report.ends_with("## Transcript\n[00:01.0] hi\n"));
    }

    #[test]
    fn report_heading_names_the_window() {
        let win = Region { kind: crate::bug_walk::TargetKind::Window, app_name: Some("Safari".into()), title: Some("Docs".into()), ..region() };
        assert!(render_transcript_report("2026-11-11 14:32", &win, &[], "[00:01.0] hi").starts_with("# Bug walk (raw transcript) — 2026-11-11 14:32 — window Safari — Docs 1280×800\n"));
        assert_eq!(region_label(&Region { title: None, ..win }), "window Safari 1280×800");
    }

    #[test]
    fn prompt_carries_transcript_region_and_json_only_rule() {
        let p = analysis_prompt("[00:01.0] hi", &region(), 75.0);
        assert!(p.contains("1280x800") && p.contains("01:15") && p.contains("[00:01.0] hi"));
        assert!(p.contains("Reply with JSON only") && p.contains("exact words") && p.contains("fix this"));
    }
}
