//! Semantic JSONL protocol (Node ↔ Rust). Paint on TTY; protocol on fd3/stderr.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProtoToolCard {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub args: String,
    #[serde(default)]
    pub result: Option<String>,
    #[serde(default)]
    pub is_error: bool,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub expanded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProtoThinking {
    pub id: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UiMessage {
    pub id: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub ts: Option<u64>,
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default, alias = "tool_cards")]
    pub tool_cards: Vec<ProtoToolCard>,
    #[serde(default, alias = "thinking")]
    pub thinking_blocks: Vec<ProtoThinking>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub round: Option<u32>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub author_label: Option<String>,
    /// Per-message usage (Ink MessageRow ↑/↓ compact).
    #[serde(default)]
    pub usage_input: Option<u64>,
    #[serde(default)]
    pub usage_output: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProtoSystemEvent {
    pub id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub ts: Option<u64>,
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToastPayload {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProtoChrome {
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub aborting: bool,
    #[serde(default)]
    pub event_mode: Option<String>,
    #[serde(default)]
    pub up_tokens: Option<u64>,
    #[serde(default)]
    pub down_tokens: Option<u64>,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub approval_mode: Option<String>,
    #[serde(default)]
    pub approval_label: Option<String>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub max_context: Option<u64>,
    #[serde(default)]
    pub used_tokens: Option<u64>,
    #[serde(default)]
    pub cache_label: Option<String>,
    /// 0–100 when cache eligible (Ink InfoBar color thresholds)
    #[serde(default)]
    pub cache_pct: Option<f64>,
    #[serde(default)]
    pub cache_eligible: bool,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub toast: Option<ToastPayload>,
    #[serde(default)]
    pub overlay: Option<String>,
    #[serde(default)]
    pub pending_count: Option<u32>,
    #[serde(default)]
    pub empty_hint: Option<String>,
    #[serde(default)]
    pub back_to_bottom: bool,
    #[serde(default)]
    pub input_placeholder: Option<String>,
    #[serde(default)]
    pub lite: bool,
    #[serde(default)]
    pub history_base: Option<u32>,
    #[serde(default)]
    pub perf_hud: bool,
    /// Ink PerfHud multi-line (cpu/mem/load/verdict)
    #[serde(default)]
    pub perf_lines: Vec<String>,
    /// "hot" | "warm" | "ok"
    #[serde(default)]
    pub perf_heat: Option<String>,
    #[serde(default)]
    pub supervisor: Option<ProtoSupervisor>,
    /// Ink eventBlockExpanded — wheel may route to supervisor scroll
    #[serde(default)]
    pub event_block_expanded: bool,
    /// Ink supervisorMessages contents (EventBlock expanded body)
    #[serde(default)]
    pub supervisor_messages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProtoSupervisor {
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub plan: Option<String>,
    #[serde(default)]
    pub verify_rounds: Option<u32>,
    #[serde(default)]
    pub last_verdict: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProtoTheme {
    #[serde(default)]
    pub bg: Option<String>,
    #[serde(default)]
    pub panel_bg: Option<String>,
    #[serde(default)]
    pub fg: Option<String>,
    #[serde(default)]
    pub muted: Option<String>,
    #[serde(default)]
    pub dim: Option<String>,
    #[serde(default)]
    pub accent: Option<String>,
    #[serde(default)]
    pub accent2: Option<String>,
    #[serde(default)]
    pub ok: Option<String>,
    #[serde(default)]
    pub warn: Option<String>,
    #[serde(default)]
    pub err: Option<String>,
    #[serde(default)]
    pub info: Option<String>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub assistant: Option<String>,
    #[serde(default)]
    pub system: Option<String>,
    #[serde(default)]
    pub tool: Option<String>,
    #[serde(default)]
    pub tool_result: Option<String>,
    #[serde(default)]
    pub user_bg: Option<String>,
    #[serde(default)]
    pub system_bg: Option<String>,
    #[serde(default)]
    pub footer_bg: Option<String>,
    #[serde(default)]
    pub input_field_bg: Option<String>,
    #[serde(default)]
    pub border: Option<String>,
    #[serde(default)]
    pub selected_bg: Option<String>,
    #[serde(default)]
    pub assistant_md_bg: Option<String>,
    #[serde(default)]
    pub md_heading: Option<String>,
    #[serde(default)]
    pub md_heading2: Option<String>,
    #[serde(default)]
    pub md_heading3: Option<String>,
    #[serde(default)]
    pub md_code: Option<String>,
    #[serde(default)]
    pub md_code_block: Option<String>,
    #[serde(default)]
    pub md_quote: Option<String>,
    #[serde(default)]
    pub md_quote_border: Option<String>,
    #[serde(default)]
    pub md_list_bullet: Option<String>,
    #[serde(default)]
    pub md_link: Option<String>,
    #[serde(default)]
    pub md_hr: Option<String>,
    #[serde(default)]
    pub tool_diff_added: Option<String>,
    #[serde(default)]
    pub tool_diff_removed: Option<String>,
    #[serde(default)]
    pub tool_diff_context: Option<String>,
    #[serde(default)]
    pub nav_agent: Option<String>,
    #[serde(default)]
    pub nav_sessions: Option<String>,
    #[serde(default)]
    pub nav_terminal: Option<String>,
    #[serde(default)]
    pub nav_todo: Option<String>,
    #[serde(default)]
    pub nav_inbox: Option<String>,
    #[serde(default)]
    pub nav_notice: Option<String>,
    #[serde(default)]
    pub nav_settings: Option<String>,
    #[serde(default)]
    pub sel_bg: Option<String>,
    #[serde(default)]
    pub sel_fg: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SelectItem {
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProtoOverlay {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub footer: String,
    #[serde(default)]
    pub items: Vec<SelectItem>,
    #[serde(default)]
    pub lines: Option<Vec<String>>,
    #[serde(default)]
    pub selected: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProtoCompletions {
    #[serde(default)]
    pub items: Vec<SelectItem>,
    #[serde(default)]
    pub sel: usize,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub range: RangeIdx,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RangeIdx {
    #[serde(default)]
    pub start: usize,
    #[serde(default)]
    pub end: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProtoTerminalApproval {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub agent_name: Option<String>,
    #[serde(default)]
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InMsg {
    Hello {
        #[serde(default)]
        product: String,
        #[serde(default)]
        model: String,
        #[serde(default)]
        agent: String,
        #[serde(default)]
        cwd: String,
    },
    State {
        #[serde(default)]
        messages: Vec<UiMessage>,
        #[serde(default)]
        streaming: bool,
        #[serde(default)]
        status: String,
        #[serde(default)]
        system_events: Vec<ProtoSystemEvent>,
        #[serde(default)]
        chrome: Option<ProtoChrome>,
        #[serde(default)]
        theme: Option<ProtoTheme>,
        #[serde(default)]
        overlay: Option<ProtoOverlay>,
        #[serde(default)]
        completions: Option<ProtoCompletions>,
        #[serde(default)]
        terminal_approval: Option<ProtoTerminalApproval>,
        #[serde(default)]
        input: Option<String>,
        #[serde(default)]
        gallery_lines: Option<Vec<String>>,
    },
    MessagesSnapshot {
        messages: Vec<UiMessage>,
        #[serde(default)]
        system_events: Vec<ProtoSystemEvent>,
    },
    Chrome {
        chrome: ProtoChrome,
    },
    Completions {
        completions: Option<ProtoCompletions>,
    },
    InputSet {
        text: String,
        #[serde(default)]
        cursor: Option<usize>,
    },
    FullEditor {
        #[serde(default)]
        text: String,
    },
    AssistantDelta {
        text: String,
        #[serde(default)]
        id: Option<String>,
    },
    ThinkingDelta {
        text: String,
        #[serde(default)]
        id: Option<String>,
    },
    UserMessage {
        text: String,
    },
    Toast {
        text: String,
        #[serde(default)]
        level: String,
    },
    Quit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OutMsg {
    Ready { version: String },
    Submit { text: String },
    Abort,
    Escape,
    Command {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        args: Option<String>,
    },
    Hotkey { key: String },
    OverlayAction {
        action: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
    InputUpdate {
        text: String,
        cursor: usize,
    },
    CompleteAccept,
    /// Set completion selection index then accept (mouse click on row).
    CompleteSelect { index: usize },
    CompleteCycle { dir: String },
    History { dir: String },
    ToolToggle {
        message_id: String,
        tool_id: String,
    },
    ThinkingToggle { id: String },
    MessageExpand { id: String },
    Approval {
        id: String,
        choice: String,
    },
    SetApprovalMode {
        #[serde(skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
    },
    OpenFullEditor,
    FullEditorDone {
        text: String,
        submit: bool,
    },
    ScreenDump {
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<String>,
        /// Rust already OSC52+toast'd with 整屏 wording — Node must not re-copy/re-toast
        #[serde(default)]
        already_copied: bool,
    },
    SoundToggle,
    ScrollToBottom,
    GoalAction { action: String },
    /// Ink toggleEventBlockExpanded
    EventBlockToggle,
    /// Ink scrollSupervisor when EventBlock expanded
    SupervisorScroll { dir: String },
    JumpPrevUser,
    Quit,
    Log { text: String },
}

pub fn emit(msg: &OutMsg) {
    if let Ok(line) = serde_json::to_string(msg) {
        eprintln!("{line}");
    }
}
