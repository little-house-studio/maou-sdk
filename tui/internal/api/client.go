package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	// DefaultTimeout is the default HTTP client timeout.
	DefaultTimeout = 30 * time.Second
	// StreamTimeout is the timeout for streaming connections.
	StreamTimeout = 120 * time.Second
)

// Client communicates with the maou-agent HTTP backend.
type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

// NewClient creates a new API client with a 30-second default timeout.
func NewClient(baseURL string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTPClient: &http.Client{
			Timeout: DefaultTimeout,
		},
	}
}

// Health checks the server health.
func (c *Client) Health() (*HealthResponse, error) {
	resp, err := c.HTTPClient.Get(c.BaseURL + "/api/health")
	if err != nil {
		return nil, fmt.Errorf("health check failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("health check returned %d", resp.StatusCode)
	}

	var health HealthResponse
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		return nil, fmt.Errorf("failed to decode health: %w", err)
	}
	return &health, nil
}

// Sessions lists all sessions.
func (c *Client) Sessions() ([]Session, error) {
	resp, err := c.HTTPClient.Get(c.BaseURL + "/api/sessions")
	if err != nil {
		return nil, fmt.Errorf("failed to list sessions: %w", err)
	}
	defer resp.Body.Close()

	var result SessionsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode sessions: %w", err)
	}
	return result.Sessions, nil
}

// CreateSession creates a new session.
func (c *Client) CreateSession(title string, agentName string) (*Session, error) {
	body := fmt.Sprintf(`{"title":%q,"agent_name":%q}`, title, agentName)
	resp, err := c.HTTPClient.Post(
		c.BaseURL+"/api/sessions",
		"application/json",
		strings.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}
	defer resp.Body.Close()

	var result CreateSessionResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode session: %w", err)
	}
	return &result.Session, nil
}

// Config fetches the full configuration from the backend.
func (c *Client) Config() (*ConfigResponse, error) {
	resp, err := c.HTTPClient.Get(c.BaseURL + "/api/config")
	if err != nil {
		return nil, fmt.Errorf("failed to get config: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("config returned %d", resp.StatusCode)
	}

	var cfg ConfigResponse
	if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		return nil, fmt.Errorf("failed to decode config: %w", err)
	}
	return &cfg, nil
}

// Usage returns token usage for a session.
func (c *Client) Usage(sessionID string) (*UsageResponse, error) {
	url := fmt.Sprintf("%s/api/sessions/%s/usage", c.BaseURL, sessionID)
	resp, err := c.HTTPClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to get usage: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("usage returned %d", resp.StatusCode)
	}

	var usage UsageResponse
	if err := json.NewDecoder(resp.Body).Decode(&usage); err != nil {
		return nil, fmt.Errorf("failed to decode usage: %w", err)
	}
	return &usage, nil
}

// Variables returns template variables for a session.
func (c *Client) Variables(sessionID string) (*VariablesResponse, error) {
	url := fmt.Sprintf("%s/api/sessions/%s/variables", c.BaseURL, sessionID)
	resp, err := c.HTTPClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to get variables: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("variables returned %d", resp.StatusCode)
	}

	var vars VariablesResponse
	if err := json.NewDecoder(resp.Body).Decode(&vars); err != nil {
		return nil, fmt.Errorf("failed to decode variables: %w", err)
	}
	return &vars, nil
}

// Refresh triggers a prompt refresh.
func (c *Client) Refresh() error {
	resp, err := c.HTTPClient.Post(c.BaseURL+"/api/refresh", "application/json", nil)
	if err != nil {
		return fmt.Errorf("refresh failed: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

// Run sends a message and returns a channel of ndjson StreamEvents.
// Uses a dedicated HTTP client with a 120-second timeout.
func (c *Client) Run(sessionID string, message string) (<-chan StreamEvent, error) {
	body := fmt.Sprintf(`{"session_id":%q,"message":%q,"stream":true}`, sessionID, message)

	// Use a longer-lived client for streaming
	streamClient := &http.Client{Timeout: StreamTimeout}
	req, err := http.NewRequest("POST", c.BaseURL+"/api/run", strings.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := streamClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send message: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("run returned %d", resp.StatusCode)
	}

	ch := make(chan StreamEvent, 100)
	go parseNdjsonStream(resp.Body, ch)
	return ch, nil
}

// parseNdjsonStream reads newline-delimited JSON from the body and sends
// each parsed event on ch. Closes ch when the stream ends.
func parseNdjsonStream(body io.ReadCloser, ch chan<- StreamEvent) {
	defer close(ch)
	defer body.Close()

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024) // 1MB max line

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var event StreamEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}
		ch <- event
	}
}
