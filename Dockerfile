# syntax=docker/dockerfile:1
# Build the server and prediction module from the same source revision.
FROM rust:1.99.1-slim-trixie AS build
WORKDIR /app
COPY . .
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then \
      export CARGO_HTTP_CAINFO=/run/secrets/proxy_ca SSL_CERT_FILE=/run/secrets/proxy_ca; \
    fi; \
    rustup target add wasm32-unknown-unknown && \
    cargo build --locked --release -p server && \
    cargo build --locked --release -p predict --target wasm32-unknown-unknown && \
    cp target/wasm32-unknown-unknown/release/predict.wasm client/predict.wasm
RUN chmod -R a+rX /app/client

FROM debian:trixie-slim
WORKDIR /app
COPY --from=build /app/target/release/server /app/server
COPY --from=build /app/client /app/client
ENV CLIENT_DIR=/app/client PORT=8080
USER 65532:65532
EXPOSE 8080
CMD ["/app/server"]
