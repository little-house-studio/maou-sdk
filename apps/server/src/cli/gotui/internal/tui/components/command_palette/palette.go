package command_palette

import (
	"strings"

	"maou-tui/internal/tui/theme"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// SessionNavMsg is sent when the user navigates sessions in the palette.
type SessionNavMsg struct {
	Direction int // -1 = prev, +1 = next
}

// Command represents a single command entry.
type Command struct {
	Name        string // e.g. "/new"
	Description string // e.g. "New session"
	Key         string // shortcut hint e.g. "ctrl+n"
}

// defaultCommands is the built-in command list.
var defaultCommands = []Command{
	{Name: "/new", Description: "New session", Key: "ctrl+n"},
	{Name: "/clear", Description: "Clear screen", Key: ""},
	{Name: "/help", Description: "Show help", Key: "ctrl+h"},
	{Name: "/exit", Description: "Quit", Key: "ctrl+c"},
	{Name: "/raw", Description: "Toggle raw mode", Key: ""},
	{Name: "/token", Description: "Show token usage", Key: ""},
	{Name: "/var", Description: "Show variables", Key: ""},
	{Name: "/role", Description: "Switch role", Key: ""},
	{Name: "/plan", Description: "Show plan", Key: ""},
	{Name: "/yolo", Description: "Toggle auto-approve", Key: ""},
	{Name: "/auto", Description: "Toggle auto-mode", Key: ""},
	{Name: "/init-agent", Description: "Initialize agent", Key: ""},
	{Name: "/settings", Description: "Open settings", Key: ""},
	{Name: "refresh", Description: "Refresh prompts", Key: ""},
	{Name: "compress", Description: "Compress context", Key: ""},
}

// Model is the command palette overlay with transport key row.
//
//	┌───────────────────────────────────────────────┐
//	│ Commands                                      │
//	│                                               │
//	│ > /new──────────────────────────────────      │
//	│                                               │
//	│ ▸ /new        New session          ctrl+n     │
//	│   /clear      Clear screen                     │
//	│   ...                                         │
//	│                                               │
//	│ ← 倒带     → 快进     ↑ 上一     ↓ 下一        │
//	└───────────────────────────────────────────────┘
type Model struct {
	styles   theme.Styles
	show     bool
	commands []Command
	filtered []Command
	selected int
	input    textinput.Model
	width    int
	height   int
}

// New creates a new command palette Model.
func New(styles theme.Styles) Model {
	ti := textinput.New()
	ti.Placeholder = "Search commands..."
	ti.Focus()
	ti.CharLimit = 50
	ti.Width = 30

	return Model{
		styles:   styles,
		commands: defaultCommands,
		filtered: defaultCommands,
		input:    ti,
	}
}

// Show displays the palette.
func (m *Model) Show() {
	m.show = true
	m.selected = 0
	m.input.SetValue("")
	m.filtered = m.commands
	m.input.Focus()
}

// Hide hides the palette.
func (m *Model) Hide() {
	m.show = false
	m.input.SetValue("")
	m.input.Blur()
}

// Toggle toggles the palette visibility.
func (m *Model) Toggle() {
	if m.show {
		m.Hide()
	} else {
		m.Show()
	}
}

// Visible returns whether the palette is shown.
func (m Model) Visible() bool {
	return m.show
}

// Selected returns the currently selected command when Enter is pressed,
// or nil if the palette is not shown or the list is empty.
func (m Model) Selected() *Command {
	if !m.show || len(m.filtered) == 0 {
		return nil
	}
	if m.selected >= 0 && m.selected < len(m.filtered) {
		cmd := m.filtered[m.selected]
		return &cmd
	}
	return nil
}

// SetSize updates the available dimensions.
func (m *Model) SetSize(w, h int) {
	m.width = w
	m.height = h
}

func (m *Model) filterCommands() {
	q := strings.ToLower(strings.TrimSpace(m.input.Value()))
	if q == "" {
		m.filtered = m.commands
	} else {
		m.filtered = m.filtered[:0]
		for _, cmd := range m.commands {
			if strings.Contains(strings.ToLower(cmd.Name), q) ||
				strings.Contains(strings.ToLower(cmd.Description), q) {
				m.filtered = append(m.filtered, cmd)
			}
		}
	}
	if m.selected >= len(m.filtered) {
		m.selected = max(0, len(m.filtered)-1)
	}
}

// Init implements tea.Model.
func (m Model) Init() tea.Cmd {
	return textinput.Blink
}

// Update implements tea.Model.
func (m Model) Update(msg tea.Msg) (Model, tea.Cmd) {
	if !m.show {
		return m, nil
	}

	var cmd tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.Type {
		case tea.KeyEsc:
			m.Hide()
			return m, nil
		case tea.KeyEnter:
			return m, nil
		case tea.KeyUp:
			if m.selected > 0 {
				m.selected--
			}
			return m, nil
		case tea.KeyDown:
			if m.selected < len(m.filtered)-1 {
				m.selected++
			}
			return m, nil
		case tea.KeyLeft:
			// 倒带：上一个会话
			return m, func() tea.Msg { return SessionNavMsg{Direction: -1} }
		case tea.KeyRight:
			// 快进：下一个会话
			return m, func() tea.Msg { return SessionNavMsg{Direction: 1} }
		}
	}

	// Let textinput handle all other keys (typing, backspace, etc.)
	m.input, cmd = m.input.Update(msg)
	m.filterCommands()

	return m, cmd
}

// View implements tea.Model. Renders a centered overlay with transport key row.
func (m Model) View() string {
	if !m.show {
		return ""
	}

	// Build command list
	var items []string
	for i, c := range m.filtered {
		name := c.Name
		desc := c.Description
		key := ""

		if c.Key != "" {
			key = m.styles.DialogDim.Render("  " + c.Key)
		}

		line := lipgloss.JoinHorizontal(lipgloss.Left,
			m.styles.DialogItem.Width(14).Render(name),
			m.styles.DialogDesc.Width(20).Render(desc),
		)
		if key != "" {
			line = lipgloss.JoinHorizontal(lipgloss.Left, line, key)
		}

		if i == m.selected {
			line = m.styles.DialogActive.Width(lipgloss.Width(line) + 2).Padding(0, 1).Render(
				lipgloss.JoinHorizontal(lipgloss.Left,
					m.styles.DialogItem.Width(14).Render(name),
					m.styles.DialogDesc.Width(20).Render(desc),
				),
			)
			if c.Key != "" {
				line = lipgloss.JoinHorizontal(lipgloss.Left, line, m.styles.DialogDim.Render("  "+c.Key))
			}
		}
		items = append(items, line)
	}

	if len(items) == 0 {
		items = append(items, m.styles.DialogDim.Render("  No matches"))
	}

	listContent := strings.Join(items, "\n")

	// Search input
	searchLine := m.input.View()

	// Title
	title := m.styles.DialogTitle.Render("Commands")

	// Transport key row (磁带录音机风格)
	transportKeys := []string{
		m.styles.TransportKey.Render("← 倒带"),
		m.styles.TransportKey.Render("→ 快进"),
		m.styles.TransportKey.Render("↑ 上一"),
		m.styles.TransportKey.Render("↓ 下一"),
	}
	transportRow := m.styles.Muted.Render(strings.Join(transportKeys, "    "))

	// Assemble dialog body
	body := lipgloss.JoinVertical(lipgloss.Left,
		title,
		searchLine,
		listContent,
		transportRow,
	)

	dialog := m.styles.Dialog.
		Width(max(lipgloss.Width(body)+4, 56)).
		Render(body)

	// Center in available space
	w := m.width
	h := m.height
	if w == 0 {
		w = 80
	}
	if h == 0 {
		h = 24
	}

	return lipgloss.Place(w, h, lipgloss.Center, lipgloss.Center, dialog)
}