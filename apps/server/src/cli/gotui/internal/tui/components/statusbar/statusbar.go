package statusbar

import (
	"fmt"
	"strings"

	"maou-tui/internal/tui/theme"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Model is the VFD-style status bar (Vacuum Fluorescent Display).
//
//	═══════════════════════════════════════════════════════
//	  SESSION d7f3a2e1 │ MODEL deepseek │ TOKENS 12.4k/128k │ MODE AUTO
//	═══════════════════════════════════════════════════════
type Model struct {
	styles     theme.Styles
	width      int
	processing bool
	spinner    spinner.Model

	sessionID string
	modelName string
	mode      string // "NORMAL", "AUTO", "YOLO"
	usedTok   int
	maxTok    int // 默认 128000

	// 动效状态
	flickerOn bool
}

// New creates a new VFD statusbar Model.
func New(styles theme.Styles) Model {
	sp := spinner.New()
	sp.Spinner = spinner.Dot
	sp.Style = styles.Primary
	return Model{
		styles:    styles,
		spinner:   sp,
		mode:      "NORMAL",
	}
}

// SetProcessing sets the processing state.
func (m *Model) SetProcessing(v bool) {
	m.processing = v
}

// SetSession sets the session ID.
func (m *Model) SetSession(id string) {
	m.sessionID = id
}

// SetModel sets the model name.
func (m *Model) SetModel(name string) {
	m.modelName = name
}

// SetMode sets the current mode (NORMAL / AUTO / YOLO).
func (m *Model) SetMode(mode string) {
	m.mode = mode
}

// SetTokens sets the token usage.
func (m *Model) SetTokens(used, max int) {
	m.usedTok = used
	if max > 0 {
		m.maxTok = max
	}
}

// SetWidth updates the available width.
func (m *Model) SetWidth(w int) {
	m.width = w
}

// SetFlicker toggles the VFD flicker effect (模拟荧光灯启辉).
func (m *Model) SetFlicker(on bool) {
	m.flickerOn = on
}

// Init implements tea.Model.
func (m Model) Init() tea.Cmd {
	return m.spinner.Tick
}

// Update implements tea.Model.
func (m Model) Update(msg tea.Msg) (Model, tea.Cmd) {
	var cmd tea.Cmd
	switch msg.(type) {
	case spinner.TickMsg:
		if m.processing {
			m.spinner, cmd = m.spinner.Update(msg)
			return m, cmd
		}
	}
	return m, nil
}

// View implements tea.Model. Renders a single-line VFD-style status bar.
func (m Model) View() string {
	// Session
	sessionStr := "N/A"
	if m.sessionID != "" {
		short := m.sessionID
		if len(short) > 8 {
			short = short[:8]
		}
		sessionStr = short
	}
	sessionField := m.styles.StatusField.Render(fmt.Sprintf("SESSION %s", sessionStr))

	// Model
	modelNameDisplay := m.modelName
	if modelNameDisplay == "" {
		modelNameDisplay = "..."
	}
	modelField := m.styles.StatusField.Render(fmt.Sprintf("MODEL %s", modelNameDisplay))

	// Tokens
	tokStr := fmt.Sprintf("%s/%s", formatTokens(m.usedTok), formatTokens(m.maxTok))
	tokenField := m.styles.StatusField.Render(fmt.Sprintf("TOKENS %s", tokStr))

	// Mode (color-coded + optional flicker)
	var modeStyle lipgloss.Style
	switch m.mode {
	case "YOLO":
		modeStyle = m.styles.StatusModeYolo
	case "AUTO":
		modeStyle = m.styles.StatusModeAuto
	default:
		modeStyle = m.styles.StatusModeNorm
	}
	if m.flickerOn {
		modeStyle = modeStyle.Background(m.styles.StatusModeYolo.GetForeground())
	}
	modeText := modeStyle.Render(m.mode)

	// Processing spinner + mode
	var modeField string
	if m.processing {
		modeField = fmt.Sprintf("MODE %s %s", m.spinner.View(), modeText)
	} else {
		modeField = fmt.Sprintf("MODE %s", modeText)
	}
	modeFieldStyled := m.styles.StatusField.Render(modeField)

	// Pipe separator
	pipe := m.styles.StatusPipe.Render(" │ ")

	// Assemble all fields
	fields := []string{sessionField, modelField, tokenField, modeFieldStyled}
	content := strings.Join(fields, pipe)

	// Pad to full width (single line, no surrounding dividers)
	w := m.width
	if w < 4 {
		w = 80
	}
	return m.styles.StatusBar.Width(w).Render("  " + content)
}

func formatTokens(n int) string {
	if n >= 1000 {
		return fmt.Sprintf("%.1fk", float64(n)/1000)
	}
	return fmt.Sprintf("%d", n)
}