use crate::runtime::LaunchOptions;
use chrono::{TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
#[derive(Clone, Serialize, Deserialize)]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub project: String,
    pub account: String,
    pub routing: String,
    pub cron: String,
    pub timezone: String,
    pub prompt: String,
    pub enabled: bool,
    #[serde(default)]
    pub options: LaunchOptions,
    #[serde(default)]
    pub next_due: u64,
    #[serde(default)]
    pub run_now: Option<u64>,
    #[serde(default)]
    pub runs: Vec<Run>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    pub due: u64,
    pub state: String,
    pub session: Option<String>,
    pub reason: Option<String>,
}
pub fn next(expression: &str, timezone: &str, after: u64) -> Result<u64, String> {
    let tz = chrono_tz::Tz::from_str(timezone)
        .map_err(|_| "Use a valid IANA timezone, e.g. America/Los_Angeles")?;
    if expression.split_whitespace().count() != 5 {
        return Err("Use five cron fields: minute hour day month weekday".into());
    }
    let fields = expression.split_whitespace().collect::<Vec<_>>();
    // cron crate numbers Sunday as 1; UI accepts standard five-field cron (Sunday 0/7).
    let day = fields[4];
    let mut weekdays = std::collections::BTreeSet::new();
    for part in day.split(',') {
        let (range, step) = part
            .split_once('/')
            .map(|(r, n)| n.parse::<u32>().map(|n| (r, n)))
            .transpose()
            .map_err(|_| "Invalid weekday step")?
            .unwrap_or((part, 1));
        if step == 0 {
            return Err("Invalid weekday step".into());
        }
        let number = |v: &str| -> Result<u32, String> {
            match v.to_ascii_uppercase().as_str() {
                "SUN" => Ok(0),
                "MON" => Ok(1),
                "TUE" => Ok(2),
                "WED" => Ok(3),
                "THU" => Ok(4),
                "FRI" => Ok(5),
                "SAT" => Ok(6),
                _ => v.parse().map_err(|_| "Invalid weekday".into()),
            }
        };
        let (first, last) = if range == "*" {
            (0, 6)
        } else if let Some((a, b)) = range.split_once('-') {
            (number(a)?, number(b)?)
        } else {
            let n = number(range)?;
            (n, if part.contains('/') { 7 } else { n })
        };
        if first > 7 || last > 7 || first > last {
            return Err("Weekdays must be 0-7 (Sunday is 0 or 7)".into());
        }
        for n in (first..=last).step_by(step as usize) {
            weekdays.insert(n % 7 + 1);
        }
    }
    if fields[2] != "*" && fields[4] != "*" {
        return Err("Choose either day of month or weekday, leaving the other as *".into());
    }
    let days = weekdays
        .into_iter()
        .map(|n| n.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let expr = format!(
        "0 {} {} {} {} {}",
        fields[0], fields[1], fields[2], fields[3], days
    );
    let schedule = cron::Schedule::from_str(&expr).map_err(|e| e.to_string())?;
    let start = Utc
        .timestamp_millis_opt(after as i64)
        .single()
        .ok_or("Invalid date")?
        .with_timezone(&tz);
    let mut upcoming = schedule.after(&start);
    let date = upcoming.next().ok_or("Schedule has no future occurrence")?;
    if upcoming
        .next()
        .is_some_and(|next| next.timestamp_millis() - date.timestamp_millis() < 60_000)
    {
        return Err("Schedules must be at least one minute apart".into());
    }
    Ok(date.timestamp_millis() as u64)
}
pub fn wall_slot(time: u64, timezone: &str) -> Option<String> {
    let tz = chrono_tz::Tz::from_str(timezone).ok()?;
    Some(
        Utc.timestamp_millis_opt(time as i64)
            .single()?
            .with_timezone(&tz)
            .format("%Y-%m-%d %H:%M")
            .to_string(),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn weekdays_follow_standard_cron() {
        let friday = chrono::DateTime::parse_from_rfc3339("2026-11-06T18:00:00Z")
            .unwrap()
            .timestamp_millis() as u64;
        let monday = chrono::DateTime::parse_from_rfc3339("2026-11-09T17:00:00Z")
            .unwrap()
            .timestamp_millis() as u64;
        assert_eq!(
            next("0 9 * * 1-5", "America/Los_Angeles", friday).unwrap(),
            monday
        );
        assert_eq!(
            next("0 9 * * MON-FRI", "America/Los_Angeles", friday).unwrap(),
            monday
        );
    }
    #[test]
    fn timezone_and_invalid_rules() {
        let t = 1700000000000;
        assert!(next("0 9 * * *", "America/Los_Angeles", t).unwrap() > t);
        assert!(next("invalid", "UTC", t).is_err());
        assert!(next("* * * * * *", "UTC", t).is_err());
        assert!(next("0 9 * * *", "bad-zone", t).is_err());
    }
}
