package help_dialog

import (
	"fmt"
	"strings"

	"maou-tui/internal/tui/theme"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type shortcut struct {
	Key  string
	Desc string
}

var shortcuts = []shortcut{
	{"Enter", "Send message"},
	{"Shift+Enter", "New line"},
	{"Ctrl+C", "Cancel / Quit"},
	{"Ctrl+N", "New session"},
	{"Ctrl+K", "Command palette"},
	{"Ctrl+L", "Toggle sidebar"},
	{"Ctrl+H / F1", "This help"},
	{"Ctrl+S", "Session picker"},
	{"Ctrl+Shift+C", "Copy last AI response"},
	{"Up/Down", "History (when input empty)"},
	{"Tab", "Command autocomplete"},
	{"Esc", "Close dialog"},
}

// Model is the help dialog overlay.
type Model struct {
	styles theme.Styles
	show   bool
	width  int
	height int
}

// New creates a new help dialog Model.
func New(styles theme.Styles) Model {
	return Model{styles: styles}
}

// Show displays the dialog.
func (m *Model) Show() { m.show = true }

// Hide hides the dialog.
func (m *Model) Hide() { m.show = false }

// Toggle toggles the dialog.
func (m *Model) Toggle() { m.show = !m.show }

// Visible returns whether the dialog is shown.
func (m Model) Visible() bool { return m.show }

// SetSize updates available dimensions.
func (m *Model) SetSize(w, h int) {
	m.width = w
	m.height = h
}

// Init implements tea.Model.
func (m Model) Init() tea.Cmd { return nil }

// Update implements tea.Model.
func (m Model) Update(msg tea.Msg) (Model, tea.Cmd) {
	if !m.show {
		return m, nil
	}
	if key, ok := msg.(tea.KeyMsg); ok && key.Type == tea.KeyEsc {
		m.Hide()
		return m, nil
	}
	return m, nil
}

// View implements tea.Model. Renders a centered overlay with shortcuts table.
func (m Model) View() string {
	if !m.show {
		return ""
	}

	title := m.styles.DialogTitle.Render("Keyboard Shortcuts")
	fmt.Println() //nolint:govet // intentional spacing

	var rows []string
	for _, s := range shortcuts {
		key := m.styles.DialogKey.Width(18).Render(s.Key)
		desc := m.styles.DialogItem.Render(s.Desc)
		rows = append(rows, lipgloss.JoinHorizontal(lipgloss.Left, key, "  ", desc))
	}

	body := lipgloss.JoinVertical(lipgloss.Left,
		title,
		strings.Join(rows, "\n"),
	)

	dialog := m.styles.Dialog.
		Width(max(lipgloss.Width(body)+4, 50)).
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
