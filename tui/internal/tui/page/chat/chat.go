package chat

import (
	"strings"
	"time"

	"maou-tui/internal/tui/theme"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// ChatPage 主聊天页面，组合 Messages + Editor + Sidebar。
// 布局分隔线由 tui.go 统一管理。
type ChatPage struct {
	Theme    theme.Theme
	Messages MessagesModel
	Editor   EditorModel
	Sidebar  SidebarModel
	width    int
	height   int
}

// New 创建 ChatPage 实例。
func New(t theme.Theme) ChatPage {
	return ChatPage{
		Theme:    t,
		Messages: NewMessagesModel(t),
		Editor:   NewEditorModel(t),
		Sidebar:  NewSidebarModel(t),
	}
}

// SendMessage 获取并清空编辑器内容，返回文本、是否为命令、命令名。
func (m *ChatPage) SendMessage() (text string, isCommand bool, cmdName string) {
	val := strings.TrimSpace(m.Editor.Value())
	if val == "" {
		return "", false, ""
	}
	m.Editor.Reset()

	if strings.HasPrefix(val, "/") {
		parts := strings.SplitN(val, " ", 2)
		cmdName = parts[0]
		return val, true, cmdName
	}

	return val, false, ""
}

// AddAssistantDelta 追加 AI 流式输出增量。
func (m *ChatPage) AddAssistantDelta(delta string) {
	msgs := m.Messages.messages
	if len(msgs) > 0 && msgs[len(msgs)-1].Role == RoleAssistant {
		msgs[len(msgs)-1].Content += delta
	} else {
		m.Messages.AddMessage(Message{
			Role:    RoleAssistant,
			Content: delta,
			Time:    time.Now(),
		})
		return
	}
	m.Messages.refreshContent()
}

// SetAssistantFinal 设置 AI 最终回复内容。
func (m *ChatPage) SetAssistantFinal(content string) {
	msgs := m.Messages.messages
	if len(msgs) > 0 && msgs[len(msgs)-1].Role == RoleAssistant {
		msgs[len(msgs)-1].Content = content
		m.Messages.refreshContent()
	} else {
		m.Messages.AddMessage(Message{
			Role:    RoleAssistant,
			Content: content,
			Time:    time.Now(),
		})
	}
}

// AddToolCall 添加工具调用消息。
func (m *ChatPage) AddToolCall(name string) {
	m.Messages.AddMessage(Message{
		Role:     RoleTool,
		Content:  "",
		ToolName: name,
		Time:     time.Now(),
	})
}

// AddToolResult 添加工具执行结果。
func (m *ChatPage) AddToolResult(name string, ok bool) {
	m.Messages.AddMessage(Message{
		Role:     RoleTool,
		Content:  name,
		ToolName: name,
		ToolOK:   ok,
		Time:     time.Now(),
	})
}

// AddSystemMsg 添加系统消息。
func (m *ChatPage) AddSystemMsg(text string) {
	m.Messages.AddMessage(Message{
		Role:    RoleSystem,
		Content: text,
		Time:    time.Now(),
	})
}

// AddMessage adds a message directly.
func (m *ChatPage) AddMessage(msg Message) {
	m.Messages.AddMessage(msg)
}

// Clear clears all messages.
func (m *ChatPage) Clear() {
	m.Messages.Clear()
}

// SetSize 设置页面尺寸，自动分配子组件尺寸。
// totalH 仅为消息区域高度，编辑器由 tui.go 单独管理。
func (m *ChatPage) SetSize(w, messagesH int) {
	m.width = w
	m.height = messagesH

	if messagesH < 5 {
		messagesH = 5
	}

	if m.Sidebar.IsVisible() {
		sidebarW := 28
		if sidebarW > w/3 {
			sidebarW = w / 3
		}
		m.Sidebar.SetSize(sidebarW, messagesH)
		m.Messages.SetSize(w-sidebarW, messagesH)
	} else {
		m.Messages.SetSize(w, messagesH)
	}

	m.Editor.SetWidth(w)
}

// ToggleSidebar 切换侧边栏显示。
func (m *ChatPage) ToggleSidebar() {
	m.Sidebar.Toggle()
	m.SetSize(m.width, m.height)
}

// Focus 聚焦编辑器。
func (m *ChatPage) Focus() tea.Cmd {
	return m.Editor.Focus()
}

// Update 处理所有事件。
func (m ChatPage) Update(msg tea.Msg) (ChatPage, tea.Cmd) {
	var cmds []tea.Cmd

	// 窗口尺寸变化
	if sz, ok := msg.(tea.WindowSizeMsg); ok {
		m.SetSize(sz.Width, sz.Height)
	}

	// 侧边栏可见时优先传递事件给侧边栏
	if m.Sidebar.IsVisible() {
		var sidebarCmd tea.Cmd
		m.Sidebar, sidebarCmd = m.Sidebar.Update(msg)
		if sidebarCmd != nil {
			cmds = append(cmds, sidebarCmd)
		}
		if km, ok := msg.(tea.KeyMsg); ok && km.String() == "esc" {
			return m, tea.Batch(cmds...)
		}
	}

	// 编辑器事件
	var editorCmd tea.Cmd
	m.Editor, editorCmd = m.Editor.Update(msg)
	if editorCmd != nil {
		cmds = append(cmds, editorCmd)
	}

	// 消息 viewport 事件
	var msgCmd tea.Cmd
	m.Messages, msgCmd = m.Messages.Update(msg)
	if msgCmd != nil {
		cmds = append(cmds, msgCmd)
	}

	return m, tea.Batch(cmds...)
}

// View 渲染消息区域 (不含编辑器和分隔线，由 tui.go 管理布局)。
func (m ChatPage) View() string {
	messagesView := m.Messages.View()

	if !m.Sidebar.IsVisible() {
		return messagesView
	}

	sidebarView := m.Sidebar.View()
	return lipgloss.JoinHorizontal(lipgloss.Top, messagesView, sidebarView)
}