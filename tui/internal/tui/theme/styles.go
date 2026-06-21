package theme

import "github.com/charmbracelet/lipgloss"

// Styles holds pre-built lipgloss.Style objects derived from a Theme.
// Cassette Futurism edition — uses box-drawing chars, no rounded borders, no gradients.
type Styles struct {
	// ─── Message Boxes (磁带标签卡 / 计数器风格) ───

	// 标签卡框：NormalBorder + 标签纸白边框 + 炭黑底
	MsgBox       lipgloss.Style
	MsgBoxHeader lipgloss.Style // 标签卡头部 [HH:MM:SS] AgentName  Session
	MsgBoxBody   lipgloss.Style // 标签卡正文
	MsgBoxFooter lipgloss.Style // 标签卡底部附件

	// User message: ▸ 前缀 + primary color
	UserPrefix lipgloss.Style
	UserText   lipgloss.Style

	// Tool card (磁带计数器风格框)
	ToolBox       lipgloss.Style
	ToolHeader    lipgloss.Style // "TOOL: read          ████"
	ToolPending   lipgloss.Style // "................................" 虚线
	ToolSuccess   lipgloss.Style // "✓ 读取完成 · 42 lines"

	// System: ─── 消息 ─── 等号线包围
	SystemLine lipgloss.Style

	// ─── Status Bar (VFD 荧光屏) ───

	StatusBar      lipgloss.Style // VFD 底色 + full width
	StatusField    lipgloss.Style // 管道分隔字段
	StatusPipe     lipgloss.Style // │ 分隔符
	StatusModeNorm lipgloss.Style // NORMAL（绿）
	StatusModeAuto lipgloss.Style // AUTO（琥珀）
	StatusModeYolo lipgloss.Style // YOLO（红）

	// ─── Input Area (磁带录音键区) ───

	RecInput      lipgloss.Style // 录音区框
	RecIndicator  lipgloss.Style // REC ○ 指示器
	RecIndicatorOn  lipgloss.Style // REC ● (recording)
	FuncKeyRow    lipgloss.Style // 功能键行框
	FuncKey       lipgloss.Style // 单个功能键
	FuncKeyActive lipgloss.Style // 高亮功能键
	TransportKey  lipgloss.Style // 倒带/快进/停止 键

	// ─── VU Meter (VU 表) ───

	VUMeterBox    lipgloss.Style
	VUMeterFilled lipgloss.Style // ▄ 填充
	VUMeterEmpty  lipgloss.Style // ░ 空

	// ─── Counter (磁带计数器 / 七段数码) ───

	CounterLabel lipgloss.Style
	CounterValue lipgloss.Style

	// ─── Dialogs & Overlays ───

	Dialog       lipgloss.Style
	DialogTitle  lipgloss.Style
	DialogItem   lipgloss.Style
	DialogDim    lipgloss.Style
	DialogActive lipgloss.Style
	DialogKey    lipgloss.Style
	DialogDesc   lipgloss.Style
	DialogButton       lipgloss.Style
	DialogActiveButton lipgloss.Style

	// ─── Line Dividers ───

	DividerDouble lipgloss.Style // ═══ 顶层分隔
	DividerSingle lipgloss.Style // ─── 子区块分隔
	DividerDotted lipgloss.Style // ┄┄┄ 折叠提示
	DividerDot    lipgloss.Style // ··· 加载中

	// ─── Shared ───

	Primary lipgloss.Style
	Success lipgloss.Style
	Muted   lipgloss.Style
	Editor  lipgloss.Style

	// ─── Sidebar (保留兼容) ───

	SidebarTitle  lipgloss.Style
	SidebarItem   lipgloss.Style
	SidebarActive lipgloss.Style

	// ─── Legacy aliases (向后兼容旧组件) ───
	UserBox       lipgloss.Style
	UserLabel     lipgloss.Style
	AIBox         lipgloss.Style
	AILabel       lipgloss.Style
	ToolLine      lipgloss.Style
	TokenLine     lipgloss.Style
	Statusbar     lipgloss.Style
	StatusbarLeft lipgloss.Style
	StatusbarRight  lipgloss.Style
	StatusbarCenter lipgloss.Style
	StatusLeft    lipgloss.Style
	StatusRight   lipgloss.Style
	StatusbarLeftStyle  lipgloss.Style
	StatusbarRightStyle lipgloss.Style
	StatusbarCenterStyle lipgloss.Style
	PaletteTitle  lipgloss.Style
	PaletteItem   lipgloss.Style
	PaletteActive lipgloss.Style
	DialogBox     lipgloss.Style
}

// NewStyles creates a Styles struct from the given Theme.
func NewStyles(t Theme) Styles {
	s := Styles{}

	// ─── Message Boxes ───

	s.MsgBox = lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(t.BorderNormal)

	s.MsgBoxHeader = lipgloss.NewStyle().
		Foreground(t.CRTWarmWhite).
		Bold(false)

	s.MsgBoxBody = lipgloss.NewStyle().
		Foreground(t.Text).
		Padding(0, 1)

	s.MsgBoxFooter = lipgloss.NewStyle().
		Foreground(t.TextMuted).
		Italic(true)

	s.UserPrefix = lipgloss.NewStyle().
		Foreground(t.Primary).
		Bold(true)

	s.UserText = lipgloss.NewStyle().
		Foreground(t.Primary)

	s.ToolBox = lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(t.Warning).
		Padding(0, 1)

	s.ToolHeader = lipgloss.NewStyle().
		Foreground(t.Accent).
		Bold(true)

	s.ToolPending = lipgloss.NewStyle().
		Foreground(t.TextMuted)

	s.ToolSuccess = lipgloss.NewStyle().
		Foreground(t.Success)

	s.SystemLine = lipgloss.NewStyle().
		Foreground(t.TextMuted).
		Italic(true)

	// ─── Status Bar (VFD) ───

	s.StatusBar = lipgloss.NewStyle().
		Background(t.ShellDark).
		Foreground(t.CRTGreen).
		Padding(0, 1)

	s.StatusField = lipgloss.NewStyle().
		Foreground(t.CRTWarmWhite)

	s.StatusPipe = lipgloss.NewStyle().
		Foreground(t.TextMuted)

	s.StatusModeNorm = lipgloss.NewStyle().
		Foreground(t.CRTGreen).
		Bold(true)

	s.StatusModeAuto = lipgloss.NewStyle().
		Foreground(t.CRTAmber).
		Bold(true)

	s.StatusModeYolo = lipgloss.NewStyle().
		Foreground(t.ShellRed).
		Bold(true)

	// ─── Input Area ───

	s.RecInput = lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(t.BorderNormal)

	s.RecIndicator = lipgloss.NewStyle().
		Foreground(t.TextMuted)

	s.RecIndicatorOn = lipgloss.NewStyle().
		Foreground(t.ShellRed).
		Bold(true)

	s.FuncKeyRow = lipgloss.NewStyle().
		Border(lipgloss.DoubleBorder()).
		BorderForeground(t.BorderNormal).
		Padding(0, 1)

	s.FuncKey = lipgloss.NewStyle().
		Foreground(t.TextMuted)

	s.FuncKeyActive = lipgloss.NewStyle().
		Foreground(t.Primary).
		Bold(true)

	s.TransportKey = lipgloss.NewStyle().
		Foreground(t.Secondary)

	// ─── VU Meter ───

	s.VUMeterBox = lipgloss.NewStyle()

	s.VUMeterFilled = lipgloss.NewStyle().
		Foreground(t.CRTGreen)

	s.VUMeterEmpty = lipgloss.NewStyle().
		Foreground(t.TextMuted)

	// ─── Counter ───

	s.CounterLabel = lipgloss.NewStyle().
		Foreground(t.TextMuted)

	s.CounterValue = lipgloss.NewStyle().
		Foreground(t.Accent).
		Bold(true)

	// ─── Dialogs (DoubleBorder, cassette shell colors) ───

	dialogBase := lipgloss.NewStyle().
		Border(lipgloss.DoubleBorder()).
		BorderForeground(t.BorderFocus).
		Padding(1, 3)

	s.Dialog = dialogBase
	s.DialogBox = dialogBase

	s.DialogTitle = lipgloss.NewStyle().
		Bold(true).
		Foreground(t.Primary)

	s.DialogItem = lipgloss.NewStyle().
		Foreground(t.Text)

	s.DialogDim = lipgloss.NewStyle().
		Foreground(t.TextMuted)

	s.DialogActive = lipgloss.NewStyle().
		Foreground(t.ShellBlack).
		Background(t.Primary).
		Padding(0, 1)

	s.DialogKey = lipgloss.NewStyle().
		Foreground(t.Secondary).
		Bold(true)

	s.DialogDesc = lipgloss.NewStyle().
		Foreground(t.TextMuted)

	s.DialogButton = lipgloss.NewStyle().
		Foreground(t.Text).
		Background(t.Background2).
		Padding(0, 2).
		MarginRight(1)

	s.DialogActiveButton = lipgloss.NewStyle().
		Foreground(t.TextEmphasis).
		Background(t.Primary).
		Padding(0, 2).
		MarginRight(1)

	// ─── Dividers ───

	s.DividerDouble = lipgloss.NewStyle().
		Foreground(t.LinePrimary)

	s.DividerSingle = lipgloss.NewStyle().
		Foreground(t.LineSecondary)

	s.DividerDotted = lipgloss.NewStyle().
		Foreground(t.TextMuted)

	s.DividerDot = lipgloss.NewStyle().
		Foreground(t.TextMuted)

	// ─── Shared ───

	s.Primary = lipgloss.NewStyle().Foreground(t.Primary)
	s.Success = lipgloss.NewStyle().Foreground(t.Success)
	s.Muted = lipgloss.NewStyle().Foreground(t.TextMuted)

	s.Editor = lipgloss.NewStyle().
		BorderTop(true).
		BorderForeground(t.LineSecondary)

	// ─── Sidebar ───

	s.SidebarTitle = lipgloss.NewStyle().
		Bold(true).
		Foreground(t.Primary).
		Padding(0, 1)

	s.SidebarItem = lipgloss.NewStyle().
		Foreground(t.Text).
		Padding(0, 2)

	s.SidebarActive = lipgloss.NewStyle().
		Foreground(t.TextEmphasis).
		Background(t.Primary).
		Padding(0, 2)

	// ─── Legacy aliases (for backward compat with old component code) ───

	s.UserBox = s.MsgBox.Copy().BorderForeground(t.Primary)
	s.UserLabel = lipgloss.NewStyle().Bold(true).Foreground(t.Primary)
	s.AIBox = s.MsgBox
	s.AILabel = lipgloss.NewStyle().Bold(true).Foreground(t.Text)
	s.ToolLine = lipgloss.NewStyle().Foreground(t.Warning)
	s.TokenLine = lipgloss.NewStyle().Foreground(t.TextMuted)

	s.Statusbar = s.StatusBar
	s.StatusbarLeft = lipgloss.NewStyle().Foreground(t.Primary).Bold(true)
	s.StatusbarRight = lipgloss.NewStyle().Foreground(t.TextMuted)
	s.StatusbarCenter = lipgloss.NewStyle().Foreground(t.TextMuted)
	s.StatusLeft = s.StatusbarLeft
	s.StatusRight = s.StatusbarRight
	s.StatusbarLeftStyle = s.StatusbarLeft
	s.StatusbarRightStyle = s.StatusbarRight
	s.StatusbarCenterStyle = s.StatusbarCenter

	s.PaletteTitle = lipgloss.NewStyle().Bold(true).Foreground(t.Primary).Padding(0, 1)
	s.PaletteItem = lipgloss.NewStyle().Foreground(t.Text).Padding(0, 2)
	s.PaletteActive = lipgloss.NewStyle().Foreground(t.TextEmphasis).Background(t.Secondary).Padding(0, 2)

	return s
}