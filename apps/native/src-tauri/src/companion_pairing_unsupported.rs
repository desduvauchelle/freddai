//! Desktop command surface on platforms without the macOS companion service.
use serde_json::Value;
use std::path::Path;

pub fn status(_root: &Path) -> Result<Value, String> {
    Err("iPhone pairing is currently available only on macOS".into())
}

pub fn control(root: &Path, _action: &str, _id: &str) -> Result<Value, String> {
    status(root)
}
