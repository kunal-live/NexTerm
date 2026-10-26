package nettools

import (
	"crypto/md5"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"fmt"
	"net"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type PortScanResult struct {
	Port    int    `json:"port"`
	Open    bool   `json:"open"`
	Service string `json:"service"`
	Latency string `json:"latency"`
}

var commonServices = map[int]string{
	21:   "FTP",
	22:   "SSH",
	23:   "Telnet",
	25:   "SMTP",
	53:   "DNS",
	80:   "HTTP",
	110:  "POP3",
	143:  "IMAP",
	443:  "HTTPS",
	1433: "MSSQL",
	1521: "Oracle DB",
	3306: "MySQL/MariaDB",
	3389: "RDP",
	5432: "PostgreSQL",
	5900: "VNC",
	6379: "Redis",
	8080: "HTTP-Alt",
	8443: "HTTPS-Alt",
	9000: "SonarQube/PHP",
	9092: "Kafka",
	27017: "MongoDB",
}

// LookupService returns the standard service name for a port.
func LookupService(port int) string {
	if s, ok := commonServices[port]; ok {
		return s
	}
	return fmt.Sprintf("Port %d", port)
}

// maxScanPorts bounds a single PortScan request.
const maxScanPorts = 1024

// validHost reports whether host is an IP literal or a plausible DNS name. In
// particular it rejects values starting with '-', which ping would parse as flags.
func validHost(host string) bool {
	if host == "" || len(host) > 253 {
		return false
	}
	if net.ParseIP(host) != nil {
		return true
	}
	for _, label := range strings.Split(strings.TrimSuffix(host, "."), ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, r := range label {
			if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
				return false
			}
		}
	}
	return true
}

// Ping executes a system ping command and returns formatted statistics.
func Ping(host string) (string, error) {
	host = strings.TrimSpace(host)
	if host == "" {
		return "", fmt.Errorf("host cannot be empty")
	}
	if !validHost(host) {
		return "", fmt.Errorf("invalid host %q: expected a hostname or IP address", host)
	}

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("ping", "-n", "4", host)
	} else {
		cmd = exec.Command("ping", "-c", "4", host)
	}

	out, err := cmd.CombinedOutput()
	if err != nil && len(out) == 0 {
		return "", fmt.Errorf("ping failed: %w", err)
	}
	return string(out), nil
}

// LookupDNS queries A, AAAA, CNAME, and MX records for a hostname.
func LookupDNS(host string) (map[string][]string, error) {
	res := make(map[string][]string)

	ips, err := net.LookupIP(host)
	if err == nil {
		for _, ip := range ips {
			if ip.To4() != nil {
				res["A (IPv4)"] = append(res["A (IPv4)"], ip.String())
			} else {
				res["AAAA (IPv6)"] = append(res["AAAA (IPv6)"], ip.String())
			}
		}
	}

	cname, err := net.LookupCNAME(host)
	if err == nil && cname != "" && cname != host+"." {
		res["CNAME"] = []string{cname}
	}

	mx, err := net.LookupMX(host)
	if err == nil {
		for _, m := range mx {
			res["MX"] = append(res["MX"], fmt.Sprintf("%s (Pref: %d)", m.Host, m.Pref))
		}
	}

	txt, err := net.LookupTXT(host)
	if err == nil && len(txt) > 0 {
		res["TXT"] = txt
	}

	if len(res) == 0 {
		return res, fmt.Errorf("no DNS records found for %s", host)
	}

	return res, nil
}

// PortScan scans target host for specified ports with concurrent workers.
func PortScan(host string, ports []int) []PortScanResult {
	if len(ports) == 0 {
		ports = []int{21, 22, 23, 25, 53, 80, 110, 143, 443, 1433, 1521, 3306, 3389, 5432, 5900, 6379, 8080, 8443, 27017}
	}
	valid := make([]int, 0, len(ports))
	for _, p := range ports {
		if p >= 1 && p <= 65535 {
			valid = append(valid, p)
		}
	}
	ports = valid
	if len(ports) > maxScanPorts {
		ports = ports[:maxScanPorts]
	}

	results := make([]PortScanResult, len(ports))
	var wg sync.WaitGroup
	semaphore := make(chan struct{}, 20) // max 20 concurrent dials

	for i, p := range ports {
		wg.Add(1)
		semaphore <- struct{}{} // bound live goroutines, not just concurrent dials
		go func(idx, port int) {
			defer wg.Done()
			defer func() { <-semaphore }()

			addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
			start := time.Now()
			conn, err := net.DialTimeout("tcp", addr, 1200*time.Millisecond)
			dur := time.Since(start)

			svc := commonServices[port]
			if svc == "" {
				svc = fmt.Sprintf("Port %d", port)
			}

			if err == nil {
				_ = conn.Close()
				results[idx] = PortScanResult{
					Port:    port,
					Open:    true,
					Service: svc,
					Latency: fmt.Sprintf("%d ms", dur.Milliseconds()),
				}
			} else {
				results[idx] = PortScanResult{
					Port:    port,
					Open:    false,
					Service: svc,
					Latency: "-",
				}
			}
		}(i, p)
	}

	wg.Wait()
	return results
}

// CalculateHash generates cryptographic hashes for input string.
func CalculateHash(input string, algorithm string) string {
	b := []byte(input)
	switch algorithm {
	case "md5":
		h := md5.Sum(b)
		return hex.EncodeToString(h[:])
	case "sha1":
		h := sha1.Sum(b)
		return hex.EncodeToString(h[:])
	case "sha256":
		h := sha256.Sum256(b)
		return hex.EncodeToString(h[:])
	case "sha512":
		h := sha512.Sum512(b)
		return hex.EncodeToString(h[:])
	default:
		h := sha256.Sum256(b)
		return hex.EncodeToString(h[:])
	}
}

// ServerReachability represents the connectivity probe result for a host and port.
type ServerReachability struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Online    bool   `json:"online"`
	LatencyMs int64  `json:"latencyMs"`
	Error     string `json:"error,omitempty"`
}

// TargetQuery specifies a host and port to probe.
type TargetQuery struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

// PingTarget probes a single host/port with a given timeout.
func PingTarget(host string, port int, timeoutMs int) ServerReachability {
	if timeoutMs <= 0 {
		timeoutMs = 1500
	}
	if port <= 0 {
		port = 22
	}
	target := net.JoinHostPort(host, strconv.Itoa(port))
	start := time.Now()
	conn, err := net.DialTimeout("tcp", target, time.Duration(timeoutMs)*time.Millisecond)
	dur := time.Since(start).Milliseconds()
	if err != nil {
		return ServerReachability{
			Host:      host,
			Port:      port,
			Online:    false,
			LatencyMs: -1,
			Error:     err.Error(),
		}
	}
	_ = conn.Close()
	return ServerReachability{
		Host:      host,
		Port:      port,
		Online:    true,
		LatencyMs: dur,
	}
}

// CheckServersReachability probes multiple targets in parallel with a timeout.
func CheckServersReachability(targets []TargetQuery, timeoutMs int) []ServerReachability {
	if timeoutMs <= 0 {
		timeoutMs = 1500
	}
	results := make([]ServerReachability, len(targets))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 32)
	for i, t := range targets {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int, target TargetQuery) {
			defer wg.Done()
			defer func() { <-sem }()
			results[idx] = PingTarget(target.Host, target.Port, timeoutMs)
		}(i, t)
	}
	wg.Wait()
	return results
}

