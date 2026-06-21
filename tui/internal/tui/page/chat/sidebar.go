package chat

import (
	"fmt"
	"strings"

	"maou-tui/internal/api"
	"maou-tui/internal/tui/theme"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// SidebarModel 右侧边栏，显示会话列表和 Agent 列表。
type SidebarModel struct {
	theme          theme.Theme
	show           bool
	sessions       []api.Session
	agents         []string
	currentSession string
	currentAgent   string
	selected       int    // 0..len(sessions)-1 为会话，之后为 agent
	focusSection   string // "sessions" 或 "agents"
	width          int
	height         int
}

// NewSidebarModel 创建侧边栏组件。
func NewSidebarModel(t theme.Theme) SidebarModel {
	return SidebarModel{
		theme:        t,
		focusSection: "sessions",
	}
}

// SetSessions 设置会话列表。
func (m *SidebarModel) SetSessions(sessions []api.Session) {
	m.sessions = sessions
}

// SetAgents 设置 Agent 列表。
func (m *SidebarModel) SetAgents(agents []string) {
	m.agents = agents
}

// SetCurrent 设置当前选中的会话和 Agent。
func (m *SidebarModel) SetCurrent(sessionID, agentName string) {
	m.currentSession = sessionID
	m.currentAgent = agentName
}

// Show 显示侧边栏。
func (m *SidebarModel) Show() {
	m.show = true
}

// Hide 隐藏侧边栏。
func (m *SidebarModel) Hide() {
	m.show = false
}

// Toggle 切换侧边栏显示状态。
func (m *SidebarModel) Toggle() {
	m.show = !m.show
}

// IsVisible 返回侧边栏是否可见。
func (m SidebarModel) IsVisible() bool {
	return m.show
}

// SelectedSession 返回当前选中的会话 ID，未选中返回 nil。
func (m SidebarModel) SelectedSession() *string {
	if m.focusSection == "sessions" && m.selected < len(m.sessions) {
		id := m.sessions[m.selected].ID
		return &id
	}
	return nil
}

// SelectedAgent 返回当前选中的 Agent 名称，未选中返回空字符串。
func (m SidebarModel) SelectedAgent() string {
	if m.focusSection == "agents" {
		idx := m.selected - len(m.sessions)
		if idx >= 0 && idx < len(m.agents) {
			return m.agents[idx]
		}
	}
	return ""
}

// SetSize 设置侧边栏尺寸。
func (m *SidebarModel) SetSize(w, h int) {
	m.width = w
	m.height = h
}

// Update 处理键盘事件。
func (m SidebarModel) Update(msg tea.Msg) (SidebarModel, tea.Cmd) {
	if !m.show {
		return m, nil
	}

	totalItems := len(m.sessions) + len(m.agents)

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "up", "k":
			if m.selected > 0 {
				m.selected--
				m.updateFocusSection()
			}
		case "down", "j":
			if m.selected < totalItems-1 {
				m.selected++
				m.updateFocusSection()
			}
		case "enter":
			// 选中项的处理由外部 ChatPage 调用 SelectedSession/SelectedAgent
		case "n":
			// 新建会话的处理由外部 ChatPage 响应
		case "esc":
			m.Hide()
		}
	}

	return m, nil
}

// updateFocusSection 根据 selected 索引更新焦点区域。
func (m *SidebarModel) updateFocusSection() {
	if m.selected < len(m.sessions) {
		m.focusSection = "sessions"
	} else {
		m.focusSection = "agents"
	}
}

// View 渲染侧边栏。
func (m SidebarModel) View() string {
	if !m.show {
		return ""
	}

	var sb strings.Builder

	// ── Sessions 标题 ──
	sb.WriteString(m.renderSectionHeader("Sessions"))
	sb.WriteString("\n")

	// 会话列表
	for i, sess := range m.sessions {
		isCurrent := sess.ID == m.currentSession
		isSelected := m.selected == i && m.focusSection == "sessions"
		sb.WriteString(m.renderSessionItem(sess, isCurrent, isSelected))
		sb.WriteString("\n")
	}

	// ── Agents 分隔 ──
	sb.WriteString(m.renderDivider("Agents"))
	sb.WriteString("\n")

	// Agent 列表
	for i, agent := range m.agents {
		isCurrent := agent == m.currentAgent
		isSelected := m.selected == len(m.sessions)+i && m.focusSection == "agents"
		sb.WriteString(m.renderAgentItem(agent, isCurrent, isSelected))
		sb.WriteString("\n")
	}

	// 底部提示
	sb.WriteString("\n")
	sb.WriteString(lipgloss.NewStyle().
		Foreground(m.theme.TextMuted).
		Italic(true).
		Render("j/k navigate · Enter select · n new · Esc close"))

	// 包裹在边框中
	w := m.width
	if w < 10 {
		w = 24
	}

	return lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(m.theme.BorderNormal).
		Width(w - 2).
		Height(m.height - 2).
		Padding(0, 1).
		Render(sb.String())
}

// renderSectionHeader 渲染区域标题。
func (m SidebarModel) renderSectionHeader(title string) string {
	return lipgloss.NewStyle().
		Foreground(m.theme.Primary).
		Bold(true).
		Render("┌─ " + title + " ─────────┐")
}

// renderDivider 渲染分隔线和区域标题。
func (m SidebarModel) renderDivider(title string) string {
	return lipgloss.NewStyle().
		Foreground(m.theme.Primary).
		Bold(true).
		Render("├─ " + title + " ───────────┤")
}

// renderSessionItem 渲染单个会话条目。
func (m SidebarModel) renderSessionItem(sess api.Session, isCurrent, isSelected bool) string {
	prefix := "  "
	if isSelected {
		prefix = "▸ "
	}

	label := sess.ID
	if len(label) > 16 {
		label = label[:16]
	}
	if sess.Title != "" {
		label = sess.Title
		if len(label) > 16 {
			label = label[:16]
		}
	}

	marker := ""
	if isCurrent {
		marker = " ←"
	}

	style := lipgloss.NewStyle().Foreground(m.theme.Text)
	if isSelected {
		style = style.Bold(true).Foreground(m.theme.Primary)
	}
	if isCurrent {
		style = style.Foreground(m.theme.Accent)
	}

	return style.Render(prefix + label + marker)
}

// renderAgentItem 渲染单个 Agent 条目。
func (m SidebarModel) renderAgentItem(name string, isCurrent, isSelected bool) string {
	icon := "○"
	if isCurrent {
		icon = "●"
	}

	prefix := "  "
	if isSelected {
		prefix = "▸ "
	}

	label := fmt.Sprintf("%s %s", icon, name)
	if isCurrent {
		label += " (current)"
	}

	style := lipgloss.NewStyle().Foreground(m.theme.Text)
	if isSelected {
		style = style.Bold(true).Foreground(m.theme.Primary)
	}
	if isCurrent {
		style = style.Foreground(m.theme.Success)
	}

	return style.Render(prefix + label)
}
