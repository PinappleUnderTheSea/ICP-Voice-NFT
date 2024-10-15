from pocket_ic import PocketIC

pic = PocketIC()
canister_id = pic.create_canister()
pic.add_cycles(canister_id, 2_000_000_000_000)  # 2T cycles
pic.install_code("/root/Dapp/dapp_demo/target/wasm32-unknown-unknown/release/icp_hello_world_rust_backend.wasm")

# make canister calls
response = pic.update_call(canister_id, method="greet", payload= b'')
assert(response == 'Hello, PocketIC!')