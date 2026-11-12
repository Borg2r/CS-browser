# Builds and runs the Breachpoint server (serves the web client too).
FROM rust:1-slim AS build
WORKDIR /app
COPY . .
RUN cargo build --release -p server

FROM debian:stable-slim
WORKDIR /app
COPY --from=build /app/target/release/server /app/server
COPY client /app/client
ENV CLIENT_DIR=/app/client PORT=8080
EXPOSE 8080
CMD ["/app/server"]
