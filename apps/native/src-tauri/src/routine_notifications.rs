//! The detached host delivers persisted routine notices even with the GUI closed.
use std::{path::PathBuf,time::Duration};
use serde_json::json;
use freddai_core::schedules::Notice;

fn deliver(
    notices: &[Notice],
    mut show: impl FnMut(&Notice) -> Result<(), String>,
    mut acknowledge: impl FnMut(&str) -> Result<(), String>,
) -> Result<(), String> {
    for notice in notices {
        show(notice)?;
        acknowledge(&notice.id)?;
    }
    Ok(())
}

pub fn start(root:PathBuf) {
    std::thread::spawn(move|| {
        if let Err(error)=notify_rust::set_application("com.freddai.desktop") {
            eprintln!("Routine notification setup: {error}");
            return;
        }
        loop {
            let mut failed=false;
            if let Ok(value)=freddai_core::host::call(&root,"schedule_notifications",json!({})) {
                if let Ok(notices)=serde_json::from_value::<Vec<Notice>>(value) {
                    if let Err(error)=deliver(&notices,
                        |notice| notify_rust::Notification::new().summary(&notice.title).body(&notice.body).show().map(|_|()).map_err(|error|error.to_string()),
                        |id| freddai_core::host::call(&root,"ack_schedule_notification",json!({"notice":id})).map(|_|()),
                    ) {
                        eprintln!("Routine notification delivery: {error}");
                        failed=true;
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(if failed {60} else {5}));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn notices() -> Vec<Notice> {
        ["first", "second"].map(|id|Notice { id:id.into(),title:"Routine".into(),body:"Update".into(),session:None,delivered:false }).into()
    }
    #[test]
    fn routine_notifications_ack_only_after_successful_delivery() {
        let calls=std::cell::RefCell::new(Vec::new());
        let result=deliver(&notices(),|n|{calls.borrow_mut().push(format!("show {}",n.id));if n.id=="second" {Err("delivery failed".into())}else{Ok(())}},|id|{calls.borrow_mut().push(format!("ack {id}"));Ok(())});
        assert!(result.is_err());
        assert_eq!(*calls.borrow(),["show first","ack first","show second"]);
    }
    #[test]
    fn routine_notifications_stop_batch_when_acknowledgement_fails() {
        let mut shown=Vec::new();
        assert!(deliver(&notices(),|n|{shown.push(n.id.clone());Ok(())},|_|Err("host unavailable".into())).is_err());
        assert_eq!(shown,["first"]);
    }
}
