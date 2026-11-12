package sshsession

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"golang.org/x/crypto/ssh"
)

// AuthType defines supported authentication categories.
type AuthType string

const (
	AuthTypePassword            AuthType = "password"
	AuthTypePrivateKey          AuthType = "key"
	AuthTypeAgent               AuthType = "agent"
	AuthTypeKeyboardInteractive AuthType = "keyboard-interactive"
	AuthTypeAuto                AuthType = "auto"
)

// KeyboardInteractiveChallengeHandler abstracts dynamic RFC 4256 challenge-response prompts.
type KeyboardInteractiveChallengeHandler func(user, instruction string, questions []string, echos []bool) ([]string, error)

// AuthenticationProvider abstracts different SSH authentication strategies.
type AuthenticationProvider interface {
	Type() AuthType
	BuildAuthMethods() ([]ssh.AuthMethod, error)
}

// -------------------------------------------------------------------------
// 1. PasswordAuthProvider
// -------------------------------------------------------------------------

type PasswordAuthProvider struct {
	Password string
}

func (p *PasswordAuthProvider) Type() AuthType {
	return AuthTypePassword
}

func (p *PasswordAuthProvider) BuildAuthMethods() ([]ssh.AuthMethod, error) {
	// Provide standard password method and keyboard-interactive challenge response
	return []ssh.AuthMethod{
		ssh.Password(p.Password),
		ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) ([]string, error) {
			answers := make([]string, len(questions))
			for i := range questions {
				answers[i] = p.Password
			}
			return answers, nil
		}),
	}, nil
}

// -------------------------------------------------------------------------
// 2. PrivateKeyAuthProvider
// -------------------------------------------------------------------------

type PrivateKeyAuthProvider struct {
	KeyPath         string
	KeyPEM          []byte
	KeyPassphrase   string
	CertificatePath string
	CertificatePEM  []byte
}

func (p *PrivateKeyAuthProvider) Type() AuthType {
	return AuthTypePrivateKey
}

func (p *PrivateKeyAuthProvider) BuildAuthMethods() ([]ssh.AuthMethod, error) {
	keyPath := ExpandUserPath(p.KeyPath)
	keyData := p.KeyPEM
	if len(keyData) == 0 && keyPath != "" {
		data, err := os.ReadFile(keyPath)
		if err != nil {
			return nil, fmt.Errorf("read private key file %s: %w", keyPath, err)
		}
		keyData = data
	}

	if len(keyData) == 0 {
		return nil, errors.New("private key data is empty")
	}

	var signer ssh.Signer
	var parseErr error

	if p.KeyPassphrase != "" {
		signer, parseErr = ssh.ParsePrivateKeyWithPassphrase(keyData, []byte(p.KeyPassphrase))
	} else {
		signer, parseErr = ssh.ParsePrivateKey(keyData)
	}

	if parseErr != nil {
		if errors.Is(parseErr, &ssh.PassphraseMissingError{}) ||
			strings.Contains(parseErr.Error(), "passphrase") ||
			strings.Contains(parseErr.Error(), "encrypted") {
			return nil, fmt.Errorf("private key is encrypted: passphrase required (%w)", parseErr)
		}
		return nil, fmt.Errorf("parse private key: %w", parseErr)
	}

	// Check for OpenSSH Certificate
	certData := p.CertificatePEM
	if len(certData) == 0 && p.CertificatePath != "" {
		if cData, err := os.ReadFile(ExpandUserPath(p.CertificatePath)); err == nil {
			certData = cData
		}
	} else if len(certData) == 0 && keyPath != "" {
		// Standard OpenSSH certificate file convention: <key>-cert.pub
		certFile := keyPath + "-cert.pub"
		if cData, err := os.ReadFile(certFile); err == nil {
			certData = cData
		}
	}

	if len(certData) > 0 {
		pubKey, _, _, _, err := ssh.ParseAuthorizedKey(certData)
		if err == nil {
			if cert, ok := pubKey.(*ssh.Certificate); ok {
				certSigner, err := ssh.NewCertSigner(cert, signer)
				if err == nil {
					return []ssh.AuthMethod{ssh.PublicKeys(certSigner)}, nil
				}
			}
		}
	}

	return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
}

// -------------------------------------------------------------------------
// 3. SSHAgentAuthProvider
// -------------------------------------------------------------------------

type SSHAgentAuthProvider struct {
	CustomSocket string
}

func (p *SSHAgentAuthProvider) Type() AuthType {
	return AuthTypeAgent
}

func (p *SSHAgentAuthProvider) BuildAuthMethods() ([]ssh.AuthMethod, error) {
	agentClient, _, err := DialSSHAgent(p.CustomSocket)
	if err != nil {
		return nil, fmt.Errorf("ssh-agent connection error: %w", err)
	}

	signers, err := agentClient.Signers()
	if err != nil {
		return nil, fmt.Errorf("retrieve signers from ssh-agent: %w", err)
	}
	if len(signers) == 0 {
		return nil, errors.New("ssh-agent is running but has no identities loaded (add keys via ssh-add)")
	}

	return []ssh.AuthMethod{ssh.PublicKeysCallback(agentClient.Signers)}, nil
}

// CheckAgentStatus inspects whether a local SSH Agent is reachable and reports its key count.
func CheckAgentStatus() (bool, int, error) {
	agentClient, closer, err := DialSSHAgent("")
	if err != nil {
		return false, 0, err
	}
	if closer != nil {
		defer closer.Close()
	}

	signers, err := agentClient.Signers()
	if err != nil {
		return false, 0, err
	}

	return true, len(signers), nil
}

// -------------------------------------------------------------------------
// 4. KeyboardInteractiveAuthProvider
// -------------------------------------------------------------------------

type KeyboardInteractiveAuthProvider struct {
	Password string
	Prompt   KeyboardInteractiveChallengeHandler
}

func (p *KeyboardInteractiveAuthProvider) Type() AuthType {
	return AuthTypeKeyboardInteractive
}

func (p *KeyboardInteractiveAuthProvider) BuildAuthMethods() ([]ssh.AuthMethod, error) {
	handler := func(user, instruction string, questions []string, echos []bool) ([]string, error) {
		if len(questions) == 0 {
			return []string{}, nil
		}

		// 1. If an interactive prompt handler is available, invoke it
		if p.Prompt != nil {
			answers, err := p.Prompt(user, instruction, questions, echos)
			if err == nil && len(answers) == len(questions) {
				return answers, nil
			}
			if err != nil {
				return nil, err
			}
		}

		// 2. Fallback: answer password if question is a password query and password is provided
		if p.Password != "" {
			answers := make([]string, len(questions))
			for i, q := range questions {
				lower := strings.ToLower(q)
				if strings.Contains(lower, "password") || strings.Contains(lower, "passphrase") {
					answers[i] = p.Password
				}
			}
			return answers, nil
		}

		return nil, errors.New("keyboard-interactive authentication requires challenge response answers")
	}

	return []ssh.AuthMethod{ssh.KeyboardInteractive(handler)}, nil
}
