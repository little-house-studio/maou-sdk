package chat

import (
	"fmt"
	"strings"
	"time"

	"maou-tui/internal/tui/theme"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Role represents a message role.
type Role string

const (
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
	RoleTool      Role = "tool"
	RoleSystem    Role = "system"
)

// Message represents a single chat message.
type Message struct {
	Role     Role
	Content  string
	ToolName string
	ToolOK   bool
	Time     time.Time
	Round    int
}

// MessagesModel renders messages with cassette-futurism styles.
type MessagesModel struct {
	theme    theme.Theme
	styles   theme.Styles
	viewport viewport.Model
	messages []Message
	width    int
	height   int

	// Tool card pending state
	toolPendingName string
	// Agent name for message headers
	agentName string
}

// NewMessagesModel creates a message list component.
func NewMessagesModel(t theme.Theme) MessagesModel {
	vp := viewport.New(80, 20)
	return MessagesModel{
		theme:  t,
		styles: theme.NewStyles(t),
		viewport: vp,
	}
}

// AddMessage appends a message and scrolls to bottom.
func (m *MessagesModel) AddMessage(msg Message) {
	m.messages = append(m.messages, msg)
	m.refreshContent()
	m.viewport.GotoBottom()
}

// Clear clears all messages.
func (m *MessagesModel) Clear() {
	m.messages = []Message{}
	m.refreshContent()
}

// LastAssistantContent returns the content of the last AI message (for copy).
func (m *MessagesModel) LastAssistantContent() string {
	for i := len(m.messages) - 1; i >= 0; i-- {
		if m.messages[i].Role == RoleAssistant {
			return m.messages[i].Content
		}
	}
	return ""
}

// SetAgentName sets the agent name for message header rendering.
func (m *MessagesModel) SetAgentName(name string) {
	m.agentName = name
}

// SetSize sets the component dimensions.
func (m *MessagesModel) SetSize(w, h int) {
	m.width = w
	m.height = h
	m.viewport.Width = w
	m.viewport.Height = h
}

// Update handles viewport events.
func (m MessagesModel) Update(msg tea.Msg) (MessagesModel, tea.Cmd) {
	var cmd tea.Cmd
	m.viewport, cmd = m.viewport.Update(msg)
	return m, cmd
}

// View renders the message viewport.
func (m MessagesModel) View() string {
	return m.viewport.View()
}

// ─── Content assembly ───

func (m *MessagesModel) refreshContent() {
	var sb strings.Builder

	for i, msg := range m.messages {
		if i > 0 {
			sb.WriteString("\n")
		}

		switch msg.Role {
		case RoleUser:
			sb.WriteString(m.renderUser(msg.Content))
		case RoleAssistant:
			sb.WriteString(m.renderAssistant(msg.Time, msg.Content, msg.Round))
		case RoleTool:
			sb.WriteString(m.renderTool(msg.ToolName, msg.ToolOK, msg.Content))
		case RoleSystem:
			sb.WriteString(m.renderSystem(msg.Content))
		}
	}

	m.viewport.SetContent(sb.String())
}

// ─── Renderers ───

func (m MessagesModel) contentWidth() int {
	w := m.width
	if w < 40 {
		w = 40
	}
	return w
}

// renderUser: ▸ 消息内容
//
//	▸ 你好世界
func (m MessagesModel) renderUser(content string) string {
	maxW := m.contentWidth() - 4
	prefix := m.styles.UserPrefix.Render("▸ ")
	wrapped := m.wrapLines(content, maxW)
	lines := strings.Split(wrapped, "\n")
	if len(lines) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString(prefix)
	sb.WriteString(m.styles.UserText.Render(lines[0]))
	for _, line := range lines[1:] {
		sb.WriteString("\n  ")
		sb.WriteString(m.styles.UserText.Render(line))
	}
	return sb.String()
}

// renderAssistant: cassette label card style.
//
//	┌──────────────────────────────────┐
//	│ [14:32:05]  Vampire       C-023 │
//	│ BOSS，今日的月光很适合写代码呢。    │
//	└──────────────────────────────────┘
func (m MessagesModel) renderAssistant(ts time.Time, content string, round int) string {
	maxW := m.contentWidth() - 4 // account for border + padding
	if maxW < 30 {
		maxW = 30
	}

	// Header: [HH:MM:SS]  AgentName       C-RRR
	timeStr := ts.Format("15:04:05")
	headerLeft := fmt.Sprintf("[%s]  %s", timeStr, m.agentName)
	headerRight := ""
	if round > 0 {
		headerRight = fmt.Sprintf("C-%03d", round)
	}

	headerW := maxW - 2
	if headerW < len([]rune(headerLeft+headerRight)) {
		headerW = len([]rune(headerLeft + headerRight))
	}
	gap := headerW - lipgloss.Width(headerLeft) - lipgloss.Width(headerRight)
	if gap < 0 {
		gap = 0
	}
	header := headerLeft + strings.Repeat(" ", gap) + headerRight
	headerStyled := m.styles.MsgBoxHeader.Render(header)

	// Body: wrapped content
	wrapped := m.wrapLines(content, maxW-2)
	bodyStyled := m.styles.MsgBoxBody.Render(wrapped)

	// Box everything
	inner := lipgloss.JoinVertical(lipgloss.Left, headerStyled, bodyStyled)
	return m.styles.MsgBox.Width(maxW).Render(inner)
}

// renderTool: cassette counter card style.
//
//	┌──────────────────────────┐
//	│ TOOL: read          ████ │
//	│ ✓ 读取完成 · 42 lines    │
//	└──────────────────────────┘
func (m MessagesModel) renderTool(name string, ok bool, extra string) string {
	maxW := m.contentWidth() - 4
	if maxW < 30 {
		maxW = 30
	}

	// Header: TOOL: <name> + progress block
	toolLabel := fmt.Sprintf("TOOL: %s", name)
	remainingW := maxW - lipgloss.Width(toolLabel) - 4
	if remainingW < 0 {
		remainingW = 0
	}
	progressBlock := strings.Repeat("█", remainingW)
	headerStyled := m.styles.ToolHeader.Render(toolLabel + "  " + progressBlock)

	// Status line
	var statusStyled string
	if ok {
		statusStyled = m.styles.ToolSuccess.Render("✓ " + extra)
	} else if name != "" && extra == "" {
		// Pending tool call
		statusStyled = m.styles.ToolPending.Render(strings.Repeat("·", maxW-4))
	} else {
		statusStyled = m.styles.ToolSuccess.Render(name)
	}

	inner := lipgloss.JoinVertical(lipgloss.Left, headerStyled, statusStyled)
	return m.styles.ToolBox.Width(maxW).Render(inner)
}

// renderSystem: ─── 消息 ─── with dash wrappers.
func (m MessagesModel) renderSystem(content string) string {
	return m.styles.SystemLine.Render("─── " + content + " ───")
}

// ─── Text wrapping ───

func (m MessagesModel) wrapLines(content string, width int) string {
	if width <= 0 {
		return content
	}
	var sb strings.Builder
	for pi, paragraph := range strings.Split(content, "\n") {
		if pi > 0 {
			sb.WriteString("\n")
		}
		if len(paragraph) == 0 {
			continue
		}
		runes := []rune(paragraph)
		for i := 0; i < len(runes); i += width {
			end := i + width
			if end > len(runes) {
				end = len(runes)
			}
			if i > 0 {
				sb.WriteString("\n")
			}
			sb.WriteString(string(runes[i:end]))
		}
	}
	return sb.String()
}