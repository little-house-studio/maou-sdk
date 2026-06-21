package session_picker

import (
	"fmt"
	"strings"

	"maou-tui/internal/api"
	"maou-tui/internal/tui/theme"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// NewSessionMsg signals that a new session should be created.
type NewSessionMsg struct{}

// DeleteSessionMsg signals that the selected session should be deleted.
type DeleteSessionMsg struct {
	Session api.Session
}

// Model is the session list picker (Ctrl+S).
type Model struct {
	styles   theme.Styles
	show     bool
	sessions []api.Session
	selected int
	width    int
	height   int
}

// New creates a new session picker Model.
func New(styles theme.Styles) Model {
	return Model{styles: styles}
}

// SetSessions replaces the session list.
func (m *Model) SetSessions(sessions []api.Session) {
	m.sessions = sessions
	if m.selected >= len(m.sessions) {
		m.selected = max(0, len(m.sessions)-1)
	}
}

// Show displays the picker.
func (m *Model) Show() {
	m.show = true
	m.selected = 0
}

// Hide hides the picker.
func (m *Model) Hide() { m.show = false }

// Toggle toggles the picker visibility.
func (m *Model) Toggle() {
	if m.show {
		m.Hide()
	} else {
		m.Show()
	}
}

// Visible returns whether the picker is shown.
func (m Model) Visible() bool { return m.show }

// SetSize updates available dimensions.
func (m *Model) SetSize(w, h int) {
	m.width = w
	m.height = h
}

// Selected returns the selected session, or nil if none.
func (m Model) Selected() *api.Session {
	if !m.show || len(m.sessions) == 0 {
		return nil
	}
	if m.selected >= 0 && m.selected < len(m.sessions) {
		s := m.sessions[m.selected]
		return &s
	}
	return nil
}

// Init implements tea.Model.
func (m Model) Init() tea.Cmd { return nil }

// Update implements tea.Model.
func (m Model) Update(msg tea.Msg) (Model, tea.Cmd) {
	if !m.show {
		return m, nil
	}

	if key, ok := msg.(tea.KeyMsg); ok {
		switch key.Type {
		case tea.KeyEsc:
			m.Hide()
			return m, nil
		case tea.KeyEnter:
			// Caller checks Selected() after Update
			return m, nil
		case tea.KeyUp:
			if m.selected > 0 {
				m.selected--
			}
			return m, nil
		case tea.KeyDown:
			if m.selected < len(m.sessions)-1 {
				m.selected++
			}
			return m, nil
		}

		switch key.String() {
		case "n":
			m.show = false
			return m, func() tea.Msg { return NewSessionMsg{} }
		case "d":
			if len(m.sessions) > 0 {
				sess := m.sessions[m.selected]
				m.show = false
				return m, func() tea.Msg { return DeleteSessionMsg{Session: sess} }
			}
		}
	}

	return m, nil
}

// View implements tea.Model. Renders a centered overlay with session list.
func (m Model) View() string {
	if !m.show {
		return ""
	}

	title := m.styles.DialogTitle.Render("Sessions")
	hint := m.styles.DialogDim.Render("n: new   d: delete   Esc: close")

	var items []string
	if len(m.sessions) == 0 {
		items = append(items, m.styles.DialogDim.Render("  No sessions"))
	} else {
		for i, s := range m.sessions {
			// Format: title (or id) + updated time
			label := s.Title
			if label == "" {
				label = s.ID
			}
			meta := fmt.Sprintf("%s  %s", s.AgentName, s.UpdatedAt)

			name := m.styles.DialogItem.Width(30).Render("  " + label)
			info := m.styles.DialogDim.Width(24).Render(meta)
			line := lipgloss.JoinHorizontal(lipgloss.Left, name, info)

			if i == m.selected {
				line = m.styles.DialogActive.Width(lipgloss.Width(line) + 2).Padding(0, 1).Render(
					lipgloss.JoinHorizontal(lipgloss.Left,
						m.styles.DialogItem.Width(30).Render(label),
						m.styles.DialogDim.Width(24).Render(meta),
					),
				)
			}
			items = append(items, line)
		}
	}

	listContent := strings.Join(items, "\n")

	body := lipgloss.JoinVertical(lipgloss.Left,
		title,
		listContent,
		hint,
	)

	dialog := m.styles.Dialog.
		Width(max(lipgloss.Width(body)+4, 60)).
		Render(body)

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
