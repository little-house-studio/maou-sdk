//! OSC52 clipboard + system clipboard (arboard) + terminal pointer shape.

use std::io::Write;

use base64::Engine;

pub fn osc52_copy(text: &str) {
    if text.is_empty() {
        return;
    }

    // 1) OSC52 — works over SSH / remote terminals (keep custom, not arboard).
    let b64 = base64::engine::general_purpose::STANDARD.encode(text.as_bytes());
    let payload = format!("\x1b]52;c;{b64}\x07");
    let seq = if std::env::var_os("TMUX").is_some() {
        let escaped = payload.replace('\x1b', "\x1b\x1b");
        format!("\x1bPtmux;\x1b{escaped}\x1b\\")
    } else {
        payload
    };
    if let Ok(mut f) = std::fs::OpenOptions::new().write(true).open("/dev/tty") {
        let _ = f.write_all(seq.as_bytes());
        let _ = f.flush();
    } else {
        let _ = std::io::stdout().write_all(seq.as_bytes());
        let _ = std::io::stdout().flush();
    }

    // 2) System clipboard — arboard (macOS pasteboard / X11 / Wayland / Win).
    //    Best-effort: headless or restricted envs may fail silently.
    if let Ok(mut cb) = arboard::Clipboard::new() {
        let _ = cb.set_text(text);
    }
}

/// Ink `osc22Supported`: skip OSC 22 on known-broken TERM_PROGRAM / LITE.
fn osc22_supported() -> bool {
    if std::env::var_os("MAOU_LITE").is_some() {
        return false;
    }
    let prog = std::env::var("TERM_PROGRAM").unwrap_or_default();
    // Ink OSC22_UNSUPPORTED_PROGRAMS
    !matches!(
        prog.as_str(),
        "Apple_Terminal" | "vscode" | "vscode-insiders" | "WezTerm" | "Hyper" | "Windows Terminal"
    )
}

pub fn set_pointer_shape(shape: &str) {
    if !osc22_supported() {
        return;
    }
    let seq = format!("\x1b]22;{shape}\x07");
    if let Ok(mut f) = std::fs::OpenOptions::new().write(true).open("/dev/tty") {
        let _ = f.write_all(seq.as_bytes());
        let _ = f.flush();
    }
}
