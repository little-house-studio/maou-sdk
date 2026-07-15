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
    if !event::poll(timeout)? {
        return Ok(());
    }
    match event::read()? {
        Event::Key(k) => app.on_key(k),
        Event::Mouse(m) => app.on_mouse(m),
        Event::Paste(text) => app.on_paste(text),
        Event::Resize(_, _) => {}
        _ => {}
    }
    Ok(())
}
