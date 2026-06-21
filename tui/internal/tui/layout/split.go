package layout

import "github.com/charmbracelet/lipgloss"

// SplitPane renders two panes side by side (horizontal split).
// ratio controls the left pane width as a fraction of the total (0.0-1.0).
func SplitPane(width, height int, left, right string, ratio float64) string {
	leftWidth := int(float64(width) * ratio)
	rightWidth := width - leftWidth
	l := lipgloss.NewStyle().Width(leftWidth).Height(height).Render(left)
	r := lipgloss.NewStyle().Width(rightWidth).Height(height).Render(right)
	return lipgloss.JoinHorizontal(lipgloss.Top, l, r)
}

// SplitPaneVertical renders two panes stacked vertically.
// ratio controls the top pane height as a fraction of the total (0.0-1.0).
func SplitPaneVertical(width, height int, top, bottom string, ratio float64) string {
	topHeight := int(float64(height) * ratio)
	bottomHeight := height - topHeight
	t := lipgloss.NewStyle().Width(width).Height(topHeight).Render(top)
	b := lipgloss.NewStyle().Width(width).Height(bottomHeight).Render(bottom)
	return lipgloss.JoinVertical(lipgloss.Left, t, b)
}
