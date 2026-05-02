use base64::Engine;
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;

const SESSION_TOKEN_BYTES: usize = 32;

type HmacSha256 = Hmac<Sha256>;

pub fn generate_session_token() -> String {
    let mut token = [0u8; SESSION_TOKEN_BYTES];
    rand::thread_rng().fill_bytes(&mut token);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(token)
}

pub fn hash_session_token(secret: &[u8], token: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts keys of any byte length");
    mac.update(token.as_bytes());
    mac.finalize().into_bytes().to_vec()
}
