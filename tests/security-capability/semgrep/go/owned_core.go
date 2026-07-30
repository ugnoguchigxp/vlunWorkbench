package fixture

import (
	"crypto/md5"
	"crypto/sha1"
	"crypto/sha256"
	crand "crypto/rand"
	"database/sql"
	"encoding/gob"
	"fmt"
	"html/template"
	"math/rand"
	"net/http"
	"os"
	"os/exec"
)

func vulnerable(input string, db *sql.DB, decoder *gob.Decoder, target any) {
	// ruleid: vuln-workbench.go.command-injection
	exec.Command(input)
	// ruleid: vuln-workbench.go.command-injection
	exec.Command(input, "--version")
	// ruleid: vuln-workbench.go.sql-injection
	db.Query(fmt.Sprintf("SELECT * FROM users WHERE id = %s", input))
	// ruleid: vuln-workbench.go.sql-injection
	db.Exec(fmt.Sprintf("DELETE FROM users WHERE id = %s", input))
	// ruleid: vuln-workbench.go.template-html
	template.HTML(input)
	// ruleid: vuln-workbench.go.template-html
	_ = template.HTML(input)
	// ruleid: vuln-workbench.go.ssrf-http-get
	http.Get(input)
	// ruleid: vuln-workbench.go.ssrf-http-get
	http.Get(input + "/health")
	// ruleid: vuln-workbench.go.path-traversal-open
	os.Open(input)
	// ruleid: vuln-workbench.go.path-traversal-open
	os.Open(input + ".json")
	// ruleid: vuln-workbench.go.unsafe-gob-decode
	gob.NewDecoder(os.Stdin).Decode(target)
	// ruleid: vuln-workbench.go.unsafe-gob-decode
	gob.NewDecoder(os.Stdin).Decode(&target)
	// ruleid: vuln-workbench.go.weak-hash
	md5.New()
	// ruleid: vuln-workbench.go.weak-hash
	sha1.New()
	// ruleid: vuln-workbench.go.weak-random
	rand.Intn(10)
	// ruleid: vuln-workbench.go.weak-random
	rand.Read([]byte{0})
}

func fixed(db *sql.DB) {
	// ok: vuln-workbench.go.command-injection
	exec.Command("/usr/bin/id", "-u")
	// ok: vuln-workbench.go.command-injection
	exec.Command("/usr/bin/date")
	// ok: vuln-workbench.go.sql-injection
	db.Query("SELECT * FROM users WHERE id = ?", 1)
	// ok: vuln-workbench.go.sql-injection
	db.Exec("DELETE FROM users WHERE id = ?", 1)
	// ok: vuln-workbench.go.template-html
	template.HTMLEscapeString("safe")
	// ok: vuln-workbench.go.template-html
	template.JSEscapeString("safe")
	// ok: vuln-workbench.go.ssrf-http-get
	http.Get("https://example.invalid/health")
	// ok: vuln-workbench.go.ssrf-http-get
	http.Get("/health")
	// ok: vuln-workbench.go.path-traversal-open
	os.Open("settings.json")
	// ok: vuln-workbench.go.path-traversal-open
	os.Open("/srv/static/index.html")
	// ok: vuln-workbench.go.unsafe-gob-decode
	fmt.Println("safe")
	// ok: vuln-workbench.go.unsafe-gob-decode
	fmt.Sprintf("%s", "safe")
	// ok: vuln-workbench.go.weak-hash
	sha256.New()
	// ok: vuln-workbench.go.weak-hash
	sha256.Sum256([]byte("safe"))
	// ok: vuln-workbench.go.weak-random
	crand.Read([]byte{0})
	// ok: vuln-workbench.go.weak-random
	crand.Reader.Read([]byte{0})
}
