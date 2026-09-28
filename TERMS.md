# Terms and Conditions of Use for NexTerm

**Last Updated:** September 28, 2026  
**Effective Date:** September 28, 2026

Please read these Terms and Conditions ("Terms", "Agreement") carefully before downloading, compiling, installing, or using the **NexTerm** software application ("Software", "Service"), created and maintained by the NexTerm contributors ("we", "us", or "our").

By downloading, installing, accessing, or using NexTerm, you agree to be bound by these Terms. If you do not agree to these Terms, do not install or use the Software.

---

## 1. License & Intellectual Property

NexTerm is free and open-source software distributed under the terms of the **MIT License**.

- You are granted a worldwide, royalty-free, non-exclusive license to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, subject to the conditions of the MIT License as stated in the [LICENSE](LICENSE) file.
- The software copyright notice and permission notice shall be included in all copies or substantial portions of the Software.

---

## 2. Permitted and Lawful Use

You agree to use NexTerm solely for lawful purposes and in compliance with all applicable local, national, and international laws, regulations, and organizational security policies.

### A. Authorized Remote Server Access
- You represent and warrant that you possess valid, explicit authorization and permission to access, monitor, manage, or execute commands on any remote computer, server, port, network interface, or bastion host with which you interact using NexTerm.
- Unauthorized access, penetration testing without prior written consent, port scanning of non-authorized third-party networks, or attempts to disrupt computing services using NexTerm is strictly prohibited.

### B. Command Broadcasting and Multi-Execution Caution
- NexTerm features powerful tools including **MultiExec** and **Command Broadcasting**, which allow commands to be dispatched simultaneously to multiple active terminal sessions.
- You acknowledge that broadcasting commands (especially administrative or destructive commands like `rm -rf`, system updates, or service restarts) carries the risk of widespread operational impact. You assume sole responsibility for reviewing commands before initiating broadcast execution.

---

## 3. Credential Management & User Security Responsibilities

- **Safe Handling of Credentials:** You are solely responsible for safeguarding your SSH private keys, passphrases, master passwords, and server credentials.
- **Operating System Environment:** NexTerm relies on your operating system's native credential stores (such as Windows DPAPI, macOS Keychain, and Linux Secret Service) for encrypted password storage. You are responsible for maintaining the physical and administrative security of your local operating system and user account.
- **Exported Backups:** If you export your session configurations to unencrypted JSON files, you are responsible for securing or encrypting those files to prevent unauthorized disclosure of host names, ports, or usernames.

---

## 4. No Telemetry & Data Sovereignty

- NexTerm is provided as a client-side, local-first utility.
- As described in our [Privacy Policy](PRIVACY.md), NexTerm does not collect, monitor, or transmit your session contents, commands, credentials, or personal telemetry. You retain complete ownership and control over your configuration files and data.

---

## 5. Disclaimer of Warranties

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:
- THE SOFTWARE IS PROVIDED **"AS IS"**, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, ACCURACY, AND NON-INFRINGEMENT.
- WE DO NOT WARRANT THAT THE SOFTWARE WILL BE UNINTERRUPTED, ERROR-FREE, FREE OF HARMFUL COMPONENTS, OR COMPATIBLE WITH EVERY COMBINATION OF HARDWARE, OPERATING SYSTEM VERSION, OR REMOTE SSH DAEMON CONFIGURATION.
- YOU ACKNOWLEDGE THAT INFRASTRUCTURE MANAGEMENT INVOLVES INHERENT OPERATIONAL RISKS, AND YOU ASSUME ALL RISK ASSOCIATED WITH REMOTE SERVER MANAGEMENT AND NETWORK TRANSMISSION.

---

## 6. Limitation of Liability

TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW:
- IN NO EVENT SHALL THE AUTHORS, CONTRIBUTORS, OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
- THIS INCLUDES, WITHOUT LIMITATION, DAMAGES FOR LOSS OF DATA, LOSS OF PROFITS, BUSINESS INTERRUPTION, SERVER DOWNTIME, CORRUPTED CONFIGURATIONS, OR HARDWARE/NETWORK FAILURE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

---

## 7. Third-Party Protocols & Trademarks

- All third-party names, logos, protocols, and trademarks (e.g., Windows, macOS, Linux, Go, Wails, xterm.js, SSH, OpenSSH, PuTTY, MobaXterm, VcXsrv) referenced in the application or documentation are the property of their respective owners.
- Reference to any third-party software, protocol, or product does not imply endorsement, affiliation, or sponsorship.

---

## 8. Modifications to Terms

We reserve the right to revise or replace these Terms at any time by updating this document within the official code repository. Continued use of the Software following any changes constitutes acceptance of the new Terms.

---

## 9. Contact Information

If you have questions regarding these Terms:
- **GitHub Issues:** [https://github.com/kunal-live/NexTerm/issues](https://github.com/kunal-live/NexTerm/issues)
- **Repository:** [https://github.com/kunal-live/NexTerm](https://github.com/kunal-live/NexTerm)
