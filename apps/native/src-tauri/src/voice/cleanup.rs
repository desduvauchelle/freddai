//! Conservative local hesitation cleanup shared by desktop and companion dictation.

fn hesitation(word: &str) -> bool {
    let word = word.to_ascii_lowercase();
    // Only whole hesitation sounds; never strip meaningful discourse words.
    ["um", "uh", "uhm", "erm", "er", "ah", "hm"].iter().any(|base| {
        let mut chars = word.chars().peekable();
        for expected in base.chars() {
            if chars.next() != Some(expected) { return false; }
            while chars.peek() == Some(&expected) { chars.next(); }
        }
        chars.next().is_none()
    })
}

pub fn clean_transcript(text: &str, enabled: bool) -> String {
    if !enabled { return text.to_owned(); }
    let mut result = String::new();
    let mut cursor = 0;
    let mut removed = false;
    // Process bare words plus their following separators, preserving all untouched text.
    while cursor < text.len() {
        let start = cursor;
        let first = text[cursor..].chars().next().unwrap();
        if !first.is_alphabetic() {
            result.push(first);
            cursor += first.len_utf8();
            continue;
        }
        while cursor < text.len() {
            let c = text[cursor..].chars().next().unwrap();
            if !c.is_alphabetic() { break; }
            cursor += c.len_utf8();
        }
        // Do not interpret fragments in identifiers, contractions or hyphenated words.
        let joined = |c: char| c.is_alphanumeric() || matches!(c, '_' | '-' | '\'' | '’');
        let attached = text[..start].chars().next_back().map(joined).unwrap_or(false)
            || text[cursor..].chars().next().map(joined).unwrap_or(false);
        if attached || !hesitation(&text[start..cursor]) {
            result.push_str(&text[start..cursor]);
            continue;
        }
        removed = true;
        // Drop filler punctuation; keep a sentence boundary after meaningful text.
        let punctuation_start = cursor;
        while cursor < text.len() && matches!(text[cursor..].chars().next().unwrap(), ',' | '.' | '!' | '?' | ';' | ':' | '…') {
            cursor += text[cursor..].chars().next().unwrap().len_utf8();
        }
        let punctuation = &text[punctuation_start..cursor];
        if result.trim_end().ends_with(',') {
            while result.ends_with([' ', ',']) { result.pop(); }
            result.push(' ');
        }
        if punctuation.contains(['.', '!', '?']) && !result.trim().is_empty() {
            while result.ends_with([' ', ',']) { result.pop(); }
            if !result.ends_with(['.', '!', '?']) {
                result.push(punctuation.chars().find(|c| matches!(c, '.' | '!' | '?')).unwrap());
            }
        }
        // Previous whitespace already separates the remaining words.
        while cursor < text.len() && text[cursor..].chars().next().unwrap().is_whitespace() {
            cursor += text[cursor..].chars().next().unwrap().len_utf8();
        }
    }
    if removed { result.trim().to_owned() } else { text.to_owned() }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removes_hesitations_and_their_punctuation() {
        assert_eq!(clean_transcript("Um, please uh open the, erm, settings.", true), "please open the settings.");
        assert_eq!(clean_transcript("Ummm... UHH, hmm, send it.", true), "send it.");
        assert_eq!(clean_transcript("Send it. Um, tomorrow.", true), "Send it. tomorrow.");
        assert_eq!(clean_transcript("Send it um.", true), "Send it.");
        assert_eq!(clean_transcript("Um, uh, erm.", true), "");
    }
    #[test]
    fn preserves_meaning_and_opt_out() {
        for text in ["I like it, you know, well done.", "umbrella human error", "um_value uh-oh 'um'", "Bonjour, le chat dort.", "Keep\n  spacing."] {
            assert_eq!(clean_transcript(text, true), text);
        }
        assert_eq!(clean_transcript("Um, keep uh everything.", false), "Um, keep uh everything.");
    }
}
