fn main() {
    let f = "payload/orchestra.exe";
    if !std::path::Path::new(f).exists() {
        panic!("Arquivo ausente: installer/src-tauri/{f}. O app compilado é copiado para cá pela esteira de release.");
    }
    println!("cargo:rerun-if-changed={f}");
    tauri_build::build()
}
