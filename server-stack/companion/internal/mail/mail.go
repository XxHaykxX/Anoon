// Package mail is the companion's outbound-email seam. It is deliberately the
// ONE place email delivery lives so wiring a real SMTP/provider later is a
// single-file change.
//
// STATUS: SMTP is stubbed. SendReset/SendVerify currently only log (the token is
// logged so the flow can be exercised end to end in dev) and return nil — no
// message actually leaves the box. The SMTP_* config is carried through but
// unused until a real transport is plugged into send(). Wire it there.
package mail

import "log"

// Config holds the (currently unused) SMTP settings. Populated from env by the
// caller so the real transport can be dropped into send() without touching any
// other file.
type Config struct {
	Host string // SMTP_HOST
	Port string // SMTP_PORT
	User string // SMTP_USER
	Pass string // SMTP_PASS
	From string // SMTP_FROM (envelope + header From)
}

// Mailer sends transactional email. Construct with New; safe to use even when
// unconfigured (it logs instead of sending).
type Mailer struct {
	cfg Config
}

// New builds a Mailer from cfg.
func New(cfg Config) *Mailer {
	return &Mailer{cfg: cfg}
}

// Configured reports whether a real SMTP host is set. Currently informational
// only (send() is stubbed regardless); lets startup log the mode.
func (m *Mailer) Configured() bool {
	return m != nil && m.cfg.Host != ""
}

// SendReset "sends" a password-reset email carrying token to addr.
func (m *Mailer) SendReset(addr, token string) error {
	return m.send(addr, "reset", token)
}

// SendVerify "sends" an email-verification email carrying token to addr.
func (m *Mailer) SendVerify(addr, token string) error {
	return m.send(addr, "verify", token)
}

// send is the single delivery seam. TODO: replace the log with a real SMTP
// dial+send (net/smtp or a provider SDK) using m.cfg. Until then it logs the
// token so the reset/verify flows are testable in dev, and returns nil so the
// caller's "queued" response is honest about the stub.
func (m *Mailer) send(addr, kind, token string) error {
	if m == nil {
		return nil
	}
	log.Printf("mail: [STUB] would send %s email to %q with token=%s (SMTP not wired)", kind, addr, token)
	return nil
}
