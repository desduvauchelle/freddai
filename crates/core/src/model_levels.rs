//! Central provider mappings, shared by all clients and resolved immediately before AI execution.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, process::Command};
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct Mapping { pub family: String, pub effort: String }
pub type Configuration = HashMap<String, HashMap<String, Mapping>>;
pub fn validate(config: &Configuration) -> Result<(), String> {
    if config.len() > 100 { return Err("Too many provider mappings".into()); }
    for (provider, levels) in config {
        if provider.is_empty() || provider.len() > 100 || !provider.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') { return Err("Invalid provider".into()); }
        for (level, mapping) in levels {
            if (!["codex","claude"].contains(&provider.as_str()) && mapping.effort != "default") || !["smart", "normal", "fast"].contains(&level.as_str()) || mapping.family.len() > 120 || !mapping.family.bytes().all(|c| c.is_ascii_alphanumeric() || b"._/-".contains(&c)) || !( ["default","low","medium","high","xhigh","max"].contains(&mapping.effort.as_str()) || (provider == "claude" && mapping.effort == "ultracode")) { return Err("Invalid model configuration".into()); }
        }
    }
    Ok(())
}
pub fn mapping(config: &Configuration, provider: &str, level: &str) -> Mapping {
    config.get(provider).and_then(|p| p.get(level)).cloned().unwrap_or_else(|| Mapping {
        family: match (provider, level) { ("codex","smart") => "astra", ("codex","normal") => "sol", ("codex","fast") => "luna", ("claude","smart") => "fable", ("claude","normal") => "opus", ("claude","fast") => "sonnet", _ => "" }.into(),
        effort: if provider == "codex" && level != "fast" { "medium" } else { "default" }.into(),
    })
}
pub fn level(model: Option<&str>) -> Result<Option<&str>, String> {
    match model.filter(|s| !s.is_empty()) {
        None => Ok(Some("normal")),
        Some(id) if id.starts_with("freddai-level:") => {
            let name = id.split(':').nth(1).unwrap_or("");
            if ["smart","normal","fast"].contains(&name) { Ok(Some(name)) } else { Err("Invalid model level".into()) }
        }
        Some("freddai-custom:") => Err("Choose a specific model for Custom difficulty.".into()),
        _ => Ok(None),
    }
}
fn version(id: &str) -> Vec<u64> { id.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).filter_map(|s| s.parse().ok()).collect() }
pub fn resolve_codex<'a>(family: &str, effort: &str, rows: &'a [Value]) -> Result<&'a str,String> {
    // Exact IDs are pinned; a bare family follows the newest numeric release.
    let exact = rows.iter().find(|r| r["model"] == family && r["hidden"] != true);
    let mut matches: Vec<_> = rows.iter().filter(|r| r["hidden"] != true).filter_map(|r| r["model"].as_str().map(|id| (id,r)))
        .filter(|(id,_)| id.split(|c:char| !c.is_ascii_alphanumeric()).any(|w| w.eq_ignore_ascii_case(family))).collect();
    matches.sort_by(|a,b| version(b.0).cmp(&version(a.0)));
    let (id,row) = exact.and_then(|r| r["model"].as_str().map(|id|(id,r))).or_else(||matches.first().copied()).ok_or_else(||format!("No available model in family '{family}'. Update Settings → Model configuration or choose Custom."))?;
    if effort != "default" && !row["supportedReasoningEfforts"].as_array().is_some_and(|es|es.iter().any(|e|e["reasoningEffort"]==effort)) { return Err(format!("Model '{id}' does not support '{effort}' reasoning. Update Model configuration.")); }
    Ok(id)
}
pub fn resolve(config: &Configuration, provider: &str, model: Option<&str>, effort: Option<&str>, make_cmd: &dyn Fn() -> Result<Command,String>) -> Result<(Option<String>,Option<String>),String> {
    let Some(level) = level(model)? else { return Ok((model.map(str::to_owned),effort.map(str::to_owned))) };
    let mapping = mapping(config,provider,level);
    let chosen = if mapping.family.is_empty() { None } else if provider == "codex" {
        let catalog = crate::models::read(make_cmd()?)?;
        Some(resolve_codex(&mapping.family,&mapping.effort,catalog.as_array().ok_or("Invalid model catalog")?)?.to_owned())
    } else { Some(mapping.family) };
    Ok((chosen,if mapping.effort=="default" {None} else {Some(mapping.effort)}))
}
#[cfg(test)]
mod tests {
    use super::*; use serde_json::json;
    #[test] fn ultracode_mapping_is_claude_only() {
        let levels = HashMap::from([("smart".into(), Mapping { family: "opus".into(), effort: "ultracode".into() })]);
        let c = HashMap::from([("claude".into(), levels.clone())]);
        assert!(validate(&c).is_ok());
        assert_eq!(resolve(&c, "claude", Some("freddai-level:smart"), None, &|| Err("no discovery".into())).unwrap(), (Some("opus".into()), Some("ultracode".into())));
        assert!(validate(&HashMap::from([("codex".into(), levels)])).is_err());
    }
    #[test] fn follows_versions_and_pins_exact_ids() {
        let rows=vec![json!({"model":"gpt-6.9-sol"}),json!({"model":"gpt-6.10-sol"}),json!({"model":"gpt-8-sol","hidden":true})];
        assert_eq!(resolve_codex("sol","default",&rows).unwrap(),"gpt-6.10-sol");
        assert_eq!(resolve_codex("gpt-6.9-sol","default",&rows).unwrap(),"gpt-6.9-sol");
        assert!(resolve_codex("sol","medium",&rows).is_err());
        assert!(resolve_codex("luna","default",&rows).is_err());
    }
    #[test] fn central_changes_apply_to_saved_and_legacy_levels() {
        let mut c=Configuration::new(); c.insert("claude".into(),HashMap::from([("smart".into(),Mapping{family:"opus".into(),effort:"high".into()})]));
        for selection in ["freddai-level:smart","freddai-level:smart:fable:default"] { assert_eq!(resolve(&c,"claude",Some(selection),None,&||Err("no discovery".into())).unwrap(),(Some("opus".into()),Some("high".into()))); }
        assert_eq!(level(None).unwrap(),Some("normal")); assert!(validate(&c).is_ok());
        c.get_mut("claude").unwrap().get_mut("smart").unwrap().effort="invalid".into(); assert!(validate(&c).is_err());
    }
}
