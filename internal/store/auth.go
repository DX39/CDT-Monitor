package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/wang4386/CDT-Monitor/internal/domain"
	"github.com/wang4386/CDT-Monitor/internal/security"
)

func (s *Store) VerifyAdminPassword(ctx context.Context, password string) (bool, error) {
	var encoded string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key='admin_password'`).Scan(&encoded)
	if err != nil {
		return false, err
	}
	if !security.VerifyPassword(encoded, password) {
		return false, nil
	}
	if !strings.HasPrefix(encoded, "$argon2id$") {
		hash, err := security.HashLegacyPassword(password)
		if err != nil {
			return false, err
		}
		if _, err = s.db.ExecContext(ctx, `UPDATE settings SET value=? WHERE key='admin_password'`, hash); err != nil {
			return false, err
		}
	}
	return true, nil
}

func (s *Store) RecentLoginFailures(ctx context.Context, ip string, since time.Time) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM login_attempts WHERE ip=? AND attempt_time>?`, ip, since.Unix()).Scan(&count)
	return count, err
}

func (s *Store) RecordLoginFailure(ctx context.Context, ip string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO login_attempts(ip,attempt_time) VALUES(?,unixepoch())`, ip)
	return err
}

func (s *Store) ClearLoginFailures(ctx context.Context, ip string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM login_attempts WHERE ip=?`, ip)
	return err
}

func (s *Store) CreateSession(ctx context.Context, ip, userAgent string, ttl time.Duration) (string, error) {
	token, err := security.NewToken(32)
	if err != nil {
		return "", err
	}
	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `INSERT INTO sessions(token_hash,ip,user_agent,created_at,expires_at) VALUES(?,?,?,?,?)`,
		security.TokenHash(token), ip, userAgent, now.Unix(), now.Add(ttl).Unix())
	return token, err
}

func (s *Store) ValidateSession(ctx context.Context, token string) (bool, error) {
	if token == "" {
		return false, nil
	}
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions WHERE token_hash=? AND expires_at>unixepoch()`, security.TokenHash(token)).Scan(&count)
	return count == 1, err
}

func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash=?`, security.TokenHash(token))
	return err
}

func (s *Store) CreateAPIKey(ctx context.Context, name string, scopes []string, expiresAt *time.Time) (domain.APIKey, string, error) {
	if strings.TrimSpace(name) == "" || len(scopes) == 0 {
		return domain.APIKey{}, "", errors.New("api key name and at least one scope are required")
	}
	secret, err := security.NewToken(32)
	if err != nil {
		return domain.APIKey{}, "", err
	}
	token := "cdt_" + secret
	scopeJSON, _ := json.Marshal(scopes)
	now := time.Now().UTC()
	var expires any
	if expiresAt != nil {
		expires = expiresAt.Unix()
	}
	result, err := s.db.ExecContext(ctx, `INSERT INTO api_keys(name,token_hash,scopes,created_at,expires_at) VALUES(?,?,?,?,?)`,
		name, security.TokenHash(token), string(scopeJSON), now.Unix(), expires)
	if err != nil {
		return domain.APIKey{}, "", err
	}
	id, _ := result.LastInsertId()
	return domain.APIKey{ID: id, Name: name, Scopes: scopes, CreatedAt: now, ExpiresAt: expiresAt}, token, nil
}

func (s *Store) ListAPIKeys(ctx context.Context) ([]domain.APIKey, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,scopes,created_at,last_used_at,expires_at,revoked_at FROM api_keys ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []domain.APIKey
	for rows.Next() {
		var key domain.APIKey
		var scopes string
		var created int64
		var lastUsed, expires, revoked sql.NullInt64
		if err = rows.Scan(&key.ID, &key.Name, &scopes, &created, &lastUsed, &expires, &revoked); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(scopes), &key.Scopes)
		key.CreatedAt = time.Unix(created, 0).UTC()
		key.LastUsedAt, key.ExpiresAt, key.RevokedAt = nullTime(lastUsed), nullTime(expires), nullTime(revoked)
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func (s *Store) RevokeAPIKey(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `UPDATE api_keys SET revoked_at=unixepoch() WHERE id=?`, id)
	return err
}

func (s *Store) ValidateAPIKey(ctx context.Context, token string) ([]string, error) {
	if token == "" {
		return nil, sql.ErrNoRows
	}
	var scopes string
	err := s.db.QueryRowContext(ctx, `SELECT scopes FROM api_keys WHERE token_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>unixepoch())`, security.TokenHash(token)).Scan(&scopes)
	if err != nil {
		return nil, err
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE api_keys SET last_used_at=unixepoch() WHERE token_hash=?`, security.TokenHash(token))
	var result []string
	if err = json.Unmarshal([]byte(scopes), &result); err != nil {
		return nil, err
	}
	return result, nil
}
