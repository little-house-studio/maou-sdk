package quit_dialog

import (
	"maou-tui/internal/tui/theme"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// QuitMsg is sent when the user confirms quit.
type QuitMsg struct{}

// Model is a simple quit confirmation dialog.
type Model struct {
	styles theme.Styles
	show   bool
	width  int
	height int
}

// New creates a new quit dialog Model.
func New(styles theme.Styles) Model {
	return Model{styles: styles}
}

// Show displays the dialog.
func (m *Model) Show() { m.show = true }

// Hide hides the dialog.
func (m *Model) Hide() { m.show = false }

// Visible returns whether the dialog is shown.
func (m Model) Visible() bool { return m.show }

// SetSize updates available dimensions.
func (m *Model) SetSize(w, h int) {
	m.width = w
	m.height = h
}

// Init implements tea.Model.
func (m Model) Init() tea.Cmd { return nil }

// Update implements tea.Model. Returns a QuitMsg when user confirms.
func (m Model) Update(msg tea.Msg) (Model, tea.Cmd) {
	if !m.show {
		return m, nil
	}

	if key, ok := msg.(tea.KeyMsg); ok {
		switch key.String() {
		case "y", "Y", "enter":
			m.show = false
			return m, func() tea.Msg { return QuitMsg{} }
		case "n", "N", "esc":
			m.Hide()
			return m, nil
		}
	}
	return m, nil
}

// View implements tea.Model. Renders a centered confirmation box.
func (m Model) View() string {
	if !m.show {
		return ""
	}

	title := m.styles.DialogTitle.Render("Quit?")
	question := m.styles.DialogItem.Render("Are you sure you want to quit?")
	hint := m.styles.DialogDim.Render("y/Enter: confirm   n/Esc: cancel")

	body := lipgloss.JoinVertical(lipgloss.Center,
		title,
		question,
		hint,
	)

	dialog := m.styles.Dialog.
		Width(max(lipgloss.Width(body)+4, 40)).
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
