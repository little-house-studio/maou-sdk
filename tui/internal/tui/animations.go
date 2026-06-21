package tui

import (
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// ─── 动画消息类型 ───

// flickerMsg 荧光灯启辉闪烁 (Agent 响应开始时)。
type flickerMsg struct{}

// recBlinkMsg REC 指示器闪烁 (500ms 循环)。
type recBlinkMsg struct{}

// loadingDotsMsg 虚线滚动 (500ms 循环)。
type loadingDotsMsg struct {
	dots int // 1-3, 对应 . .. ...
}

// counterTickMsg 计数器数字跳动 (工具执行中，500ms 循环)。
type counterTickMsg struct{}

// errorFlashMsg 模式区域红色闪烁 (200ms × 2)。
type errorFlashMsg struct {
	count int // 剩余闪烁次数
}

// ─── 动画 Cmd 工厂 ───

// flickerCmd 返回荧光灯启辉闪烁 Cmd (100ms × 2)。
func flickerCmd() tea.Cmd {
	return tea.Tick(100*time.Millisecond, func(t time.Time) tea.Msg {
		return flickerMsg{}
	})
}

// recBlinkCmd 返回 REC 指示器闪烁 Cmd (500ms 循环)。
func recBlinkCmd() tea.Cmd {
	return tea.Tick(500*time.Millisecond, func(t time.Time) tea.Msg {
		return recBlinkMsg{}
	})
}

// loadingDotsCmd 返回虚线滚动 Cmd (500ms 循环)，dots 从 1 到 3 循环。
func loadingDotsCmd(dots int) tea.Cmd {
	return tea.Tick(500*time.Millisecond, func(t time.Time) tea.Msg {
		return loadingDotsMsg{dots: dots}
	})
}

// counterTickCmd 返回计数器跳动 Cmd (500ms 循环)。
func counterTickCmd() tea.Cmd {
	return tea.Tick(500*time.Millisecond, func(t time.Time) tea.Msg {
		return counterTickMsg{}
	})
}

// errorFlashCmd 返回错误闪烁 Cmd (200ms × 2)。
func errorFlashCmd() tea.Cmd {
	return tea.Tick(200*time.Millisecond, func(t time.Time) tea.Msg {
		return errorFlashMsg{count: 2}
	})
}