package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/wang4386/CDT-Monitor/internal/store"
)

func TestSecurityHeadersAllowFaviconEndpoint(t *testing.T) {
	server := &Server{}
	handler := server.securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodGet, "http://monitor.example.com/", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	csp := response.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "img-src 'self' data: https://a.favicon.im") {
		t.Fatalf("favicon endpoint missing from CSP: %s", csp)
	}
}

func TestBeginPasskeyLoginIncludesRegisteredCredentialIDs(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	credentialID := []byte("desktop-bitwarden-credential")
	if err = st.SavePasskey(t.Context(), "PC Bitwarden", webauthn.Credential{ID: credentialID, PublicKey: []byte("test-key")}); err != nil {
		t.Fatal(err)
	}

	server := &Server{store: st, limits: make(map[string]*rateWindow), passkeys: make(map[string]passkeySession)}
	request := httptest.NewRequest(http.MethodPost, "http://monitor.example.com/api/v1/auth/passkeys/begin", strings.NewReader(`{}`))
	request.Header.Set("X-Forwarded-Proto", "https")
	response := httptest.NewRecorder()
	server.beginPasskeyLogin(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		SessionID string `json:"session_id"`
		PublicKey struct {
			PublicKey struct {
				AllowCredentials []struct {
					ID string `json:"id"`
				} `json:"allowCredentials"`
			} `json:"publicKey"`
		} `json:"public_key"`
	}
	if err = json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.PublicKey.PublicKey.AllowCredentials) != 1 || payload.PublicKey.PublicKey.AllowCredentials[0].ID != base64.RawURLEncoding.EncodeToString(credentialID) {
		t.Fatalf("allowCredentials = %#v", payload.PublicKey.PublicKey.AllowCredentials)
	}
	ceremony, ok := server.passkeys[payload.SessionID]
	if !ok || string(ceremony.session.UserID) != adminWebAuthnID {
		t.Fatalf("login session does not identify the admin user: %#v", ceremony.session.UserID)
	}
}

func TestBeginPasskeyLoginRejectsEmptyCredentialList(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	server := &Server{store: st, limits: make(map[string]*rateWindow), passkeys: make(map[string]passkeySession)}
	request := httptest.NewRequest(http.MethodPost, "http://monitor.example.com/api/v1/auth/passkeys/begin", strings.NewReader(`{}`))
	request.Header.Set("X-Forwarded-Proto", "https")
	response := httptest.NewRecorder()
	server.beginPasskeyLogin(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}
