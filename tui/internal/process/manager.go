package process

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

const (
	// ServerEntry is the relative path to the backend server entry point.
	ServerEntry = "cli/index.ts"
	// ServerArgs are the default arguments for npx tsx.
	ServerRunner = "tsx"
	// KillTimeout is how long to wait before force-killing the backend.
	KillTimeout = 5 * time.Second
	// HealthCheckTimeout is the HTTP client timeout for health checks.
	HealthCheckTimeout = 2 * time.Second
	// PollInterval is the interval between health check retries.
	PollInterval = 500 * time.Millisecond
)

// Manager handles the lifecycle of the Python backend process.
type Manager struct {
	cmd     *exec.Cmd
	port    int
	rootDir string
}

// NewManager creates a new process manager.
func NewManager(port int, rootDir string) *Manager {
	return &Manager{
		port:    port,
		rootDir: rootDir,
	}
}

// Start launches the TypeScript backend server via npx tsx.
func (m *Manager) Start() error {
	if m.IsRunning() {
		return nil
	}

	npx := findNodeRunner()
	if npx == "" {
		return fmt.Errorf("npx not found in PATH")
	}

	args := []string{ServerRunner, ServerEntry, "--port", fmt.Sprintf("%d", m.port)}
	m.cmd = exec.Command(npx, args...)
	m.cmd.Dir = m.rootDir
	m.cmd.Stdout = os.Stdout
	m.cmd.Stderr = os.Stderr

	if err := m.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start backend: %w", err)
	}

	return nil
}

// Stop gracefully shuts down the backend.
func (m *Manager) Stop() {
	if m.cmd == nil || m.cmd.Process == nil {
		return
	}
	m.cmd.Process.Signal(os.Interrupt)
	done := make(chan error, 1)
	go func() { done <- m.cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(KillTimeout):
		m.cmd.Process.Kill()
	}
}

// IsRunning checks if the backend is responding.
func (m *Manager) IsRunning() bool {
	resp, err := fmt.Sprintf("http://127.0.0.1:%d/api/health", m.port), error(nil)
	_ = resp
	_ = err
	// Use a simple HTTP check
	client := newSimpleHTTPClient(2 * time.Second)
	url := fmt.Sprintf("http://127.0.0.1:%d/api/health", m.port)
	return clientGet(client, url)
}

// WaitReady polls until the backend is ready or timeout.
func (m *Manager) WaitReady(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if m.IsRunning() {
			return true
		}
		time.Sleep(PollInterval)
	}
	return false
}

// findNodeRunner returns the path to npx.
func findNodeRunner() string {
	candidates := []string{"npx"}
	if runtime.GOOS == "darwin" {
		candidates = append([]string{
			"/opt/homebrew/bin/npx",
			"/usr/local/bin/npx",
		}, candidates...)
	}
	for _, name := range candidates {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	return ""
}

// RootDir returns the project root directory.
func RootDir() string {
	// Try to find the project root by looking for harness/server.ts
	dir, _ := os.Getwd()
	for {
		if _, err := os.Stat(filepath.Join(dir, "harness", "server.ts")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}
