package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
)

// EncryptKubeconfig encrypts raw Kubeconfig bytes using AES-256-GCM.
// Expects secretKey to be 32 bytes (256 bits). Returns base64 encoded ciphertext.
func EncryptKubeconfig(plaintext []byte, secretKey []byte) (string, error) {
	if len(secretKey) != 32 {
		return "", errors.New("crypto: secret key must be exactly 32 bytes for AES-256")
	}

	block, err := aes.NewCipher(secretKey)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	// Seal appends nonce + ciphertext + authTag
	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// DecryptKubeconfig decrypts base64 encoded AES-256-GCM ciphertext back into raw Kubeconfig bytes.
func DecryptKubeconfig(ciphertextBase64 string, secretKey []byte) ([]byte, error) {
	if len(secretKey) != 32 {
		return nil, errors.New("crypto: secret key must be exactly 32 bytes for AES-256")
	}

	data, err := base64.StdEncoding.DecodeString(ciphertextBase64)
	if err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(secretKey)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return nil, errors.New("crypto: ciphertext payload too short")
	}

	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}

	return plaintext, nil
}
