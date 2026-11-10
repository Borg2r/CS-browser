//! Authoritative game server: serves the web client and runs the match.
mod bot;
mod game;
mod nav;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::Response,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use game::{ClientMsg, Incoming};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};
use tokio::sync::mpsc;
use tower_http::services::ServeDir;

#[derive(Clone)]
struct App {
    tx: mpsc::UnboundedSender<Incoming>,
    next_conn: Arc<AtomicU32>,
}

#[tokio::main]
async fn main() {
    let (tx, rx) = mpsc::unbounded_channel();
    tokio::spawn(game::run(rx));

    let dir = std::env::var("CLIENT_DIR")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../../client").to_string());
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080);

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .fallback_service(ServeDir::new(dir))
        .with_state(App { tx, next_conn: Arc::new(AtomicU32::new(1)) });

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.expect("bind");
    println!("Breachpoint server listening on http://localhost:{port}");
    axum::serve(listener, app).await.expect("serve");
}

async fn ws_handler(ws: WebSocketUpgrade, State(app): State<App>) -> Response {
    ws.max_message_size(4096).on_upgrade(move |socket| client(socket, app))
}

async fn client(socket: WebSocket, app: App) {
    let conn = app.next_conn.fetch_add(1, Ordering::Relaxed);
    let (out_tx, mut out_rx) = mpsc::channel::<String>(256);
    if app.tx.send(Incoming::Connect(conn, out_tx)).is_err() {
        return;
    }
    let (mut sink, mut stream) = socket.split();
    let writer = tokio::spawn(async move {
        while let Some(m) = out_rx.recv().await {
            if sink.send(Message::Text(m.into())).await.is_err() {
                break;
            }
        }
    });
    while let Some(Ok(msg)) = stream.next().await {
        match msg {
            Message::Text(t) => {
                if let Ok(m) = serde_json::from_str::<ClientMsg>(t.as_str()) {
                    let _ = app.tx.send(Incoming::Msg(conn, m));
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    let _ = app.tx.send(Incoming::Disconnect(conn));
    writer.abort();
}
