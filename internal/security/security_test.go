package security

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPasswordHashAndVerify(t *testing.T) {
	hash, err := HashPassword("Correct-Horse-42!")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword(hash, "Correct-Horse-42!") {
		t.Fatal("expected password to verify")
	}
	if VerifyPassword(hash, "wrong-password") {
		t.Fatal("wrong password must not verify")
	}
}

func TestLegacyShortPasswordCanBeUpgraded(t *testing.T) {
	hash, err := HashLegacyPassword("short")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword(hash, "short") {
		t.Fatal("legacy short password should still verify during migration")
	}
}

func TestCipherPersistsMasterKey(t *testing.T) {
	dir := t.TempDir()
	first, err := LoadOrCreateCipher(dir)
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := first.Encrypt("sensitive-value")
	if err != nil {
		t.Fatal(err)
	}
	second, err := LoadOrCreateCipher(dir)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := second.Decrypt(encrypted)
	if err != nil || plain != "sensitive-value" {
		t.Fatalf("decrypt = %q, %v", plain, err)
	}
	info, err := os.Stat(filepath.Join(dir, "master.key"))
	if err != nil || info.Size() == 0 {
		t.Fatal("master key was not persisted")
	}
}
