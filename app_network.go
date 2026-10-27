package main

import (
	"fmt"
	"strconv"
	"time"

	"nexterm/internal/hostkey"
	"nexterm/internal/macro"
	"nexterm/internal/nettools"
	"nexterm/internal/tunnel"
)

// =========================================================================
// Host Key & Fingerprint Verification
// =========================================================================

func (a *App) GetKnownHosts() ([]hostkey.HostKeyEntry, error) {
	return a.hostKeyService.GetKnownHosts()
}

func (a *App) DeleteKnownHost(hostname string, port int) error {
	return a.hostKeyService.DeleteKnownHost(hostname, port)
}

func (a *App) RespondHostKey(requestID string, action string) error {
	return a.hostKeyService.RespondHostKey(requestID, action)
}

// =========================================================================
// SSH Tunnel Manager
// =========================================================================

func (a *App) GetTunnels() []tunnel.TunnelConfig {
	return a.tunnelMgr.GetTunnels()
}

func (a *App) SaveTunnel(t tunnel.TunnelConfig) error {
	return a.tunnelMgr.SaveTunnel(t)
}

func (a *App) DeleteTunnel(id string) error {
	return a.tunnelMgr.DeleteTunnel(id)
}

func (a *App) StartTunnel(id, tabID string) error {
	client := a.connectionManager.GetSSHClient(tabID)
	if client == nil {
		return fmt.Errorf("active SSH connection required to forward tunnel ports")
	}
	return a.tunnelMgr.StartTunnel(id, client)
}

func (a *App) StopTunnel(id string) error {
	return a.tunnelMgr.StopTunnel(id)
}

// =========================================================================
// Terminal Macro Engine
// =========================================================================

func (a *App) GetMacros() []macro.Macro {
	return a.macroMgr.GetMacros()
}

func (a *App) SaveMacro(m macro.Macro) error {
	return a.macroMgr.SaveMacro(m)
}

func (a *App) DeleteMacro(id string) error {
	return a.macroMgr.DeleteMacro(id)
}

func (a *App) ExecuteMacro(macroID string, targetTabIDs []string) error {
	macros := a.macroMgr.GetMacros()
	var targetMacro *macro.Macro
	for _, m := range macros {
		if m.ID == macroID {
			targetMacro = &m
			break
		}
	}
	if targetMacro == nil {
		return fmt.Errorf("macro not found: %s", macroID)
	}

	targets := targetTabIDs
	if len(targets) == 0 {
		active := a.connectionManager.ActiveSessions()
		for id := range active {
			targets = append(targets, id)
		}
	}

	if len(targets) == 0 {
		return fmt.Errorf("no active terminals to execute macro against")
	}

	go func() {
		for _, cmd := range targetMacro.Commands {
			if targetMacro.DelayMs > 0 {
				time.Sleep(time.Duration(targetMacro.DelayMs) * time.Millisecond)
			}
			payload := cmd + "\r"
			for _, tID := range targets {
				_ = a.WriteToTerminal(tID, payload)
			}
		}
	}()

	return nil
}

// =========================================================================
// Network Diagnostic Tools
// =========================================================================

func (a *App) NetPing(host string) (string, error) {
	return nettools.Ping(host)
}

func (a *App) NetLookupDNS(host string) (map[string][]string, error) {
	return nettools.LookupDNS(host)
}

func (a *App) NetPortScan(host string, ports []int) []nettools.PortScanResult {
	return nettools.PortScan(host, ports)
}

func (a *App) NetCalculateHash(input, algorithm string) string {
	return nettools.CalculateHash(input, algorithm)
}

func (a *App) CheckServersReachability(targets []nettools.TargetQuery, timeoutMs int) []nettools.ServerReachability {
	return nettools.CheckServersReachability(targets, timeoutMs)
}

func (a *App) PingTarget(host string, port int, timeoutMs int) nettools.ServerReachability {
	return nettools.PingTarget(host, port, timeoutMs)
}

func (a *App) ScanPorts(host string, portStr string, timeoutMs int) []nettools.PortScanResult {
	if host == "" {
		return nil
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 {
		port = 22
	}
	if timeoutMs <= 0 {
		timeoutMs = 3000
	}
	res := nettools.PingTarget(host, port, timeoutMs)
	latencyStr := "-"
	if res.Online {
		latencyStr = fmt.Sprintf("%d ms", res.LatencyMs)
	}
	return []nettools.PortScanResult{
		{
			Port:    port,
			Open:    res.Online,
			Service: nettools.LookupService(port),
			Latency: latencyStr,
		},
	}
}
