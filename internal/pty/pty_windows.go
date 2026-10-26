//go:build windows

package pty

import (
	"fmt"
	"io"
	"os"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	kernel32                              = windows.NewLazySystemDLL("kernel32.dll")
	procCreatePseudoConsole               = kernel32.NewProc("CreatePseudoConsole")
	procResizePseudoConsole               = kernel32.NewProc("ResizePseudoConsole")
	procClosePseudoConsole                = kernel32.NewProc("ClosePseudoConsole")
	procInitializeProcThreadAttributeList = kernel32.NewProc("InitializeProcThreadAttributeList")
	procUpdateProcThreadAttribute         = kernel32.NewProc("UpdateProcThreadAttribute")
	procDeleteProcThreadAttributeList     = kernel32.NewProc("DeleteProcThreadAttributeList")
)

const (
	procThreadAttributePseudoConsole = 0x00020016
	extendedStartupInfoPresent       = 0x00080000
)

type coord struct {
	X int16
	Y int16
}

type startupInfoEx struct {
	windows.StartupInfo
	AttributeList uintptr
}

// Terminal represents a running Windows Pseudo Console (ConPTY) session.
type Terminal struct {
	hPC      windows.Handle
	In       *os.File
	Out      *os.File
	hProcess windows.Handle
	hThread  windows.Handle
	pid      int
	mu       sync.Mutex
	closed   bool
}

// Start launches a command line attached to a native Windows ConPTY.
func Start(commandLine string, cols, rows int) (*Terminal, error) {
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 30
	}

	var hInRead, hInWrite windows.Handle
	var hOutRead, hOutWrite windows.Handle

	sa := windows.SecurityAttributes{
		Length:        uint32(unsafe.Sizeof(windows.SecurityAttributes{})),
		InheritHandle: 1,
	}

	if err := windows.CreatePipe(&hInRead, &hInWrite, &sa, 0); err != nil {
		return nil, fmt.Errorf("create input pipe: %w", err)
	}
	if err := windows.CreatePipe(&hOutRead, &hOutWrite, &sa, 0); err != nil {
		windows.CloseHandle(hInRead)
		windows.CloseHandle(hInWrite)
		return nil, fmt.Errorf("create output pipe: %w", err)
	}

	size := coord{X: int16(cols), Y: int16(rows)}
	var hPC windows.Handle

	// CreatePseudoConsole(size, hInput, hOutput, dwFlags, &hPC)
	r1, _, err := procCreatePseudoConsole.Call(
		*(*uintptr)(unsafe.Pointer(&size)),
		uintptr(hInRead),
		uintptr(hOutWrite),
		0,
		uintptr(unsafe.Pointer(&hPC)),
	)
	if int32(r1) != 0 {
		windows.CloseHandle(hInRead)
		windows.CloseHandle(hInWrite)
		windows.CloseHandle(hOutRead)
		windows.CloseHandle(hOutWrite)
		return nil, fmt.Errorf("CreatePseudoConsole failed (0x%X): %w", r1, err)
	}

	// PseudoConsole has taken ownership of hInRead and hOutWrite
	_ = windows.CloseHandle(hInRead)
	_ = windows.CloseHandle(hOutWrite)

	// Setup STARTUPINFOEX with PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
	var bytes uintptr
	procInitializeProcThreadAttributeList.Call(0, 1, 0, uintptr(unsafe.Pointer(&bytes)))
	if bytes == 0 {
		procClosePseudoConsole.Call(uintptr(hPC))
		windows.CloseHandle(hInWrite)
		windows.CloseHandle(hOutRead)
		return nil, fmt.Errorf("get attribute list size failed")
	}

	attrList := make([]byte, bytes)
	r1, _, err = procInitializeProcThreadAttributeList.Call(
		uintptr(unsafe.Pointer(&attrList[0])),
		1,
		0,
		uintptr(unsafe.Pointer(&bytes)),
	)
	if r1 == 0 {
		procClosePseudoConsole.Call(uintptr(hPC))
		windows.CloseHandle(hInWrite)
		windows.CloseHandle(hOutRead)
		return nil, fmt.Errorf("InitializeProcThreadAttributeList failed: %w", err)
	}

	r1, _, err = procUpdateProcThreadAttribute.Call(
		uintptr(unsafe.Pointer(&attrList[0])),
		0,
		procThreadAttributePseudoConsole,
		uintptr(hPC),
		unsafe.Sizeof(hPC),
		0,
		0,
	)
	if r1 == 0 {
		procDeleteProcThreadAttributeList.Call(uintptr(unsafe.Pointer(&attrList[0])))
		procClosePseudoConsole.Call(uintptr(hPC))
		windows.CloseHandle(hInWrite)
		windows.CloseHandle(hOutRead)
		return nil, fmt.Errorf("UpdateProcThreadAttribute failed: %w", err)
	}

	var si startupInfoEx
	si.StartupInfo.Cb = uint32(unsafe.Sizeof(si))
	si.AttributeList = uintptr(unsafe.Pointer(&attrList[0]))

	var pi windows.ProcessInformation

	cmdUTF16, err := syscall.UTF16PtrFromString(commandLine)
	if err != nil {
		procDeleteProcThreadAttributeList.Call(uintptr(unsafe.Pointer(&attrList[0])))
		procClosePseudoConsole.Call(uintptr(hPC))
		windows.CloseHandle(hInWrite)
		windows.CloseHandle(hOutRead)
		return nil, fmt.Errorf("convert command line UTF16: %w", err)
	}

	err = windows.CreateProcess(
		nil,
		cmdUTF16,
		nil,
		nil,
		false,
		extendedStartupInfoPresent,
		nil,
		nil,
		&si.StartupInfo,
		&pi,
	)
	procDeleteProcThreadAttributeList.Call(uintptr(unsafe.Pointer(&attrList[0])))

	if err != nil {
		procClosePseudoConsole.Call(uintptr(hPC))
		windows.CloseHandle(hInWrite)
		windows.CloseHandle(hOutRead)
		return nil, fmt.Errorf("CreateProcess failed: %w", err)
	}

	inFile := os.NewFile(uintptr(hInWrite), "pty-in")
	outFile := os.NewFile(uintptr(hOutRead), "pty-out")

	term := &Terminal{
		hPC:      hPC,
		In:       inFile,
		Out:      outFile,
		hProcess: pi.Process,
		hThread:  pi.Thread,
		pid:      int(pi.ProcessId),
	}

	// The output pipe never reports EOF while the pseudo console is open, even
	// after the shell exits, so close the console once the process ends. The
	// waiter gets its own handle because Close may close hProcess meanwhile.
	var waitHandle windows.Handle
	self := windows.CurrentProcess()
	if err := windows.DuplicateHandle(self, pi.Process, self, &waitHandle, 0, false, windows.DUPLICATE_SAME_ACCESS); err == nil {
		go term.closeConsoleOnExit(waitHandle)
	}

	return term, nil
}

// closeConsoleOnExit waits for the child process and then closes the pseudo
// console so readers of Out see EOF.
func (t *Terminal) closeConsoleOnExit(process windows.Handle) {
	defer windows.CloseHandle(process)
	_, _ = windows.WaitForSingleObject(process, windows.INFINITE)

	t.mu.Lock()
	defer t.mu.Unlock()
	if t.hPC != 0 {
		procClosePseudoConsole.Call(uintptr(t.hPC))
		t.hPC = 0
	}
}

// Write sends data to the ConPTY input stream.
func (t *Terminal) Write(p []byte) (n int, err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed || t.In == nil {
		return 0, io.ErrClosedPipe
	}
	return t.In.Write(p)
}

// Read reads output from the ConPTY output stream.
func (t *Terminal) Read(p []byte) (n int, err error) {
	if t.Out == nil {
		return 0, io.ErrClosedPipe
	}
	return t.Out.Read(p)
}

// Pid returns the process ID of the child process.
func (t *Terminal) Pid() int {
	return t.pid
}

// Resize resizes the ConPTY window dimensions.
func (t *Terminal) Resize(cols, rows int) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed || t.hPC == 0 {
		return nil
	}
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 30
	}
	size := coord{X: int16(cols), Y: int16(rows)}
	r1, _, err := procResizePseudoConsole.Call(
		uintptr(t.hPC),
		*(*uintptr)(unsafe.Pointer(&size)),
	)
	if int32(r1) != 0 {
		return fmt.Errorf("ResizePseudoConsole failed (0x%X): %w", r1, err)
	}
	return nil
}

// Close terminates the pseudo console and cleans up handles.
func (t *Terminal) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return nil
	}
	t.closed = true

	if t.In != nil {
		_ = t.In.Close()
	}
	if t.hPC != 0 {
		procClosePseudoConsole.Call(uintptr(t.hPC))
		t.hPC = 0
	}
	if t.Out != nil {
		_ = t.Out.Close()
	}
	if t.hProcess != 0 {
		_ = windows.TerminateProcess(t.hProcess, 1)
		_ = windows.CloseHandle(t.hProcess)
		t.hProcess = 0
	}
	if t.hThread != 0 {
		_ = windows.CloseHandle(t.hThread)
		t.hThread = 0
	}
	return nil
}
