package process

import (
	"net/http"
	"time"
)

func newSimpleHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout}
}

func clientGet(client *http.Client, url string) bool {
	resp, err := client.Get(url)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
