//! Protocol JSONL reader (FD3 / stdin) + crossterm event poll.

use super::App;
use crate::protocol::{emit, InMsg, OutMsg};
use crossterm::event::{self, Event};
use std::io::{BufRead, BufReader};
use std::os::fd::FromRawFd;
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::Duration;

pub fn spawn_protocol_reader() -> Receiver<InMsg> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let reader = open_protocol_reader();
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            match serde_json::from_str::<InMsg>(line) {
                Ok(msg) => {
                    if tx.send(msg).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    emit(&OutMsg::Log {
                        text: format!("bad protocol line: {e}"),
                    });
                }
            }
        }
    });
    rx
}

fn open_protocol_reader() -> Box<dyn BufRead + Send> {
    if let Ok(fd_str) = std::env::var("MAOU_TUI_IPC_FD") {
        if let Ok(fd) = fd_str.parse::<i32>() {
            if fd >= 0 {
                let file = unsafe { std::fs::File::from_raw_fd(fd) };
                return Box::new(BufReader::new(file));
            }
        }
    }
    Box::new(BufReader::new(std::io::stdin()))
}

pub fn poll_events(app: &mut App, timeout: Duration) -> anyhow::Result<()> {
    // edge auto-scroll while dragging near chat edges
    app.tick_mouse_edge();
    // 鼠标/终端偶发 IO 错误不应整进程退出（会导致 Node 侧 EPIPE 闪退）
    let ready = match event::poll(timeout) {
        Ok(v) => v,
        Err(e) => {
            emit(&OutMsg::Log {
                text: format!("event poll: {e}"),
            });
            return Ok(());
        }
    };
    if !ready {
        return Ok(());
    }
    // 触控板惯性会连发大量 Scroll：每帧多 drain 一些，否则 fling 被“掐平”
    const MAX_BATCH: usize = 48;
    for n in 0..MAX_BATCH {
        if n > 0 {
            match event::poll(Duration::from_millis(0)) {
                Ok(true) => {}
                Ok(false) => break,
                Err(e) => {
                    emit(&OutMsg::Log {
                        text: format!("event poll: {e}"),
                    });
                    break;
                }
            }
        }
        match event::read() {
            Ok(Event::Key(k)) => {
                // Enhanced keyboard: ignore Release so Ctrl+C is not double-counted
                use crossterm::event::KeyEventKind;
                if k.kind == KeyEventKind::Release {
                    continue;
                }
                app.on_key(k);
            }
            Ok(Event::Mouse(m)) => app.on_mouse(m),
            Ok(Event::Paste(text)) => app.on_paste(text),
            Ok(Event::Resize(_, _)) => {
                app.request_full_redraw();
            }
            Ok(_) => {}
            Err(e) => {
                emit(&OutMsg::Log {
                    text: format!("event read: {e}"),
                });
                break;
            }
        }
    }
    Ok(())
}
