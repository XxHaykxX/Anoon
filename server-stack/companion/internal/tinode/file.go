package tinode

// file.go is the one place companion talks to Tinode over HTTP instead of gRPC:
// attachments live behind Tinode's file endpoint, which has no gRPC equivalent.
//
// It exists for the admin panel. A chat message carries its attachment as a
// bare ref (`/v0/file/s/<id>`), which is a path on TINODE's origin — paste it
// into the panel and the browser asks the panel's own server for it and gets a
// 404. Tinode will not serve it to that browser either: the handler refuses
// without both an api key and an authenticated session (server/hdl_files.go,
// largeFileServeHTTP), and the operator has no Tinode account at all.
//
// So companion fetches it as ROOT and streams it through. The credentials stay
// here — handing the browser a URL with ROOT's secret in the query string would
// give every operator the keys to the whole server.

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// FileEndpoint configures the HTTP half of the client. Empty baseURL leaves the
// file proxy disabled — FetchFile then refuses rather than dialling something
// unintended.
func (c *Client) FileEndpoint(baseURL, apiKey string) {
	c.fileBase = strings.TrimRight(baseURL, "/")
	c.apiKey = apiKey
}

// FetchFile downloads a Tinode attachment as ROOT and returns the open body
// together with its content type. The caller closes the body.
//
// `ref` must be a Tinode file path, already validated by the caller (the api
// layer's validMediaURL): everything after the base URL is attacker-influenced
// data that came out of a chat message.
func (c *Client) FetchFile(ctx context.Context, ref string) (io.ReadCloser, string, error) {
	if c.fileBase == "" {
		return nil, "", fmt.Errorf("tinode: file endpoint not configured")
	}
	if !strings.HasPrefix(ref, "/") {
		return nil, "", fmt.Errorf("tinode: file ref must be a path")
	}

	// Auth rides in the query string: this is a plain GET issued by a proxy, and
	// Tinode reads `auth`/`secret` there exactly as it does from a header. The
	// basic secret is base64 of "login:password" — the same encoding the login
	// frame uses, and the thing that silently answers 400 when sent raw.
	q := url.Values{
		"apikey": {c.apiKey},
		"auth":   {"basic"},
		"secret": {base64.StdEncoding.EncodeToString([]byte(c.login + ":" + c.secret))},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.fileBase+ref+"?"+q.Encode(), nil)
	if err != nil {
		return nil, "", fmt.Errorf("tinode: file request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("tinode: fetch file: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		_ = resp.Body.Close()
		return nil, "", fmt.Errorf("tinode: fetch file: %s", resp.Status)
	}
	return resp.Body, resp.Header.Get("Content-Type"), nil
}
