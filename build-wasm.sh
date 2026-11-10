#!/usr/bin/env bash
# Rebuilds the client-side prediction module (client/predict.wasm).
# Needed only after changing crates/sim or crates/predict.
set -euo pipefail
cd "$(dirname "$0")"
rustup target add wasm32-unknown-unknown >/dev/null
cargo build -p predict --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/predict.wasm client/predict.wasm
echo "client/predict.wasm updated"
