use ulid::Ulid;

pub fn create_id() -> String {
    Ulid::new().to_string()
}
