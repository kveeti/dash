use std::io::Result;
fn main() -> Result<()> {
    println!("cargo:rerun-if-changed=protocol.proto");
    prost_build::compile_protos(&["protocol.proto"], &["."])?;
    Ok(())
}
