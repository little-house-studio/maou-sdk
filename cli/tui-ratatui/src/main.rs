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
use std::io::{self, IsTerminal, Write};
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd};
use std::time::Duration;

/// Terminal Synchronized Update (DECSET 2026)：整帧缓冲后再呈现，减轻滚动「果冻/撕裂」。
/// Kitty / WezTerm / iTerm2 / Ghostty 等支持；不支持的终端会忽略。
fn sync_update_begin(terminal: &mut Terminal<CrosstermBackend<std::fs::File>>) {
    let _ = write!(terminal.backend_mut(), "\x1b[?2026h");
}
fn sync_update_end(terminal: &mut Terminal<CrosstermBackend<std::fs::File>>) {
    let _ = write!(terminal.backend_mut(), "\x1b[?2026l");
    let _ = terminal.backend_mut().flush();
}

fn open_tty_writer() -> anyhow::Result<std::fs::File> {
    // Unix: prefer /dev/tty so drawing is independent of redirected stdout
    #[cfg(unix)]
    {
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
    #[cfg(windows)]
    {
        // Windows: CONOUT$ is the console output device (no /dev/tty)
        if let Ok(f) = OpenOptions::new().read(true).write(true).open("CONOUT$") {
            return Ok(f);
        }
        if io::stdout().is_terminal() {
            // Fallback: reopen stdout handle path is limited; try CON
            if let Ok(f) = OpenOptions::new().write(true).open("CON") {
                return Ok(f);
            }
        }
        anyhow::bail!("no CONOUT$ and stdout is not a TTY (use MAOU_TUI=ink on Windows if this fails)");
    }
}

/// Windows: 设置控制台代码页为 UTF-8 (CP65001)，避免中文乱码导致视觉爆闪
#[cfg(windows)]
fn set_console_utf8() {
    use std::ffi::c_int;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetConsoleOutputCP() -> c_int;
        fn SetConsoleOutputCP(wCodePageID: c_int) -> c_int;
        fn GetConsoleCP() -> c_int;
        fn SetConsoleCP(wCodePageID: c_int) -> c_int;
    }
    unsafe {
        let cp_out = GetConsoleOutputCP();
        let cp_in = GetConsoleCP();
        if cp_out != 65001 {
            SetConsoleOutputCP(65001);
        }
        if cp_in != 65001 {
            SetConsoleCP(65001);
        }
    }
}
#[cfg(not(windows))]
fn set_console_utf8() {}

fn main() -> anyhow::Result<()> {
    set_console_utf8();
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
    execute!(
        tty,
        EnterAlternateScreen,
        EnableMouseCapture,
        EnableBracketedPaste
    )?;
    let _ = execute!(tty, crossterm::cursor::Hide);
    let backend = CrosstermBackend::new(tty);
    let mut terminal = Terminal::new(backend)?;

    emit(&OutMsg::Ready {
        version: env!("CARGO_PKG_VERSION").into(),
    });

    let rx = spawn_protocol_reader();
    let mut app = App::new(rx);
    // 33ms tick → ~30fps（减少闪烁，终端不需要 60fps）
    let tick = Duration::from_millis(33);
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

fn restore_terminal_viewport(
    terminal: &mut Terminal<CrosstermBackend<std::fs::File>>,
) -> anyhow::Result<()> {
    use std::io::Write;
    write!(
        terminal.backend_mut(),
        "\x1b[r\x1b[?69l\x1b[?7h\x1b[1;1H\x1b[?25l"
    )?;
    terminal.backend_mut().flush()?;
    Ok(())
}

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

/// 主循环对齐 09bd0cc 热路径：
/// tick_input → (轻量 clear 若需) → **单次** draw → capture(选中时) → poll。
/// 禁止 hard_full_paint 双 draw / CSI Purge（那是 7fps 主因）。
fn run_loop(
    terminal: &mut Terminal<CrosstermBackend<std::fs::File>>,
    app: &mut App,
    tick: Duration,
) -> anyhow::Result<()> {
    let mut draw_errors: u32 = 0;
    while !app.should_quit {
        app.tick_input();
        app.note_frame();

        // 轻量 full redraw：只 reset ratatui 双缓冲，不双 paint、不 Purge
        if app.take_full_redraw() {
            let _ = terminal.clear();
            let _ = restore_terminal_viewport(terminal);
        }

        // 同步更新：本帧全部 CSI 写完再让终端合成一帧（类垂直同步）
        sync_update_begin(terminal);
        let draw_res = terminal.draw(|f| {
            let a = f.area();
            app.screen_cols = a.width;
            app.screen_rows = a.height;
            app.draw(f);
        });
        match draw_res {
            Ok(completed) => {
                app.capture_vram(completed.buffer);
                draw_errors = 0;
            }
            Err(e) => {
                draw_errors = draw_errors.saturating_add(1);
                if draw_errors <= 3 {
                    emit(&OutMsg::Log {
                        text: format!("draw: {e}"),
                    });
                }
                // 连续错误超过 5 次时停止 full redraw，避免爆闪循环
                if draw_errors <= 5 {
                    app.request_full_redraw();
                }
            }
        }
        sync_update_end(terminal);

        app.update_viewport_overflow();
        if app.take_viewport_restore() {
            let _ = restore_terminal_viewport(terminal);
            let _ = terminal.clear();
            sync_update_begin(terminal);
            let _ = terminal.draw(|f| app.draw(f));
            sync_update_end(terminal);
        }
        let _ = pin_hardware_cursor_for_ime(terminal, app);

        // 批量 drain 输入（最多 16），超时 tick 保持 idle ~30fps
        if let Err(e) = poll_events(app, tick) {
            emit(&OutMsg::Log {
                text: format!("poll_events: {e}"),
            });
        }
    }
    Ok(())
}
