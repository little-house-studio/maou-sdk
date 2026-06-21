package api

// HealthResponse represents the /api/health response.
type HealthResponse struct {
	OK       bool    `json:"ok"`
	Uptime   float64 `json:"uptime"`
	Sessions int     `json:"sessions_count"`
	Version  string  `json:"version"`
}

// Session represents a conversation session.
type Session struct {
	ID        string `json:"id"`
	AgentName string `json:"agent_name"`
	Title     string `json:"title"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// SessionsResponse represents the /api/sessions response.
type SessionsResponse struct {
	Sessions []Session `json:"sessions"`
}

// CreateSessionResponse represents the POST /api/sessions response.
type CreateSessionResponse struct {
	Session Session `json:"session"`
}

// UsageResponse represents the GET /api/sessions/{id}/usage response.
type UsageResponse struct {
	Model            string  `json:"model"`
	MessageCount     int     `json:"message_count"`
	PromptTokens     int     `json:"prompt_tokens"`
	CompletionTokens int     `json:"completion_tokens"`
	TotalTokens      int     `json:"total_tokens"`
	CacheHitRate     float64 `json:"cache_hit_rate"`
}

// ConfigResponse represents the GET /api/config response.
type ConfigResponse struct {
	User    UserConfig    `json:"user"`
	Project ProjectConfig `json:"project"`
}

// UserConfig represents the user-level configuration.
type UserConfig struct {
	API APIBlock `json:"api"`
}

// APIBlock represents the api section of user config.
type APIBlock struct {
	Default       string                      `json:"default"`
	CustomPresets map[string]CustomPresetBlock `json:"custom_presets"`
}

// CustomPresetBlock represents a single custom preset in config.
type CustomPresetBlock struct {
	Model     string `json:"model"`
	MaxTokens int    `json:"maxTokens"`
}

// ProjectConfig represents the project-level configuration.
type ProjectConfig struct {
	Permissions PermissionsBlock `json:"permissions"`
}

// PermissionsBlock represents the permissions section of project config.
type PermissionsBlock struct {
	MaxRoundsPerRun int `json:"max_rounds_per_run"`
}

// VariablesResponse represents the GET /api/sessions/{id}/variables response.
type VariablesResponse struct {
	Variables map[string]interface{} `json:"variables"`
}

// StreamEvent represents a single JSON event from POST /api/run (ndjson format).
type StreamEvent struct {
	Type    string      `json:"type"`
	Content string      `json:"content,omitempty"`
	Delta   string      `json:"delta,omitempty"`   // assistant_delta uses this
	Round   int         `json:"round,omitempty"`
	Message string      `json:"message,omitempty"` // error events
	Session string      `json:"session,omitempty"` // done events
	Tool    interface{} `json:"tool,omitempty"`     // tool_call events
	OK      *bool       `json:"ok,omitempty"`       // tool_result events
	Usage   interface{} `json:"usage,omitempty"`    // assistant events
}
