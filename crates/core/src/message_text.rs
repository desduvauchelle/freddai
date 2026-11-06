//! Copy-on-write transcript text. Snapshots and persistence share immutable bodies.
use serde::{Deserialize, Serialize};
use std::{ops::{Deref, DerefMut}, sync::Arc};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MessageText(Arc<String>);
impl From<String> for MessageText {
    fn from(text: String) -> Self { Self(Arc::new(text)) }
}
impl From<&str> for MessageText {
    fn from(text: &str) -> Self { text.to_owned().into() }
}
impl Deref for MessageText {
    type Target = String;
    fn deref(&self) -> &String { &self.0 }
}
impl DerefMut for MessageText {
    fn deref_mut(&mut self) -> &mut String { Arc::make_mut(&mut self.0) }
}
impl PartialEq<&str> for MessageText {
    fn eq(&self, other: &&str) -> bool { self.as_str() == *other }
}
