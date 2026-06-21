package tui

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"maou-tui/internal/api"
	"maou-tui/internal/tui/components/command_palette"
	"maou-tui/internal/tui/components/counter"
	"maou-tui/internal/tui/components/header"
	"maou-tui/internal/tui/components/help_dialog"
	"maou-tui/internal/tui/components/quit_dialog"
	"maou-tui/internal/tui/components/session_picker"
	"maou-tui/internal/tui/components/statusbar"
	"maou-tui/internal/tui/components/vumeter"
	"maou-tui/internal/tui/page/chat"
	"maou-tui/internal/tui/theme"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Internal messages
type (
	streamEventMsg      api.StreamEvent
	streamDoneMsg       struct{}
	streamErrMsg        struct{ err error }
	streamChanMsg       struct{ ch <-chan api.StreamEvent }
	sessionReadyMsg     struct {
		id      string
		pending string
	}
	sessionsLoadedMsg struct{ sessions []api.Session }
	usageLoadedMsg    struct{ usage *api.UsageResponse }
	configLoadedMsg   struct{ config *api.ConfigResponse }
)

// Model is the root TUI model.
type Model struct {
	client *api.Client
	theme  theme.Theme
	styles theme.Styles
	width  int
	height int
	ready  bool

	// Pages
	chatPage chat.ChatPage

	// Cassette Futurism components
	header  header.Model
	vumeter vumeter.Model
	counter counter.Model

	// Components
	statusbar     statusbar.Model
	palette       command_palette.Model
	helpDialog    help_dialog.Model
	quitDialog    quit_dialog.Model
	sessionPicker session_picker.Model

	// State
	sessionID    string
	processing   bool
	lastAI       string
	messageQueue []string
	streamCh     <-chan api.StreamEvent // active stream channel

	// 动效状态
	recBlinking   bool
	flickerActive bool
	loadingDots   int
	mode          string // "NORMAL", "AUTO", "YOLO"
	modelName     string
	round         int
	sessions      []api.Session
	sessionIndex  int // 当前会话在列表中的索引 (用于 Ctrl+←/→)
}

// New creates a new root Model.
func New(client *api.Client, t theme.Theme) Model {
	s := theme.NewStyles(t)
	return Model{
		client:        client,
		theme:         t,
		styles:        s,
		chatPage:      chat.New(t),
		header:        header.New(s),
		vumeter:       vumeter.New(s),
		counter:       counter.New(s),
		statusbar:     statusbar.New(s),
		palette:       command_palette.New(s),
		helpDialog:    help_dialog.New(s),
		quitDialog:    quit_dialog.New(s),
		sessionPicker: session_picker.New(s),
		mode:       "NORMAL",
		modelName:  "...",
	}
}

// Init implements tea.Model.
func (m Model) Init() tea.Cmd {
	return tea.Batch(
		m.chatPage.Focus(),
		m.statusbar.Init(),
		m.loadSessionsCmd(),
		m.loadConfigCmd(),
	)
}

// Update implements tea.Model.
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.ready = true
		m.resizeAll()
		return m, nil

	case tea.KeyMsg:
		return m.handleKey(msg)

	// --- Streaming ---
	case streamChanMsg:
		m.streamCh = msg.ch
		return m, m.waitForStreamEvent(msg.ch)

	case streamEventMsg:
		return m.handleStreamEvent(msg)

	case streamDoneMsg:
		m.processing = false
		m.recBlinking = false
		m.flickerActive = false
		m.chatPage.Editor.SetRecording(false)
		m.statusbar.SetProcessing(false)
		m.statusbar.SetFlicker(false)
		m.drainQueue()
		return m, nil

	case streamErrMsg:
		m.processing = false
		m.recBlinking = false
		m.flickerActive = false
		m.chatPage.Editor.SetRecording(false)
		m.statusbar.SetProcessing(false)
		m.statusbar.SetFlicker(false)
		m.chatPage.AddSystemMsg(fmt.Sprintf("Error: %v", msg.err))
		m.drainQueue()
		return m, nil

	case sessionReadyMsg:
		m.sessionID = msg.id
		m.header.SetSession(msg.id)
		m.counter.SetSession(msg.id)
		m.statusbar.SetSession(msg.id)
		if msg.pending != "" {
			return m, m.sendToAPI(msg.pending)
		}
		return m, nil

	case sessionsLoadedMsg:
		m.sessions = msg.sessions
		m.sessionPicker.SetSessions(msg.sessions)
		for i, s := range m.sessions {
			if s.ID == m.sessionID {
				m.sessionIndex = i
				// 从 session 获取真实 agent 名
				if s.AgentName != "" {
					m.chatPage.Messages.SetAgentName(s.AgentName)
					m.header.SetAgent(s.AgentName)
				}
				break
			}
		}
		return m, nil

	case usageLoadedMsg:
		if msg.usage != nil {
			used := msg.usage.PromptTokens + msg.usage.CompletionTokens
			// Use the model name from usage response if available
			if msg.usage.Model != "" {
				m.modelName = msg.usage.Model
				m.statusbar.SetModel(msg.usage.Model)
			}
			total := m.vumeter.MaxTokens()
			if total == 0 {
				total = 1000000
			}
			pct := float64(used) / float64(total)
			m.vumeter.SetUsage(pct)
			m.vumeter.SetTokens(msg.usage.PromptTokens, msg.usage.CompletionTokens, total)
			m.statusbar.SetTokens(used, total)
			m.counter.SetPct(int(pct * 100))
		}
		return m, nil

	case configLoadedMsg:
		if msg.config != nil {
			defaultName := msg.config.User.API.Default
			if preset, ok := msg.config.User.API.CustomPresets[defaultName]; ok {
				m.modelName = preset.Model
				m.statusbar.SetModel(preset.Model)
				if preset.MaxTokens > 0 {
					m.vumeter.SetMaxTokens(preset.MaxTokens)
				}
			}
			// 从项目配置读取最大轮次
			maxRounds := msg.config.Project.Permissions.MaxRoundsPerRun
			if maxRounds > 0 {
				m.counter.SetMaxRounds(maxRounds)
			}
		}
		return m, nil

	// --- Animation messages ---
	case flickerMsg:
		m.flickerActive = !m.flickerActive
		m.statusbar.SetFlicker(m.flickerActive)
		if m.flickerActive {
			return m, flickerCmd()
		}
		return m, nil

	case recBlinkMsg:
		m.recBlinking = !m.recBlinking
		m.chatPage.Editor.SetRecording(m.recBlinking)
		if m.processing {
			return m, recBlinkCmd()
		}
		return m, nil

	case loadingDotsMsg:
		m.loadingDots = msg.dots%3 + 1
		return m, loadingDotsCmd(m.loadingDots)

	case counterTickMsg:
		m.round++
		m.counter.SetRound(m.round)
		m.header.SetRound(m.round)
		return m, counterTickCmd()

	case errorFlashMsg:
		if msg.count > 0 {
			m.statusbar.SetFlicker(true)
			return m, func() tea.Msg {
				return errorFlashMsg{count: msg.count - 1}
			}
		}
		m.statusbar.SetFlicker(false)
		return m, nil

	// --- Editor F-Key messages ---
	case chat.EditorFKeyMsg:
		switch msg.Key {
		case "F1":
			m.helpDialog.Toggle()
		case "F2":
			return m, m.executeCommand("/new")
		case "F3":
			return m, m.executeCommand("/plan")
		case "F4":
			if m.sessionID != "" {
				return m, m.loadUsage()
			}
			m.chatPage.AddSystemMsg("No active session.")
		case "F5":
			m.chatPage.AddSystemMsg("Variables: not yet implemented.")
		}
		return m, nil

	// --- Session navigation from palette ---
	case command_palette.SessionNavMsg:
		m.navigateSession(msg.Direction)
		return m, m.loadSessionsCmd()

	// --- Quit confirmation ---
	case quit_dialog.QuitMsg:
		return m, tea.Quit
	}

	// Delegate to sub-components
	var cmd tea.Cmd
	m.chatPage, cmd = m.chatPage.Update(msg)
	if cmd != nil {
		cmds = append(cmds, cmd)
	}
	m.statusbar, cmd = m.statusbar.Update(msg)
	if cmd != nil {
		cmds = append(cmds, cmd)
	}
	return m, tea.Batch(cmds...)
}

// --- Streaming ---

func (m *Model) waitForStreamEvent(ch <-chan api.StreamEvent) tea.Cmd {
	return func() tea.Msg {
		event, ok := <-ch
		if !ok {
			return streamDoneMsg{}
		}
		return streamEventMsg(event)
	}
}

func (m *Model) sendToAPI(text string) tea.Cmd {
	return func() tea.Msg {
		ch, err := m.client.Run(m.sessionID, text)
		if err != nil {
			return streamErrMsg{err: err}
		}
		return streamChanMsg{ch: ch}
	}
}

func (m *Model) handleStreamEvent(event streamEventMsg) (tea.Model, tea.Cmd) {
	switch event.Type {
	case "assistant_delta":
		text := event.Delta
		if text == "" {
			text = event.Content
		}
		m.chatPage.AddAssistantDelta(text)
	case "assistant":
		m.chatPage.SetAssistantFinal(event.Content)
		m.lastAI = event.Content
	case "tool_call":
		toolName := extractToolName(event)
		m.chatPage.AddToolCall(toolName)
	case "tool_result":
		toolName := extractToolName(event)
		ok := event.OK != nil && *event.OK
		m.chatPage.AddToolResult(toolName, ok)
	case "status":
		if event.Content != "" {
			m.chatPage.AddSystemMsg(event.Content)
		}
	case "error":
		m.chatPage.AddSystemMsg(fmt.Sprintf("Error: %s", event.Message))
		m.processing = false
		m.recBlinking = false
		m.flickerActive = false
		m.chatPage.Editor.SetRecording(false)
		m.statusbar.SetProcessing(false)
		m.statusbar.SetFlicker(false)
		return m, nil
	case "done":
		m.processing = false
		m.recBlinking = false
		m.flickerActive = false
		m.chatPage.Editor.SetRecording(false)
		m.statusbar.SetProcessing(false)
		m.statusbar.SetFlicker(false)
		m.streamCh = nil
		return m, nil
	}
	// Continue reading the next event from the stream
	if m.streamCh != nil {
		return m, m.waitForStreamEvent(m.streamCh)
	}
	return m, nil
}

func extractToolName(event streamEventMsg) string {
	if event.Content != "" {
		return event.Content
	}
	return "tool"
}

// --- Session navigation ---

func (m *Model) navigateSession(direction int) {
	if len(m.sessions) == 0 {
		return
	}
	m.sessionIndex += direction
	if m.sessionIndex < 0 {
		m.sessionIndex = len(m.sessions) - 1
	}
	if m.sessionIndex >= len(m.sessions) {
		m.sessionIndex = 0
	}
	oldID := m.sessionID
	m.sessionID = m.sessions[m.sessionIndex].ID
	m.chatPage.AddSystemMsg(fmt.Sprintf("Switched to session %s", m.sessionID[:8]))
	m.header.SetSession(m.sessionID)
	m.counter.SetSession(m.sessionID)
	m.statusbar.SetSession(m.sessionID)
	if oldID != m.sessionID {
		// TODO: 加载新会话的历史消息
		m.chatPage.Clear()
		m.chatPage.AddSystemMsg(fmt.Sprintf("Session: %s", m.sessionID[:8]))
	}
}

// --- Key handling ---

func (m Model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.Type {
	case tea.KeyCtrlC:
		if m.processing {
			m.processing = false
			m.recBlinking = false
			m.chatPage.Editor.SetRecording(false)
			m.statusbar.SetProcessing(false)
			m.statusbar.SetFlicker(false)
			return m, nil
		}
		m.quitDialog.Show()
		return m, nil
	case tea.KeyCtrlP:
		m.palette.Toggle()
		return m, nil
	case tea.KeyCtrlH:
		m.helpDialog.Toggle()
		return m, nil
	case tea.KeyF1:
		m.helpDialog.Toggle()
		return m, nil
	case tea.KeyCtrlS:
		m.sessionPicker.Toggle()
		if m.sessionPicker.Visible() {
			return m, m.loadSessionsCmd()
		}
		return m, nil
	case tea.KeyCtrlN:
		return m, m.executeCommand("/new")
	case tea.KeyCtrlL:
		m.chatPage.ToggleSidebar()
		m.resizeAll()
		return m, nil
	case tea.KeyCtrlLeft:
		// 倒带：上一个会话
		m.navigateSession(-1)
		return m, m.loadSessionsCmd()
	case tea.KeyCtrlRight:
		// 快进：下一个会话
		m.navigateSession(1)
		return m, m.loadSessionsCmd()
	case tea.KeyCtrlY:
		// 复制最后 AI 响应
		if m.lastAI != "" {
			copyToClipboard(m.lastAI)
			m.chatPage.AddSystemMsg("Copied last AI response.")
		}
		return m, nil
	}

	// Ctrl+Shift+C for copy
	if msg.Type == tea.KeyCtrlC && msg.Alt {
		if m.lastAI != "" {
			copyToClipboard(m.lastAI)
			m.chatPage.AddSystemMsg("Copied last AI response.")
		}
		return m, nil
	}

	// Overlays
	if m.quitDialog.Visible() {
		var cmd tea.Cmd
		m.quitDialog, cmd = m.quitDialog.Update(msg)
		return m, cmd
	}
	if m.palette.Visible() {
		return m.handlePalette(msg)
	}
	if m.helpDialog.Visible() {
		var cmd tea.Cmd
		m.helpDialog, cmd = m.helpDialog.Update(msg)
		return m, cmd
	}
	if m.sessionPicker.Visible() {
		return m.handleSessionPicker(msg)
	}

	return m.handleChatInput(msg)
}

func (m Model) handlePalette(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	m.palette, cmd = m.palette.Update(msg)

	switch msg.Type {
	case tea.KeyEnter:
		if sel := m.palette.Selected(); sel != nil {
			m.palette.Hide()
			return m, m.executeCommand(sel.Name)
		}
	case tea.KeyEsc:
		m.palette.Hide()
		return m, nil
	}

	return m, cmd
}

func (m Model) handleSessionPicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	m.sessionPicker, cmd = m.sessionPicker.Update(msg)
	if msg.Type == tea.KeyEnter {
		if sel := m.sessionPicker.Selected(); sel != nil {
			m.sessionPicker.Hide()
			m.sessionID = sel.ID
			m.header.SetSession(sel.ID)
			m.counter.SetSession(sel.ID)
			m.statusbar.SetSession(sel.ID)
			m.chatPage.AddSystemMsg(fmt.Sprintf("Switched to session %s", sel.ID[:8]))
		}
		return m, nil
	}
	return m, cmd
}

func (m Model) handleChatInput(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if msg.Type == tea.KeyEnter && !msg.Alt {
		if m.processing {
			text := strings.TrimSpace(m.chatPage.Editor.Value())
			if text != "" {
				m.messageQueue = append(m.messageQueue, text)
				m.chatPage.Editor.Reset()
				m.chatPage.AddSystemMsg(fmt.Sprintf("Queued (%d)", len(m.messageQueue)))
			}
			return m, nil
		}
		return m, m.sendMessage()
	}
	var cmd tea.Cmd
	m.chatPage, cmd = m.chatPage.Update(msg)
	return m, cmd
}

func (m *Model) sendMessage() tea.Cmd {
	text, isCommand, cmdName := m.chatPage.SendMessage()
	if text == "" {
		return nil
	}
	if isCommand {
		return m.executeCommand(cmdName)
	}
	m.chatPage.AddMessage(chat.Message{Role: chat.RoleUser, Content: text, Time: now()})
	m.processing = true
	m.recBlinking = true
	m.flickerActive = true
	m.round++
	m.chatPage.Editor.SetRecording(true)
	m.statusbar.SetProcessing(true)
	m.statusbar.SetFlicker(true)
	m.header.SetRound(m.round)
	m.counter.SetRound(m.round)

	// Start animations
	var cmds []tea.Cmd
	cmds = append(cmds, flickerCmd())
	cmds = append(cmds, recBlinkCmd())
	cmds = append(cmds, counterTickCmd())

	if m.sessionID == "" {
		cmds = append(cmds, m.ensureSession(text))
		return tea.Batch(cmds...)
	}
	cmds = append(cmds, m.sendToAPI(text))
	return tea.Batch(cmds...)
}

func (m *Model) executeCommand(cmd string) tea.Cmd {
	switch cmd {
	case "/new":
		m.sessionID = ""
		m.round = 0
		m.header.SetSession("")
		m.header.SetRound(0)
		m.counter.SetSession("")
		m.counter.SetRound(0)
		m.statusbar.SetSession("")
		m.chatPage.Clear()
		m.chatPage.AddSystemMsg("New session created.")
	case "/clear":
		m.chatPage.Clear()
	case "/help":
		m.helpDialog.Show()
	case "/exit":
		m.quitDialog.Show()
	case "/token":
		if m.sessionID != "" {
			return m.loadUsage()
		}
		m.chatPage.AddSystemMsg("No active session.")
	case "/plan":
		m.chatPage.AddSystemMsg("Plan mode: describe your task and I'll create a plan.")
	case "/yolo":
		m.mode = "YOLO"
		m.header.SetMode("YOLO")
		m.statusbar.SetMode("YOLO")
		m.chatPage.AddSystemMsg("YOLO mode enabled.")
	case "/auto":
		m.mode = "AUTO"
		m.header.SetMode("AUTO")
		m.statusbar.SetMode("AUTO")
		m.chatPage.AddSystemMsg("Auto mode enabled.")
	case "refresh":
		m.chatPage.AddSystemMsg("Refreshing prompts...")
		go m.client.Refresh()
	default:
		m.chatPage.AddSystemMsg(fmt.Sprintf("Unknown: %s", cmd))
	}
	return nil
}

// --- API helpers ---

func (m *Model) ensureSession(pending string) tea.Cmd {
	return func() tea.Msg {
		sessions, err := m.client.Sessions()
		if err == nil && len(sessions) > 0 {
			return sessionReadyMsg{id: sessions[0].ID, pending: pending}
		}
		sess, err := m.client.CreateSession("TUI Session", "main")
		if err != nil {
			return streamErrMsg{err: err}
		}
		return sessionReadyMsg{id: sess.ID, pending: pending}
	}
}

func (m *Model) loadSessionsCmd() tea.Cmd {
	return func() tea.Msg {
		sessions, err := m.client.Sessions()
		if err != nil {
			return streamErrMsg{err: err}
		}
		return sessionsLoadedMsg{sessions: sessions}
	}
}

// loadConfigCmd fetches the user config from the backend.
func (m *Model) loadConfigCmd() tea.Cmd {
	return func() tea.Msg {
		cfg, err := m.client.Config()
		if err != nil {
			return configLoadedMsg{} // silently fail
		}
		return configLoadedMsg{config: cfg}
	}
}

func (m *Model) loadUsage() tea.Cmd {
	return func() tea.Msg {
		usage, err := m.client.Usage(m.sessionID)
		if err != nil {
			return streamErrMsg{err: err}
		}
		return usageLoadedMsg{usage: usage}
	}
}

func (m *Model) drainQueue() {
	if len(m.messageQueue) > 0 {
		next := m.messageQueue[0]
		m.messageQueue = m.messageQueue[1:]
		m.processing = true
		m.recBlinking = true
		m.flickerActive = true
		m.chatPage.Editor.SetRecording(true)
		m.statusbar.SetProcessing(true)
		m.statusbar.SetFlicker(true)
		m.chatPage.AddMessage(chat.Message{Role: chat.RoleUser, Content: next, Time: now()})
	}
}

func (m *Model) resizeAll() {
	headerH := 2  // header box
	editorH := 4  // REC box (3) + func keys (1)
	counterH := 1 // counter + vu meter row
	statusH := 1 // single-line status bar
	dividersH := 4 // ═══ after header + ─── × 3 between sections

	messagesH := m.height - headerH - editorH - counterH - statusH - dividersH
	if messagesH < 5 {
		messagesH = 5
	}

	m.header.SetWidth(m.width)
	m.chatPage.SetSize(m.width, messagesH)
	m.vumeter.SetWidth(m.width)
	m.statusbar.SetWidth(m.width)
	m.palette.SetSize(m.width, m.height)
	m.helpDialog.SetSize(m.width, m.height)
	m.quitDialog.SetSize(m.width, m.height)
	m.sessionPicker.SetSize(m.width, m.height)
}

// View implements tea.Model.
func (m Model) View() string {
	if !m.ready {
		return "Initializing..."
	}

	// Overlays
	if m.quitDialog.Visible() {
		return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, m.quitDialog.View())
	}
	if m.helpDialog.Visible() {
		return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, m.helpDialog.View())
	}
	if m.palette.Visible() {
		return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, m.palette.View())
	}
	if m.sessionPicker.Visible() {
		return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, m.sessionPicker.View())
	}

	// ─── 磁带未来主义布局 ───
	//
	// Header (Agent + Session + Uptime + Mode)
	// ═══════════════════════════════════════════
	// Messages Viewport (70%+)
	// ───────────────────────────────────────────
	// Counter + VU Meter
	// ───────────────────────────────────────────
	// Status: SESSION │ MODEL │ TOKENS │ MODE
	// ───────────────────────────────────────────
	// Input: REC 录音键区 + 功能键行

	divDouble := m.styles.DividerDouble.Render(strings.Repeat("═", m.width))
	divSingle := m.styles.DividerSingle.Render(strings.Repeat("─", m.width))

	headerView := m.header.View()
	chatView := m.chatPage.View()
	editorView := m.chatPage.Editor.View()

	counterView := m.counter.View()
	vumeterView := m.vumeter.View()
	metricsRow := lipgloss.JoinHorizontal(lipgloss.Left, counterView, "    ", vumeterView)

	statusView := m.statusbar.View()

	return lipgloss.JoinVertical(lipgloss.Left,
		headerView,
		divDouble,
		chatView,
		divSingle,
		metricsRow,
		divSingle,
		statusView,
		divSingle,
		editorView,
	)
}

func copyToClipboard(text string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("pbcopy")
	case "linux":
		cmd = exec.Command("xclip", "-selection", "clipboard")
	case "windows":
		cmd = exec.Command("clip")
	default:
		return
	}
	cmd.Stdin = strings.NewReader(text)
	cmd.Run()
}

// now returns the current time (convenience wrapper for testing).
func now() time.Time { return time.Now() }