package main

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureCertificateCreatesReusableLocalhostCertificate(t *testing.T) {
	dir := t.TempDir()
	certPath := filepath.Join(dir, "cert.pem")
	keyPath := filepath.Join(dir, "key.pem")

	created, err := ensureCertificate(certPath, keyPath)
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Fatal("expected a new certificate")
	}

	if _, err := tls.LoadX509KeyPair(certPath, keyPath); err != nil {
		t.Fatalf("load certificate pair: %v", err)
	}
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(certPEM)
	if block == nil {
		t.Fatal("certificate is not PEM encoded")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	for _, host := range []string{"localhost", "127.0.0.1", "::1"} {
		if err := cert.VerifyHostname(host); err != nil {
			t.Errorf("certificate does not cover %s: %v", host, err)
		}
	}

	created, err = ensureCertificate(certPath, keyPath)
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Fatal("expected the existing certificate to be reused")
	}
	reusedPEM, err := os.ReadFile(certPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(certPEM, reusedPEM) {
		t.Fatal("existing certificate changed")
	}
}

func TestEnsureCertificateRejectsIncompletePair(t *testing.T) {
	dir := t.TempDir()
	certPath := filepath.Join(dir, "cert.pem")
	keyPath := filepath.Join(dir, "key.pem")
	if err := os.WriteFile(certPath, []byte("cert"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := ensureCertificate(certPath, keyPath); err == nil {
		t.Fatal("expected an incomplete certificate pair error")
	}
}
