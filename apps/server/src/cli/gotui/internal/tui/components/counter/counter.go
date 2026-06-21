package counter

import (
	"fmt"

	"maou-tui/internal/tui/theme"

	"github.com/charmbracelet/lipgloss"
)

// Model is a cassette tape counter display mimicking a seven-segment digital readout.
//
//	Session ───  C-60  ▐█▌ 023:47
//	              ↑       ↑
//	           磁带长度   当前位置（第 23 轮，约 47% token 消耗）
type Model struct {
	styles    theme.Styles
	width     int
	maxRounds int    // 磁带长度 (C-60 = 60 rounds)
	round     int    // 当前轮次
	pct       int    // token 消耗百分比
	sessionID string
}

// New creates a new counter Model.
func New(s theme.Styles) Model {
	return Model{
		styles:    s,
		maxRounds: 60,
	}
}

// SetMaxRounds sets the maximum number of rounds (tape length).
func (m *Model) SetMaxRounds(max int) {
	m.maxRounds = max
}

// SetRound updates the current round.
func (m *Model) SetRound(r int) {
	m.round = r
}

// SetPct updates the token consumption percentage.
func (m *Model) SetPct(pct int) {
	if pct < 0 {
		pct = 0
	}
	if pct > 99 {
		pct = 99
	}
	m.pct = pct
}

// SetSession sets the session ID for the counter label.
func (m *Model) SetSession(id string) {
	m.sessionID = id
}

// View renders the counter. Only shows data when round > 0 or session is set.
//
//	Session d7f3 ─── R-023 (47%)
func (m Model) View() string {
	label := m.styles.CounterLabel.Render("Session")

	if m.sessionID != "" {
		short := m.sessionID
		if len(short) > 8 {
			short = short[:8]
		}
		label = m.styles.CounterLabel.Render(fmt.Sprintf("Session %s", short))
	}

	// Only show round/pct when there's real data
	position := ""
	if m.round > 0 || m.pct > 0 {
		roundStr := fmt.Sprintf("R-%03d", m.round)
		pctStr := ""
		if m.pct > 0 {
			pctStr = fmt.Sprintf(" (%d%%)", m.pct)
		}
		position = m.styles.CounterValue.Render(roundStr + pctStr)
	}

	if position == "" {
		return label
	}

	return lipgloss.JoinHorizontal(lipgloss.Left,
		label,
		m.styles.CounterLabel.Render(" ─── "),
		position,
	)
}