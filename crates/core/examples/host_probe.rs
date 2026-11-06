//! Account-free integration harness. Each invocation uses an explicitly supplied temporary root.
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let root = std::path::PathBuf::from(args.get(2).expect("workspace path"));
    let result = if args[1] == "--host" {
        freddai_core::host::serve(root).map(|_| serde_json::Value::Null)
    } else {
        freddai_core::host::call(&root, &args[1], serde_json::json!({}))
    };
    match result {
        Ok(value) => println!("{value}"),
        Err(error) => { eprintln!("{error}"); std::process::exit(1); }
    }
}
