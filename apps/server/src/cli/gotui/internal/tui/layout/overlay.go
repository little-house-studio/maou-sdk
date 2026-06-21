package layout

import "github.com/charmbracelet/lipgloss"

// PlaceOverlay centers the foreground string over the background using the
// background's rendered dimensions. fgWidth/fgHeight are ignored — the
// foreground is measured automatically by lipgloss.
func PlaceOverlay(fg, bg string, width, height int) string {
	return lipgloss.Place(
		lipgloss.Width(bg),
		lipgloss.Height(bg),
		lipgloss.Center,
		lipgloss.Center,
		fg,
	)
}
