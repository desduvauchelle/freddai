fn main() {
    println!("cargo:rerun-if-env-changed=FREDDAI_COMPANION_PROVISION");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        // Xcode filters custom environment variables from script build phases.
        let path = std::env::var("FREDDAI_COMPANION_PROVISION").unwrap_or_else(|_| {
            std::path::PathBuf::from(std::env::var("HOME").expect("Missing build home"))
                .join("Library/Application Support/com.freddai.desktop/companion/iphone-provision.json")
                .to_string_lossy().into_owned()
        });
        println!("cargo:rerun-if-changed={path}");
        std::fs::copy(path, std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("companion-provision.json")).expect("Cannot read companion provision");
    }
    tauri_build::build()
}
