package cmd

import (
	"fmt"
	"os"

	"maou-tui/internal/api"
	"maou-tui/internal/process"
	"maou-tui/internal/tui"
	"maou-tui/internal/tui/theme"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"
)

var (
	port      int
	noServer  bool
	themeName string
)

var rootCmd = &cobra.Command{
	Use:   "maou-tui",
	Short: "Maou Agent TUI — Cassette Futurism 终端界面",
	Long:  "Maou Agent 的磁带未来主义终端界面，使用 Bubbletea 构建。自动管理 TS 后端进程 (npx tsx)。",
	RunE:  run,
}

func init() {
	rootCmd.Flags().IntVarP(&port, "port", "p", 8099, "后端服务端口")
	rootCmd.Flags().BoolVar(&noServer, "no-server", false, "不自动启动后端（连接已有服务）")
	rootCmd.Flags().StringVarP(&themeName, "theme", "t", "default", "主题 (default, light)")
}

// Execute runs the root command.
func Execute() error {
	return rootCmd.Execute()
}

func run(cmd *cobra.Command, args []string) error {
	// Find project root
	rootDir := process.RootDir()
	if rootDir == "" {
		return fmt.Errorf("could not find project root (looking for harness/server.ts)")
	}

	// Manage backend process
	mgr := process.NewManager(port, rootDir)

	if !noServer {
		if !mgr.IsRunning() {
			fmt.Fprintln(os.Stderr, "启动 Maou Agent 后端...")
			if err := mgr.Start(); err != nil {
				return fmt.Errorf("failed to start backend: %w", err)
			}
			if !mgr.WaitReady(30) {
				return fmt.Errorf("backend did not become ready within 30s")
			}
			fmt.Fprintln(os.Stderr, "后端已就绪。")
		}
	}

	// Select theme (cassette-dark or cassette-light)
	var t theme.Theme
	switch themeName {
	case "light":
		t = theme.CassetteLight()
	default:
		t = theme.Default()
	}

	// Create API client
	client := api.NewClient(fmt.Sprintf("http://127.0.0.1:%d", port))

	// Verify connection
	if _, err := client.Health(); err != nil {
		return fmt.Errorf("cannot connect to backend: %w", err)
	}

	// Run TUI
	model := tui.New(client, t)
	p := tea.NewProgram(model, tea.WithAltScreen())

	// Cleanup on exit
	defer func() {
		if !noServer {
			fmt.Fprintln(os.Stderr, "正在关闭后端...")
			mgr.Stop()
		}
	}()

	if _, err := p.Run(); err != nil {
		return fmt.Errorf("TUI error: %w", err)
	}

	return nil
}