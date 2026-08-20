// Command httpsproxy serves the local HTTP app over HTTPS.
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

const (
	defaultListen = "localhost:8443"
	defaultTarget = "http://localhost:8000"
	defaultCert   = ".certs/localhost-cert.pem"
	defaultKey    = ".certs/localhost-key.pem"
)

func main() {
	listen := flag.String("listen", defaultListen, "HTTPS listen address")
	targetValue := flag.String("target", defaultTarget, "HTTP URL to proxy to")
	certPath := flag.String("cert", defaultCert, "TLS certificate path")
	keyPath := flag.String("key", defaultKey, "TLS private key path")
	flag.Parse()

	target, err := url.Parse(*targetValue)
	if err != nil || target.Scheme == "" || target.Host == "" {
		log.Fatalf("invalid target %q", *targetValue)
	}

	created, err := ensureCertificate(*certPath, *keyPath)
	if err != nil {
		log.Fatal(err)
	}
	if created {
		log.Printf("created certificate %s; trust it in your system keychain once", *certPath)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	server := &http.Server{
		Addr:              *listen,
		Handler:           proxy,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("proxying https://%s to %s", *listen, target)
	if err := server.ListenAndServeTLS(*certPath, *keyPath); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func ensureCertificate(certPath, keyPath string) (bool, error) {
	certExists, err := fileExists(certPath)
	if err != nil {
		return false, err
	}
	keyExists, err := fileExists(keyPath)
	if err != nil {
		return false, err
	}
	if certExists && keyExists {
		return false, nil
	}
	if certExists || keyExists {
		return false, fmt.Errorf("certificate pair is incomplete: remove %s and %s, then try again", certPath, keyPath)
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return false, fmt.Errorf("generate private key: %w", err)
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return false, fmt.Errorf("generate certificate serial: %w", err)
	}
	now := time.Now()
	template := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "localhost"},
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IsCA:                  true,
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost"},
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
	}
	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		return false, fmt.Errorf("create certificate: %w", err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return false, fmt.Errorf("encode private key: %w", err)
	}

	for _, path := range []string{certPath, keyPath} {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return false, fmt.Errorf("create certificate directory: %w", err)
		}
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		return false, fmt.Errorf("write private key: %w", err)
	}
	if err := os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER}), 0o644); err != nil {
		_ = os.Remove(keyPath)
		return false, fmt.Errorf("write certificate: %w", err)
	}
	return true, nil
}

func fileExists(path string) (bool, error) {
	_, err := os.Stat(path)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return false, fmt.Errorf("stat %s: %w", path, err)
}
