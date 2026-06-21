package chat

import (
	"fmt"
	"strings"

	"maou-tui/internal/tui/theme"

	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Command 定义一个 / 命令。
type Command struct {
	Name string
	Desc string
}

// COMMANDS 所有可用的 / 命令列表。
var COMMANDS = []Command{
	{"/new", "New session"},
	{"/clear", "Clear screen"},
	{"/help", "Show help"},
	{"/exit", "Quit"},
	{"/raw", "Toggle raw/pretty mode"},
	{"/token", "Show token usage"},
	{"/var", "Show variables"},
	{"/role", "List/switch roles"},
	{"/plan", "Plan mode"},
	{"/yolo", "Enable YOLO mode"},
	{"/auto", "Enable Auto mode"},
	{"/init-agent", "Re-initialize agent"},
}

// EditorFKeyMsg is sent when a function key (F1-F5) is pressed in the editor.
type EditorFKeyMsg struct {
	Key string // "F1", "F2", "F3", "F4", "F5"
}

// EditorModel 输入编辑器组件，支持命令自动补全 + 磁带录音键风格。
//
//	┌──────────────────────────────────────┐
//	│ ▸                                     │  ← 录音区框 + textarea
//	└──────────────────────────────────────┘
//	  REC ○    Pause     Stop     Eject
//	  F1:HELP  F2:NEW  F3:PLAN  F4:TOKEN  F5:VAR
type EditorModel struct {
	theme    theme.Theme
	styles   theme.Styles
	textarea textarea.Model

	showCmdHint bool
	cmdMatches  []string
	cmdSelected int
	width       int

	// 磁带录音键状态
	recording bool   // REC ● (Agent 工作中) / REC ○ (空闲)
	mode      string // "NORMAL", "AUTO", "YOLO"
}

// NewEditorModel 创建编辑器组件。
func NewEditorModel(t theme.Theme) EditorModel {
	ta := textarea.New()
	ta.Placeholder = "Enter a message..."
	ta.Focus()
	ta.CharLimit = 0
	ta.SetWidth(80)
	ta.SetHeight(1)
	ta.ShowLineNumbers = false

	return EditorModel{
		theme:    t,
		styles:   theme.NewStyles(t),
		textarea: ta,
		mode:     "NORMAL",
	}
}

// Value 返回当前输入内容。
func (m EditorModel) Value() string {
	return m.textarea.Value()
}

// Reset 清空输入框。
func (m *EditorModel) Reset() {
	m.textarea.Reset()
	m.closeCmdHints()
}

// SetWidth 设置编辑器宽度。
func (m *EditorModel) SetWidth(w int) {
	m.width = w
	if w > 4 {
		m.textarea.SetWidth(w - 4)
	}
}

// Focus 聚焦输入框。
func (m *EditorModel) Focus() tea.Cmd {
	return m.textarea.Focus()
}

// Blur 取消聚焦。
func (m *EditorModel) Blur() {
	m.textarea.Blur()
}

// SetRecording 设置录音状态 (Agent 工作中 = true)。
func (m *EditorModel) SetRecording(v bool) {
	m.recording = v
}

// SetMode 设置模式指示。
func (m *EditorModel) SetMode(mode string) {
	m.mode = mode
}

// Update 处理键盘事件。
func (m EditorModel) Update(msg tea.Msg) (EditorModel, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		// F1-F5 功能键 → 发送 EditorFKeyMsg
		switch msg.Type {
		case tea.KeyF1:
			return m, func() tea.Msg { return EditorFKeyMsg{Key: "F1"} }
		case tea.KeyF2:
			return m, func() tea.Msg { return EditorFKeyMsg{Key: "F2"} }
		case tea.KeyF3:
			return m, func() tea.Msg { return EditorFKeyMsg{Key: "F3"} }
		case tea.KeyF4:
			return m, func() tea.Msg { return EditorFKeyMsg{Key: "F4"} }
		case tea.KeyF5:
			return m, func() tea.Msg { return EditorFKeyMsg{Key: "F5"} }
		}

		if m.showCmdHint {
			switch msg.String() {
			case "up", "k":
				if m.cmdSelected > 0 {
					m.cmdSelected--
				}
				return m, nil
			case "down", "j":
				if m.cmdSelected < len(m.cmdMatches)-1 {
					m.cmdSelected++
				}
				return m, nil
			case "tab":
				if m.cmdSelected < len(m.cmdMatches) {
					m.textarea.SetValue(m.cmdMatches[m.cmdSelected] + " ")
					m.closeCmdHints()
				}
				return m, nil
			case "esc":
				m.closeCmdHints()
				return m, nil
			case "enter":
				if m.cmdSelected < len(m.cmdMatches) {
					m.textarea.SetValue(m.cmdMatches[m.cmdSelected] + " ")
					m.closeCmdHints()
					return m, nil
				}
			}
		}

		switch msg.String() {
		case "/":
			var cmd tea.Cmd
			m.textarea, cmd = m.textarea.Update(msg)
			m.updateCmdHints()
			return m, cmd
		case "esc":
			m.closeCmdHints()
			return m, nil
		}

		var cmd tea.Cmd
		m.textarea, cmd = m.textarea.Update(msg)
		m.updateCmdHints()
		return m, cmd
	}

	var cmd tea.Cmd
	m.textarea, cmd = m.textarea.Update(msg)
	return m, cmd
}

// View 渲染编辑器：录音区框 + 功能键行 (单行)。
//
//	┌──────────────────────────────────────┐
//	│ ▸                                     │
//	└──────────────────────────────────────┘
//	 REC ○  F1:HELP  F2:NEW  F3:PLAN  F4:TOKEN  F5:VAR
func (m EditorModel) View() string {
	maxW := m.width
	if maxW < 20 {
		maxW = 20
	}

	// ── 命令提示弹窗 (在输入区上方) ──
	var hintView string
	if m.showCmdHint && len(m.cmdMatches) > 0 {
		hintView = m.renderCmdHints()
	}

	// ── 录音区框 + textarea ──
	editorContent := m.textarea.View()
	recBox := m.styles.RecInput.Width(maxW).Render(editorContent)

	// ── REC 指示器 + 功能键 (合并为单行) ──
	var recIndicator string
	if m.recording {
		recIndicator = m.styles.RecIndicatorOn.Render("REC ●")
	} else {
		recIndicator = m.styles.RecIndicator.Render("REC ○")
	}
	funcKeys := []string{
		m.styles.FuncKey.Render("F1:HELP"),
		m.styles.FuncKey.Render("F2:NEW"),
		m.styles.FuncKey.Render("F3:PLAN"),
		m.styles.FuncKey.Render("F4:TOKEN"),
		m.styles.FuncKey.Render("F5:VAR"),
	}
	funcKeyRow := m.styles.FuncKeyRow.Width(maxW).Render(
		"  " + recIndicator + "  " + strings.Join(funcKeys, "  ") + "  ",
	)

	// ── 组装 ──
	var parts []string
	if hintView != "" {
		parts = append(parts, hintView)
	}
	parts = append(parts, recBox, funcKeyRow)

	return lipgloss.JoinVertical(lipgloss.Left, parts...)
}

// updateCmdHints 根据当前输入更新命令匹配列表。
func (m *EditorModel) updateCmdHints() {
	val := m.textarea.Value()
	if !strings.HasPrefix(val, "/") {
		m.closeCmdHints()
		return
	}

	m.cmdMatches = nil
	input := strings.ToLower(val)
	for _, cmd := range COMMANDS {
		if strings.HasPrefix(cmd.Name, input) {
			m.cmdMatches = append(m.cmdMatches, cmd.Name)
		}
	}

	if len(m.cmdMatches) > 0 {
		m.showCmdHint = true
		if m.cmdSelected >= len(m.cmdMatches) {
			m.cmdSelected = 0
		}
	} else {
		m.showCmdHint = false
	}
}

// closeCmdHints 关闭命令提示弹窗。
func (m *EditorModel) closeCmdHints() {
	m.showCmdHint = false
	m.cmdMatches = nil
	m.cmdSelected = 0
}

// renderCmdHints 渲染命令提示弹窗。
func (m EditorModel) renderCmdHints() string {
	maxItems := 5
	if len(m.cmdMatches) < maxItems {
		maxItems = len(m.cmdMatches)
	}

	var items []string
	for i := 0; i < maxItems; i++ {
		cmdName := m.cmdMatches[i]
		desc := ""
		for _, cmd := range COMMANDS {
			if cmd.Name == cmdName {
				desc = cmd.Desc
				break
			}
		}

		if i == m.cmdSelected {
			name := lipgloss.NewStyle().Foreground(m.theme.Primary).Bold(true).Render(cmdName)
			d := lipgloss.NewStyle().Foreground(m.theme.TextMuted).Render("  " + desc)
			items = append(items, lipgloss.NewStyle().
				Background(m.theme.Background2).
				Padding(0, 1).
				Render("▸ "+name+d))
		} else {
			name := lipgloss.NewStyle().Foreground(m.theme.Text).Render(cmdName)
			d := lipgloss.NewStyle().Foreground(m.theme.TextMuted).Render("  " + desc)
			items = append(items, "  "+name+d)
		}
	}

	popupW := m.width - 4
	if popupW < 30 {
		popupW = 30
	}

	// 显示在上方：仅上边框 + 左右边框
	return lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(m.theme.BorderNormal).
		BorderTop(true).
		BorderBottom(false).
		BorderLeft(false).
		BorderRight(false).
		Width(popupW).
		Render(strings.Join(items, "\n"))
}

// ─── Formatting helpers ───

func formatTokens(n int) string {
	if n >= 1000 {
		return fmt.Sprintf("%.1fk", float64(n)/1000)
	}
	return fmt.Sprintf("%d", n)
}