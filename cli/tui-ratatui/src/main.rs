//! maou-tui-ratatui — Ink-parity view shell (business logic stays in Node).

mod app;
mod layout;
mod markdown;
mod maou_logo;
mod messages;
mod mouse;
mod protocol;
mod theme;
mod vram;

use app::{poll_events, spawn_protocol_reader, App};
use crossterm::event::{
    DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture,
};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use protocol::{emit, OutMsg};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use std::fs::OpenOptions;
use std::io::{self, IsTerminal};
use std::os::fd::{AsRawFd, FromRawFd};
use std::time::Duration;

fn open_tty_writer() -> anyhow::Result<std::fs::File> {
    if let Ok(f) = OpenOptions::new().read(true).write(true).open("/dev/tty") {
        return Ok(f);
    }
    if io::stdout().is_terminal() {
        let fd = io::stdout().as_raw_fd();
        let dup = unsafe { libc::dup(fd) };
        if dup >= 0 {
            return Ok(unsafe { std::fs::File::from_raw_fd(dup) });
        }
    }
    anyhow::bail!("no /dev/tty and stdout is not a TTY");
}

fn main() -> anyhow::Result<()> {
    if !io::stdin().is_terminal() {
        eprintln!(
            "{}",
            serde_json::json!({
                "type": "log",
                "text": "stdin is not a TTY — parent must spawn with stdio[0]=inherit and protocol on MAOU_TUI_IPC_FD."
            })
        );
        std::process::exit(1);
    }

    let tty = open_tty_writer().map_err(|e| {
        eprintln!(
            "{}",
            serde_json::json!({"type":"log","text": format!("cannot open TTY: {e}")})
        );
        e
    })?;

    enable_raw_mode()?;
    let mut tty = tty;
    // EnableBracketedPaste: Event::Paste for whole blocks (Ink paste end-lock parity)
    execute!(
        tty,
        EnterAlternateScreen,
        EnableMouseCapture,
        EnableBracketedPaste
    )?;
    // Hide hardware cursor — software ▌ only (Ink)
    let _ = execute!(tty, crossterm::cursor::Hide);
    let backend = CrosstermBackend::new(tty);
    let mut terminal = Terminal::new(backend)?;

    emit(&OutMsg::Ready {
        version: env!("CARGO_PKG_VERSION").into(),
    });

    let rx = spawn_protocol_reader();
    let mut app = App::new(rx);
    let tick = Duration::from_millis(16);
    let res = run_loop(&mut terminal, &mut app, tick);

    let _ = disable_raw_mode();
    let _ = execute!(
        terminal.backend_mut(),
        DisableBracketedPaste,
        LeaveAlternateScreen,
        DisableMouseCapture,
        crossterm::cursor::Show
    );
    let _ = terminal.show_cursor();

    if let Err(e) = res {
        emit(&OutMsg::Log {
            text: format!("run error: {e}"),
        });
        return Err(e);
    }
    Ok(())
}

/// Ink restoreTerminalViewport CSI (scroll region + auto-wrap + hide cursor).
fn restore_terminal_viewport(
    terminal: &mut Terminal<CrosstermBackend<std::fs::File>>,
) -> anyhow::Result<()> {
    use std::io::Write;
    // Reset scroll region, disable left/right margin, enable wrap, home+hide
    write!(
        terminal.backend_mut(),
        "\x1b[r\x1b[?69l\x1b[?7h\x1b[1;1H\x1b[?25l"
    )?;
    terminal.backend_mut().flush()?;
    Ok(())
}

/// Ink pinHardwareCursorForIme: move *hidden* HW cursor to caret for IME candidate window.
fn pin_hardware_cursor_for_ime(
    terminal: &mut Terminal<CrosstermBackend<std::fs::File>>,
    app: &App,
) -> anyhow::Result<()> {
    if let Some((col, row)) = app.ime_pin_pos() {
        execute!(
            terminal.backend_mut(),
            crossterm::cursor::MoveTo(col, row),
            crossterm::cursor::Hide
        )?;
    } else {
        let _ = execute!(terminal.backend_mut(), crossterm::cursor::Hide);
    }
    Ok(())
}

fn run_loop(
    terminal: &mut Terminal<CrosstermBackend<std::fs::File>>,
    app: &mut App,
    tick: Duration,
) -> anyhow::Result<()> {
    while !app.should_quit {
        app.tick_input();
        app.note_frame();

        // Full redraw: invalidate ratatui previous buffer so the next paint is not
        // a sparse diff (blank regions after send/overlay/state — user workaround was resize).
        if app.take_full_redraw() {
            let _ = terminal.clear();
            let _ = restore_terminal_viewport(terminal);
        }

        // draw 后 CompletedFrame.buffer = 本帧显存（Ink lastGrid 对等）
        let completed = terminal.draw(|f| {
            let a = f.area();
            if a.width != app.screen_cols || a.height != app.screen_rows {
                // Resize already full-clears buffers, but request next-frame full for safety
                app.screen_cols = a.width;
                app.screen_rows = a.height;
            } else {
                app.screen_cols = a.width;
                app.screen_rows = a.height;
            }
            app.draw(f);
        })?;
        app.capture_vram(completed.buffer);
        // I03: after paint, note overflow; restore once when latch clears
        app.update_viewport_overflow();
        if app.take_viewport_restore() {
            let _ = restore_terminal_viewport(terminal);
            // force full repaint after viewport reset (Ink fullPaintFn)
            let _ = terminal.clear();
            let _ = terminal.draw(|f| app.draw(f));
        }
        // I02: pin hidden HW caret for IME (after any restore)
        let _ = pin_hardware_cursor_for_ime(terminal, app);
        poll_events(app, tick)?;
    }
    Ok(())
}
