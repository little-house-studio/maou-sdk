//! 渲染层 `/api/*` 与 `/ws/*` → hub 的 unix socket / named pipe。
//! 不监听任何 TCP 端口：HTTP 响应体和 WS 消息都经 Tauri Channel 流回页面。

use std::collections::HashMap;
use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use http_body_util::{BodyExt, Full};
use hyper::header::{HeaderName, HeaderValue, HOST};
use hyper::{Method, Request};
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use crate::hub::Hub;

/// hub 按 Host 认本机客户端，与原 Electron 转发保持一致。
const HUB_HOST: &str = "maou-app";
const WS_PATHS: [&str; 2] = ["/ws/terminal", "/ws/agent-terminal"];
/// 由 hyper 自己算或不该透传的头。
const SKIP_HEADERS: [&str; 5] = [
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
    "upgrade",
];

trait Duplex: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Duplex for T {}

#[cfg(unix)]
async fn connect(socket: &str) -> io::Result<Box<dyn Duplex>> {
    Ok(Box::new(tokio::net::UnixStream::connect(socket).await?))
}

#[cfg(windows)]
async fn connect(socket: &str) -> io::Result<Box<dyn Duplex>> {
    use std::time::Duration;
    use tokio::net::windows::named_pipe::ClientOptions;
    const ERROR_PIPE_BUSY: i32 = 231;
    let mut tries = 0;
    loop {
        match ClientOptions::new().open(socket) {
            Ok(client) => return Ok(Box::new(client)),
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && tries < 100 => {
                tries += 1;
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            Err(e) => return Err(e),
        }
    }
}

/// 在途请求与 WS 中继；页面重载时整体清掉。
#[derive(Clone, Default)]
pub struct Relays {
    inner: Arc<RelaysInner>,
}

#[derive(Default)]
struct RelaysInner {
    http: Mutex<HashMap<String, JoinHandle<()>>>,
    ws: Mutex<HashMap<String, WsRelay>>,
    next_gen: AtomicU64,
}

struct WsRelay {
    gen: u64,
    tx: mpsc::UnboundedSender<String>,
}

impl Relays {
    pub fn reset(&self) {
        for (_, task) in self.inner.http.lock().unwrap().drain() {
            task.abort();
        }
        // 丢掉发送端，中继任务自己发 close 收尾
        self.inner.ws.lock().unwrap().clear();
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpStartReq {
    id: String,
    path: String,
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HttpHead {
    status: u16,
    status_text: String,
    headers: HashMap<String, String>,
}

/// Channel 上的控制帧；响应体块走 raw 字节，页面按 ArrayBuffer / 对象区分。
#[derive(Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum HttpCtl {
    End,
    Error { message: String },
}

fn ctl(msg: &HttpCtl) -> InvokeResponseBody {
    InvokeResponseBody::Json(serde_json::to_string(msg).unwrap_or_else(|_| "{}".into()))
}

fn build_request(req: &HttpStartReq) -> Result<Request<Full<Bytes>>, String> {
    if !req.path.starts_with('/') {
        return Err(format!("bad path: {}", req.path));
    }
    let method = Method::from_bytes(req.method.trim().to_ascii_uppercase().as_bytes())
        .map_err(|_| format!("bad method: {}", req.method))?;
    let mut builder = Request::builder().method(method).uri(&req.path);
    for (k, v) in &req.headers {
        if SKIP_HEADERS.iter().any(|s| k.eq_ignore_ascii_case(s)) {
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            builder = builder.header(name, value);
        }
    }
    builder
        .header(HOST, HUB_HOST)
        .body(Full::new(Bytes::from(req.body.clone().unwrap_or_default())))
        .map_err(|e| e.to_string())
}

/// 同名头用 ", " 合并（与原 Electron 转发一致）。
fn head_of(parts: &hyper::http::response::Parts) -> HttpHead {
    let mut headers: HashMap<String, String> = HashMap::new();
    for (name, value) in &parts.headers {
        let v = String::from_utf8_lossy(value.as_bytes()).into_owned();
        headers
            .entry(name.as_str().to_string())
            .and_modify(|cur| {
                cur.push_str(", ");
                cur.push_str(&v);
            })
            .or_insert(v);
    }
    HttpHead {
        status: parts.status.as_u16(),
        status_text: parts.status.canonical_reason().unwrap_or("").to_string(),
        headers,
    }
}

async fn send_request(
    socket: &str,
    req: Request<Full<Bytes>>,
) -> Result<hyper::Response<hyper::body::Incoming>, String> {
    let stream = connect(socket)
        .await
        .map_err(|e| format!("连不上 hub：{e}"))?;
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn(async move {
        let _ = conn.await;
    });
    sender.send_request(req).await.map_err(|e| e.to_string())
}

/// 连 hub 发请求：头部交给 `head_tx`，响应体按块推到 `on_event`，最后一帧 `{t:"end"}` 或 `{t:"error"}`。
async fn pump_response(
    socket: &str,
    request: Request<Full<Bytes>>,
    head_tx: oneshot::Sender<Result<HttpHead, String>>,
    on_event: &Channel<InvokeResponseBody>,
) {
    let resp = match send_request(socket, request).await {
        Ok(resp) => resp,
        Err(e) => {
            let _ = head_tx.send(Err(e));
            return;
        }
    };
    let (parts, mut body) = resp.into_parts();
    let _ = head_tx.send(Ok(head_of(&parts)));
    loop {
        match body.frame().await {
            None => {
                let _ = on_event.send(ctl(&HttpCtl::End));
                return;
            }
            Some(Ok(frame)) => {
                if let Some(data) = frame.data_ref().filter(|d| !d.is_empty()) {
                    let _ = on_event.send(InvokeResponseBody::Raw(data.to_vec()));
                }
            }
            Some(Err(e)) => {
                let _ = on_event.send(ctl(&HttpCtl::Error {
                    message: e.to_string(),
                }));
                return;
            }
        }
    }
}

#[tauri::command]
pub async fn hub_http_start(
    hub: State<'_, Hub>,
    relays: State<'_, Relays>,
    req: HttpStartReq,
    on_event: Channel<InvokeResponseBody>,
) -> Result<HttpHead, String> {
    let request = build_request(&req)?;
    let socket = hub.ready_socket().await?;
    let (head_tx, head_rx) = oneshot::channel();
    let inner = relays.inner.clone();
    let id = req.id;

    // 持锁 spawn + 登记：任务收尾时的移除一定排在登记之后
    {
        let mut inflight = relays.inner.http.lock().unwrap();
        let task_id = id.clone();
        let task = tauri::async_runtime::spawn(async move {
            pump_response(&socket, request, head_tx, &on_event).await;
            inner.http.lock().unwrap().remove(&task_id);
        });
        inflight.insert(id, task);
    }

    head_rx.await.map_err(|_| "aborted".to_string())?
}

/// 同步命令：与后续 send/close 保持调用顺序。
#[tauri::command]
pub fn hub_http_abort(relays: State<'_, Relays>, id: String) {
    if let Some(task) = relays.inner.http.lock().unwrap().remove(&id) {
        task.abort();
    }
}

#[derive(Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum WsEvent {
    Msg { data: String },
    Close,
}

/// `ws://host/ws/terminal?x` → `/ws/terminal?x`；只放行 hub 的两条 WS 路由。
fn hub_ws_path(url: &str) -> Option<String> {
    let rest = match url.find("://") {
        Some(i) => {
            let after = &url[i + 3..];
            &after[after.find('/')?..]
        }
        None => url,
    };
    let path = rest.split('#').next().unwrap_or(rest);
    let pathname = path.split('?').next().unwrap_or(path);
    WS_PATHS.contains(&pathname).then(|| path.to_string())
}

/// 同步登记发送端，页面随后的 send 先进队列，连上后按序发出。
#[tauri::command]
pub fn hub_ws_open(
    hub: State<'_, Hub>,
    relays: State<'_, Relays>,
    id: String,
    url: String,
    on_event: Channel<WsEvent>,
) -> Result<(), String> {
    let path = hub_ws_path(&url).ok_or_else(|| format!("不支持的 WS 地址：{url}"))?;
    let (tx, rx) = mpsc::unbounded_channel::<String>();
    let gen = relays.inner.next_gen.fetch_add(1, Ordering::Relaxed);
    relays
        .inner
        .ws
        .lock()
        .unwrap()
        .insert(id.clone(), WsRelay { gen, tx });

    let hub = hub.inner().clone();
    let inner = relays.inner.clone();
    tauri::async_runtime::spawn(async move {
        let peer_closed = run_ws_relay(&hub, &path, rx, &on_event).await;
        if peer_closed {
            let _ = on_event.send(WsEvent::Close);
        }
        let mut map = inner.ws.lock().unwrap();
        if map.get(&id).is_some_and(|r| r.gen == gen) {
            map.remove(&id);
        }
    });
    Ok(())
}

/// 返回 true 表示是 hub 一侧断开（需要通知页面）；页面主动关则 false。
async fn run_ws_relay(
    hub: &Hub,
    path: &str,
    mut rx: mpsc::UnboundedReceiver<String>,
    on_event: &Channel<WsEvent>,
) -> bool {
    let connected = async {
        let socket = hub.ready_socket().await?;
        let stream = connect(&socket).await.map_err(|e| e.to_string())?;
        let request = format!("ws://{HUB_HOST}{path}")
            .into_client_request()
            .map_err(|e| e.to_string())?;
        tokio_tungstenite::client_async(request, stream)
            .await
            .map(|(ws, _)| ws)
            .map_err(|e| e.to_string())
    };
    let ws = match connected.await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[maou-app] ws {path}: {e}");
            return true;
        }
    };
    let (mut sink, mut source) = ws.split();
    loop {
        tokio::select! {
            out = rx.recv() => match out {
                Some(text) => {
                    if sink.send(Message::Text(text.into())).await.is_err() {
                        return true;
                    }
                }
                None => {
                    let _ = sink.close().await;
                    return false;
                }
            },
            inc = source.next() => match inc {
                Some(Ok(Message::Text(t))) => {
                    let _ = on_event.send(WsEvent::Msg { data: t.as_str().to_string() });
                }
                Some(Ok(Message::Binary(b))) => {
                    let _ = on_event.send(WsEvent::Msg { data: String::from_utf8_lossy(&b).into_owned() });
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return true,
                Some(Ok(_)) => {}
            },
        }
    }
}

#[tauri::command]
pub fn hub_ws_send(relays: State<'_, Relays>, id: String, data: String) {
    if let Some(relay) = relays.inner.ws.lock().unwrap().get(&id) {
        let _ = relay.tx.send(data);
    }
}

#[tauri::command]
pub fn hub_ws_close(relays: State<'_, Relays>, id: String) {
    relays.inner.ws.lock().unwrap().remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(path: &str, method: &str, headers: &[(&str, &str)]) -> HttpStartReq {
        HttpStartReq {
            id: "1".into(),
            path: path.into(),
            method: method.into(),
            headers: headers
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            body: Some("{}".into()),
        }
    }

    #[test]
    fn request_pins_host_and_drops_hop_headers() {
        let r = build_request(&req(
            "/api/meta?x=1",
            "post",
            &[
                ("Host", "evil"),
                ("Content-Length", "99"),
                ("content-type", "application/json"),
            ],
        ))
        .unwrap();
        assert_eq!(r.method(), Method::POST);
        assert_eq!(r.uri(), "/api/meta?x=1");
        assert_eq!(r.headers()[HOST], HUB_HOST);
        assert_eq!(r.headers()["content-type"], "application/json");
        assert!(r.headers().get("content-length").is_none());
    }

    #[test]
    fn request_rejects_non_path() {
        assert!(build_request(&req("http://x/api", "GET", &[])).is_err());
    }

    #[test]
    fn head_joins_duplicate_headers() {
        let resp = hyper::Response::builder()
            .status(404)
            .header("x-a", "1")
            .header("x-a", "2")
            .body(())
            .unwrap();
        let (parts, _) = resp.into_parts();
        let head = head_of(&parts);
        assert_eq!(head.status, 404);
        assert_eq!(head.status_text, "Not Found");
        assert_eq!(head.headers["x-a"], "1, 2");
    }

    #[test]
    fn ws_path_allows_only_hub_routes() {
        assert_eq!(
            hub_ws_path("ws://127.0.0.1:5173/ws/terminal").as_deref(),
            Some("/ws/terminal")
        );
        assert_eq!(
            hub_ws_path("ws://localhost/ws/agent-terminal?id=1&agent=coding").as_deref(),
            Some("/ws/agent-terminal?id=1&agent=coding")
        );
        assert_eq!(hub_ws_path("/ws/terminal").as_deref(), Some("/ws/terminal"));
        assert_eq!(hub_ws_path("ws://x/ws/other"), None);
        assert_eq!(hub_ws_path("ws://x"), None);
    }

    #[cfg(unix)]
    mod over_socket {
        use super::*;
        use std::sync::Mutex as StdMutex;
        use std::time::Duration;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::UnixListener;

        fn temp_socket(tag: &str) -> String {
            let p =
                std::env::temp_dir().join(format!("maou-proxy-{tag}-{}.sock", std::process::id()));
            let _ = std::fs::remove_file(&p);
            p.to_string_lossy().into_owned()
        }

        /// 收到的帧：raw 块记成 `raw:<utf8>`，JSON 原样。
        fn recording<T>() -> (Channel<T>, Arc<StdMutex<Vec<String>>>) {
            let log = Arc::new(StdMutex::new(Vec::new()));
            let sink = log.clone();
            let ch = Channel::new(move |body| {
                let line = match body {
                    InvokeResponseBody::Raw(b) => format!("raw:{}", String::from_utf8_lossy(&b)),
                    InvokeResponseBody::Json(j) => j,
                };
                sink.lock().unwrap().push(line);
                Ok(())
            });
            (ch, log)
        }

        #[tokio::test]
        async fn http_streams_chunks_in_order_then_end() {
            let sock = temp_socket("http");
            let listener = UnixListener::bind(&sock).unwrap();
            let server = tokio::spawn(async move {
                let (mut conn, _) = listener.accept().await.unwrap();
                let mut head = Vec::new();
                let mut buf = [0u8; 1024];
                while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                    let n = conn.read(&mut buf).await.unwrap();
                    head.extend_from_slice(&buf[..n]);
                }
                let head = String::from_utf8_lossy(&head).to_ascii_lowercase();
                conn.write_all(b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\n\r\n")
                    .await
                    .unwrap();
                for part in ["data: a\n\n", "data: b\n\n"] {
                    conn.write_all(format!("{:x}\r\n{part}\r\n", part.len()).as_bytes())
                        .await
                        .unwrap();
                    conn.flush().await.unwrap();
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                conn.write_all(b"0\r\n\r\n").await.unwrap();
                head
            });

            let (ch, log) = recording::<InvokeResponseBody>();
            let (head_tx, head_rx) = oneshot::channel();
            let request = build_request(&req("/api/chat?s=1", "GET", &[("host", "nope")])).unwrap();
            pump_response(&sock, request, head_tx, &ch).await;

            let head = head_rx.await.unwrap().unwrap();
            assert_eq!(head.status, 200);
            assert_eq!(head.headers["content-type"], "text/event-stream");
            let seen = server.await.unwrap();
            assert!(seen.starts_with("get /api/chat?s=1 http/1.1"), "{seen}");
            assert!(seen.contains("host: maou-app"), "{seen}");
            assert_eq!(
                *log.lock().unwrap(),
                vec![
                    "raw:data: a\n\n".to_string(),
                    "raw:data: b\n\n".into(),
                    r#"{"t":"end"}"#.into()
                ]
            );
            let _ = std::fs::remove_file(&sock);
        }

        #[tokio::test]
        async fn http_reports_unreachable_hub_in_the_head() {
            let (ch, log) = recording::<InvokeResponseBody>();
            let (head_tx, head_rx) = oneshot::channel();
            let request = build_request(&req("/api/meta", "GET", &[])).unwrap();
            pump_response("/nonexistent/maou.sock", request, head_tx, &ch).await;
            let err = head_rx.await.unwrap().unwrap_err();
            assert!(err.contains("连不上 hub"), "{err}");
            assert!(log.lock().unwrap().is_empty());
        }

        async fn ws_server(sock: &str) -> tokio::task::JoinHandle<Vec<String>> {
            let listener = UnixListener::bind(sock).unwrap();
            tokio::spawn(async move {
                let (conn, _) = listener.accept().await.unwrap();
                let mut ws = tokio_tungstenite::accept_async(conn).await.unwrap();
                let mut got = Vec::new();
                while let Some(Ok(msg)) = ws.next().await {
                    match msg {
                        Message::Text(t) if t.as_str() == "bye" => {
                            let _ = ws.close(None).await;
                            break;
                        }
                        Message::Text(t) => {
                            got.push(t.as_str().to_string());
                            ws.send(Message::Text(format!("echo:{}", t.as_str()).into()))
                                .await
                                .unwrap();
                        }
                        Message::Close(_) => {
                            got.push("<client-close>".into());
                            break;
                        }
                        _ => {}
                    }
                }
                got
            })
        }

        #[tokio::test]
        async fn ws_relays_both_ways_and_reports_hub_close() {
            let sock = temp_socket("ws1");
            let server = ws_server(&sock).await;
            let hub = Hub::ready_at(&sock);
            let (tx, rx) = mpsc::unbounded_channel();
            // 连上之前就排队的消息也要按序送达
            tx.send("one".to_string()).unwrap();
            tx.send("two".to_string()).unwrap();
            let (ch, log) = recording::<WsEvent>();
            let relay =
                tokio::spawn(async move { run_ws_relay(&hub, "/ws/terminal", rx, &ch).await });
            tokio::time::sleep(Duration::from_millis(100)).await;
            tx.send("bye".to_string()).unwrap();

            assert!(relay.await.unwrap(), "hub-side close must be reported");
            assert_eq!(server.await.unwrap(), vec!["one", "two"]);
            assert_eq!(
                *log.lock().unwrap(),
                vec![
                    r#"{"t":"msg","data":"echo:one"}"#.to_string(),
                    r#"{"t":"msg","data":"echo:two"}"#.into()
                ]
            );
            let _ = std::fs::remove_file(&sock);
        }

        #[tokio::test]
        async fn ws_page_close_closes_the_hub_side_quietly() {
            let sock = temp_socket("ws2");
            let server = ws_server(&sock).await;
            let hub = Hub::ready_at(&sock);
            let (tx, rx) = mpsc::unbounded_channel::<String>();
            let (ch, _log) = recording::<WsEvent>();
            let relay = tokio::spawn(async move {
                run_ws_relay(&hub, "/ws/agent-terminal?id=1", rx, &ch).await
            });
            tokio::time::sleep(Duration::from_millis(100)).await;
            drop(tx);

            assert!(
                !relay.await.unwrap(),
                "page-initiated close is not a hub close"
            );
            assert_eq!(server.await.unwrap(), vec!["<client-close>"]);
            let _ = std::fs::remove_file(&sock);
        }
    }

    #[test]
    fn ctl_frames_are_tagged() {
        let InvokeResponseBody::Json(end) = ctl(&HttpCtl::End) else {
            panic!()
        };
        assert_eq!(end, r#"{"t":"end"}"#);
        let InvokeResponseBody::Json(err) = ctl(&HttpCtl::Error {
            message: "x".into(),
        }) else {
            panic!()
        };
        assert_eq!(err, r#"{"t":"error","message":"x"}"#);
    }
}
