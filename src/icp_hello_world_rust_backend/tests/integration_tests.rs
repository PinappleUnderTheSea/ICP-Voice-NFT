use candid::{decode_one, encode_one, Principal, Encode};
use pocket_ic::{PocketIc, WasmResult};
use std::fs;

const BACKEND_WASM: &str = "../../target/wasm32-unknown-unknown/release/icp_hello_world_rust_backend.wasm";

fn setup() -> (PocketIc, Principal) {
    let pic = PocketIc::new();

    let backend_canister = pic.create_canister();
    pic.add_cycles(backend_canister, 2_000_000_000); // 2T Cycles
    let wasm = fs::read(BACKEND_WASM).expect("Wasm file not found, run 'dfx build'.");
    pic.install_canister(backend_canister, wasm, vec![], None);
    (pic, backend_canister)
}

#[test]
fn test_hello_world() {
    let (pic, backend_canister) = setup();
    let description = "Example description".to_string();
    let voice_fingerprint = vec![1.0, 2.0, 3.0, 4.0];
    let metadata = "Example metadata".to_string();

    let encoded_args = Encode!(&description, &voice_fingerprint, &metadata).unwrap();

    let Ok(WasmResult::Reply(response)) = pic.query_call(
        backend_canister,
        Principal::anonymous(),
        "greet",
        encode_one("ICP").unwrap(),
    ) else {
        panic!("Expected reply");
    };
    let result: String = decode_one(&response).unwrap();
    assert_eq!(result, "Hello, ICP!");
}
