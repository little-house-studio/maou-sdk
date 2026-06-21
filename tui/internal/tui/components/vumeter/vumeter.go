package vumeter

import (
	"fmt"
	"strings"

	"maou-tui/internal/tui/theme"

	"github.com/charmbracelet/lipgloss"
)

// Model is a VU meter component visualizing token usage.
// Uses block-drawing characters: ▄ = filled, ░ = empty.
type Model struct {
	styles    theme.Styles
	width     int
	usedPct   float64 // 0.0 - 1.0
	label     string
	promptTok int
	totalTok  int
	maxTok    int
}

// New creates a VU meter Model.
func New(s theme.Styles) Model {
	return Model{
		styles: s,
		label:  "TOKENS",
		maxTok: 0, // will be set from config
	}
}

// SetUsage updates the token usage percentage.
func (m *Model) SetUsage(usedPct float64) {
	if usedPct < 0 {
		usedPct = 0
	}
	if usedPct > 1 {
		usedPct = 1
	}
	m.usedPct = usedPct
}

// SetTokens updates the raw token counts.
func (m *Model) SetTokens(prompt, completion, total int) {
	m.promptTok = total
	m.totalTok = total
}

// SetMaxTokens sets the maximum token capacity.
func (m *Model) SetMaxTokens(max int) {
	m.maxTok = max
}

// MaxTokens returns the current max token capacity.
func (m Model) MaxTokens() int {
	return m.maxTok
}

// SetWidth sets the available width.
func (m *Model) SetWidth(w int) {
	m.width = w
}

// View renders the VU meter as a single line:
//
//	TOKENS ▄▄▄▄▄▄░░░░  56% (128k)
func (m Model) View() string {
	barWidth := 16
	if m.width > 60 {
		barWidth = 24
	}

	filledChars := int(float64(barWidth) * m.usedPct)
	emptyChars := barWidth - filledChars

	filled := m.styles.VUMeterFilled.Render(strings.Repeat("▄", filledChars))
	empty := m.styles.VUMeterEmpty.Render(strings.Repeat("░", emptyChars))
	bar := filled + empty

	pctStr := fmt.Sprintf("%.0f%%", m.usedPct*100)
	label := m.styles.VUMeterEmpty.Render("TOKENS")

	capStr := fmt.Sprintf("(%dk)", m.maxTok/1000)
	if m.maxTok >= 1000000 {
		capStr = fmt.Sprintf("(%.1fM)", float64(m.maxTok)/1000000)
	}

	return lipgloss.JoinHorizontal(lipgloss.Left,
		label, " ", bar, "  ",
		m.styles.VUMeterEmpty.Render(pctStr),
		m.styles.VUMeterEmpty.Render(" "+capStr),
	)
}