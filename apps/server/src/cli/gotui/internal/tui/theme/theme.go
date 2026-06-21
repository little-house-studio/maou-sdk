package theme

import "github.com/charmbracelet/lipgloss"

// Theme defines the Cassette Futurism color palette.
//
// Reference: cli/DESIGN.md Section 3 — CRT Phosphors + Cassette Shell Colors.
type Theme struct {
	Name string

	// CRT Phosphor colors (丹顶 / 荧光粉发光色)
	CRTGreen     lipgloss.AdaptiveColor // P3 Phosphor Green  #00FF41 — 主交互色、光标、选中
	CRTAmber     lipgloss.AdaptiveColor // Amber Phosphor     #FFB000 — 警告、高亮
	CRTWhite     lipgloss.AdaptiveColor // Cool White         #E0E0E0 — 正文
	CRTWarmWhite lipgloss.AdaptiveColor // Warm White         #FFD7AF — 次级文字（模拟老化荧光粉）

	// Cassette Shell colors (磁带壳体色)
	ShellBlack  lipgloss.AdaptiveColor // 炭黑磁带壳  #1A1A1A — 主背景
	ShellDark   lipgloss.AdaptiveColor // 深灰磁带壳  #2A2A2A — 次级面板背景
	ShellClear  lipgloss.AdaptiveColor // 透明磁带壳  #333333 — 输入区背景
	ShellLabel  lipgloss.AdaptiveColor // 标签纸白    #F5F0E8 — 极小面积点缀（按钮文字）
	ShellRed    lipgloss.AdaptiveColor // 红色录音键  #CC0000 — 危险操作 / 删除
	ShellOrange lipgloss.AdaptiveColor // 橙色计数器  #FF6600 — 进度指示

	// Functional (these map to old field names for compatibility)
	Text         lipgloss.AdaptiveColor // → CRTWhite
	TextMuted    lipgloss.AdaptiveColor // → dim gray
	TextEmphasis lipgloss.AdaptiveColor // → ShellLabel (high contrast)
	Background   lipgloss.AdaptiveColor // → ShellBlack
	Background2  lipgloss.AdaptiveColor // → ShellDark
	BorderNormal lipgloss.AdaptiveColor // → line dim
	BorderFocus  lipgloss.AdaptiveColor // → CRTGreen
	Primary      lipgloss.AdaptiveColor // → CRTGreen
	Secondary    lipgloss.AdaptiveColor // → CRTAmber
	Accent       lipgloss.AdaptiveColor // → ShellOrange
	Success      lipgloss.AdaptiveColor // → dim green
	Warning      lipgloss.AdaptiveColor // → CRTAmber
	Error        lipgloss.AdaptiveColor // → ShellRed
	Info         lipgloss.AdaptiveColor // → blue-gray

	// Line colors
	LinePrimary   lipgloss.AdaptiveColor // 主线分隔  #444444
	LineSecondary lipgloss.AdaptiveColor // 次线分隔  #333333
	LineActive    lipgloss.AdaptiveColor // 激活线    #00FF41
}

// Default returns the Cassette Dark theme (CRT Phosphor + Shell Black).
func Default() Theme {
	return Theme{
		Name: "cassette-dark",

		// CRT Phosphors
		CRTGreen:     lipgloss.AdaptiveColor{Light: "#00CC41", Dark: "#00FF41"},
		CRTAmber:     lipgloss.AdaptiveColor{Light: "#CC8800", Dark: "#FFB000"},
		CRTWhite:     lipgloss.AdaptiveColor{Light: "#2A2A2A", Dark: "#E0E0E0"},
		CRTWarmWhite: lipgloss.AdaptiveColor{Light: "#8A6A3A", Dark: "#FFD7AF"},

		// Cassette Shell
		ShellBlack:  lipgloss.AdaptiveColor{Light: "#F0F0F0", Dark: "#1A1A1A"},
		ShellDark:   lipgloss.AdaptiveColor{Light: "#E0E0E0", Dark: "#2A2A2A"},
		ShellClear:  lipgloss.AdaptiveColor{Light: "#D0D0D0", Dark: "#333333"},
		ShellLabel:  lipgloss.AdaptiveColor{Light: "#333333", Dark: "#F5F0E8"},
		ShellRed:    lipgloss.AdaptiveColor{Light: "#AA0000", Dark: "#CC0000"},
		ShellOrange: lipgloss.AdaptiveColor{Light: "#CC4400", Dark: "#FF6600"},

		// Functional (aliases mapped from new colors)
		Text:         lipgloss.AdaptiveColor{Light: "#2A2A2A", Dark: "#E0E0E0"},
		TextMuted:    lipgloss.AdaptiveColor{Light: "#888888", Dark: "#666666"},
		TextEmphasis: lipgloss.AdaptiveColor{Light: "#1A1A1A", Dark: "#F5F0E8"},
		Background:   lipgloss.AdaptiveColor{Light: "#F0F0F0", Dark: "#1A1A1A"},
		Background2:  lipgloss.AdaptiveColor{Light: "#E0E0E0", Dark: "#2A2A2A"},
		BorderNormal: lipgloss.AdaptiveColor{Light: "#AAAAAA", Dark: "#444444"},
		BorderFocus:  lipgloss.AdaptiveColor{Light: "#00AA33", Dark: "#00FF41"},
		Primary:      lipgloss.AdaptiveColor{Light: "#00AA33", Dark: "#00FF41"},
		Secondary:    lipgloss.AdaptiveColor{Light: "#CC8800", Dark: "#FFB000"},
		Accent:       lipgloss.AdaptiveColor{Light: "#CC4400", Dark: "#FF6600"},
		Success:      lipgloss.AdaptiveColor{Light: "#009944", Dark: "#00CC66"},
		Warning:      lipgloss.AdaptiveColor{Light: "#CC8800", Dark: "#FFB000"},
		Error:        lipgloss.AdaptiveColor{Light: "#AA0000", Dark: "#CC0000"},
		Info:         lipgloss.AdaptiveColor{Light: "#0066AA", Dark: "#0088CC"},

		// Lines
		LinePrimary:   lipgloss.AdaptiveColor{Light: "#BBBBBB", Dark: "#444444"},
		LineSecondary: lipgloss.AdaptiveColor{Light: "#CCCCCC", Dark: "#333333"},
		LineActive:    lipgloss.AdaptiveColor{Light: "#00AA33", Dark: "#00FF41"},
	}
}

// CassetteLight returns a light variant (paper label style).
func CassetteLight() Theme {
	return Theme{
		Name: "cassette-light",

		CRTGreen:     lipgloss.AdaptiveColor{Light: "#007722", Dark: "#007722"},
		CRTAmber:     lipgloss.AdaptiveColor{Light: "#996600", Dark: "#996600"},
		CRTWhite:     lipgloss.AdaptiveColor{Light: "#1A1A1A", Dark: "#1A1A1A"},
		CRTWarmWhite: lipgloss.AdaptiveColor{Light: "#665544", Dark: "#665544"},

		ShellBlack:  lipgloss.AdaptiveColor{Light: "#F5F0E8", Dark: "#F5F0E8"},
		ShellDark:   lipgloss.AdaptiveColor{Light: "#E8E0D5", Dark: "#E8E0D5"},
		ShellClear:  lipgloss.AdaptiveColor{Light: "#DDD5C8", Dark: "#DDD5C8"},
		ShellLabel:  lipgloss.AdaptiveColor{Light: "#1A1A1A", Dark: "#1A1A1A"},
		ShellRed:    lipgloss.AdaptiveColor{Light: "#AA0000", Dark: "#AA0000"},
		ShellOrange: lipgloss.AdaptiveColor{Light: "#CC4400", Dark: "#CC4400"},

		Text:         lipgloss.AdaptiveColor{Light: "#1A1A1A", Dark: "#1A1A1A"},
		TextMuted:    lipgloss.AdaptiveColor{Light: "#888888", Dark: "#888888"},
		TextEmphasis: lipgloss.AdaptiveColor{Light: "#000000", Dark: "#000000"},
		Background:   lipgloss.AdaptiveColor{Light: "#F5F0E8", Dark: "#F5F0E8"},
		Background2:  lipgloss.AdaptiveColor{Light: "#E8E0D5", Dark: "#E8E0D5"},
		BorderNormal: lipgloss.AdaptiveColor{Light: "#999999", Dark: "#999999"},
		BorderFocus:  lipgloss.AdaptiveColor{Light: "#007722", Dark: "#007722"},
		Primary:      lipgloss.AdaptiveColor{Light: "#007722", Dark: "#007722"},
		Secondary:    lipgloss.AdaptiveColor{Light: "#996600", Dark: "#996600"},
		Accent:       lipgloss.AdaptiveColor{Light: "#CC4400", Dark: "#CC4400"},
		Success:      lipgloss.AdaptiveColor{Light: "#008844", Dark: "#008844"},
		Warning:      lipgloss.AdaptiveColor{Light: "#996600", Dark: "#996600"},
		Error:        lipgloss.AdaptiveColor{Light: "#AA0000", Dark: "#AA0000"},
		Info:         lipgloss.AdaptiveColor{Light: "#005588", Dark: "#005588"},

		LinePrimary:   lipgloss.AdaptiveColor{Light: "#BBBBBB", Dark: "#BBBBBB"},
		LineSecondary: lipgloss.AdaptiveColor{Light: "#CCCCCC", Dark: "#CCCCCC"},
		LineActive:    lipgloss.AdaptiveColor{Light: "#007722", Dark: "#007722"},
	}
}