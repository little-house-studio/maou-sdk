package header

import (
	"fmt"
	"strings"
	"time"

	"maou-tui/internal/tui/theme"

	"github.com/charmbracelet/lipgloss"
)

// Model is the top header bar showing agent name, context, and mode.
// Maximum 2 lines. Separated from body by a double-line (═══).
type Model struct {
	styles     theme.Styles
	width      int
	ready      bool

	agentName  string
	mode       string // "NORMAL", "AUTO", "YOLO"
	sessionID  string
	round      int
	startTime  time.Time
}

// New creates a new header Model.
func New(s theme.Styles) Model {
	return Model{
		styles:    s,
		agentName: "MAOU",
		mode:      "NORMAL",
		startTime: time.Now(),
	}
}

// SetAgent sets the agent name displayed in the header.
func (m *Model) SetAgent(name string) {
	m.agentName = name
}

// SetMode sets the current mode (NORMAL / AUTO / YOLO).
func (m *Model) SetMode(mode string) {
	m.mode = mode
}

// SetSession sets the session ID.
func (m *Model) SetSession(id string) {
	m.sessionID = id
}

// SetRound updates the current round number.
func (m *Model) SetRound(r int) {
	m.round = r
}

// SetWidth updates the available width.
func (m *Model) SetWidth(w int) {
	m.width = w
	m.ready = true
}

// Init marks the header as ready.
func (m Model) Init() Model {
	m.ready = true
	return m
}

// View renders the header bar.
//
//	┌────────────────────────────────────────────────────┐
//	│ MAOU Agent · 会话 d7f3a2e1 · 上线 0:23:47 · NORMAL │
//	└────────────────────────────────────────────────────┘
func (m Model) View() string {
	if !m.ready || m.width < 10 {
		return ""
	}

	// Agent name section
	agentText := m.styles.MsgBoxHeader.Render(m.agentName)

	// Session section
	sessText := ""
	if m.sessionID != "" {
		shortID := m.sessionID
		if len(shortID) > 8 {
			shortID = shortID[:8]
		}
		sessText = m.styles.MsgBoxHeader.Render(fmt.Sprintf("· 会话 %s", shortID))
	}

	// Uptime
	uptime := time.Since(m.startTime).Truncate(time.Second)
	hours := int(uptime.Hours())
	minutes := int(uptime.Minutes()) % 60
	seconds := int(uptime.Seconds()) % 60
	uptimeText := m.styles.MsgBoxHeader.Render(fmt.Sprintf("· 上线 %d:%02d:%02d", hours, minutes, seconds))

	// Round counter
	roundText := ""
	if m.round > 0 {
		roundText = m.styles.MsgBoxHeader.Render(fmt.Sprintf("· C-%03d", m.round))
	}

	// Mode indicator
	var modeStyle lipgloss.Style
	switch m.mode {
	case "YOLO":
		modeStyle = m.styles.StatusModeYolo
	case "AUTO":
		modeStyle = m.styles.StatusModeAuto
	default:
		modeStyle = m.styles.StatusModeNorm
	}
	modeText := modeStyle.Render(fmt.Sprintf("· %s", m.mode))

	// Build header content
	parts := []string{agentText}
	if sessText != "" {
		parts = append(parts, sessText)
	}
	parts = append(parts, uptimeText)
	if roundText != "" {
		parts = append(parts, roundText)
	}
	parts = append(parts, modeText)

	headerContent := strings.Join(parts, " ")

	// Box it
	w := m.width - 2
	if w < len([]rune(headerContent)) {
		w = len([]rune(headerContent))
	}

	return m.styles.MsgBox.Width(w).Render(headerContent)
}

// Divider renders the double-line separator below the header.
func (m Model) Divider() string {
	if m.width < 10 {
		return ""
	}
	return m.styles.DividerDouble.Render(strings.Repeat("═", m.width))
}