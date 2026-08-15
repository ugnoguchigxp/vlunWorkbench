import java.io.File;
import java.io.ObjectInputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.Random;
import javax.crypto.Cipher;
import javax.naming.directory.DirContext;
import javax.servlet.http.Cookie;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import javax.xml.xpath.XPath;

class OwnedCore {
  interface JdbcOperations {
    Object query(String sql, Object mapper);
    long queryForLong(String sql);
    int[] batchUpdate(String sql);
  }

  interface RequestSource {
    String getTheParameter(String name);
  }

  void vulnerable(
      String input,
      Statement statement,
      JdbcOperations jdbc,
      RequestSource source,
      ObjectInputStream stream,
      HttpServletRequest request,
      HttpServletResponse response
  ) throws Exception {
    String tainted = request.getParameter("q");
    String wrappedTainted = source.getTheParameter("q");
    String parameterName = request.getParameterNames().nextElement();
    // ruleid: vuln-workbench.java.command-injection
    Runtime.getRuntime().exec(tainted);
    // ruleid: vuln-workbench.java.command-injection
    Runtime.getRuntime().exec(new String(tainted));
    // ruleid: vuln-workbench.java.sql-injection
    statement.execute(tainted);
    // ruleid: vuln-workbench.java.sql-injection
    statement.executeQuery(tainted);
    // ruleid: vuln-workbench.java.sql-injection
    jdbc.query("SELECT * FROM users WHERE name='" + wrappedTainted + "'", null);
    // ruleid: vuln-workbench.java.sql-injection
    jdbc.queryForLong("SELECT count(*) FROM users WHERE name='" + parameterName + "'");
    // ruleid: vuln-workbench.java.sql-injection
    jdbc.batchUpdate("DELETE FROM users WHERE name='" + tainted + "'");
    // ruleid: vuln-workbench.java.xss-response-writer
    response.getWriter().write(tainted);
    // ruleid: vuln-workbench.java.xss-response-writer
    response.getWriter().write(tainted + "!");
    // ruleid: vuln-workbench.java.ssrf-url-connection
    new URL(input).openConnection();
    // ruleid: vuln-workbench.java.ssrf-url-connection
    new URL(new String(input)).openConnection();
    // ruleid: vuln-workbench.java.path-traversal-file
    new File(tainted);
    // ruleid: vuln-workbench.java.path-traversal-file
    new File(tainted + ".txt");
    // ruleid: vuln-workbench.java.unsafe-deserialization
    stream.readObject();
    // ruleid: vuln-workbench.java.unsafe-deserialization
    Object value = stream.readObject();
    // ruleid: vuln-workbench.java.weak-hash
    MessageDigest.getInstance("MD5");
    // ruleid: vuln-workbench.java.weak-hash
    MessageDigest.getInstance("SHA-1");
    // ruleid: vuln-workbench.java.weak-random
    new Random();
    // ruleid: vuln-workbench.java.weak-random
    new Random(1);
    // ruleid: vuln-workbench.java.weak-cipher
    Cipher.getInstance("DES/CBC/PKCS5Padding");
    // ruleid: vuln-workbench.java.weak-cipher
    Cipher.getInstance("DES");
    DirContext context = null;
    // ruleid: vuln-workbench.java.ldap-injection
    context.search("ou=users", "(uid=" + tainted + ")", null);
    // ruleid: vuln-workbench.java.ldap-injection
    context.search("ou=users", tainted, null);
    XPath xpath = null;
    // ruleid: vuln-workbench.java.xpath-injection
    xpath.evaluate("/users/" + tainted, new Object());
    // ruleid: vuln-workbench.java.xpath-injection
    xpath.compile(tainted);
    Cookie cookie = new Cookie("id", tainted);
    // ruleid: vuln-workbench.java.insecure-cookie
    cookie.setSecure(false);
    // ruleid: vuln-workbench.java.insecure-cookie
    cookie.setHttpOnly(false);
    HttpSession session = request.getSession();
    // ruleid: vuln-workbench.java.trust-boundary
    session.setAttribute("first", tainted);
    // ruleid: vuln-workbench.java.trust-boundary
    session.setAttribute(tainted, "value");
    // ruleid: vuln-workbench.java.trust-boundary
    session.putValue("wrapped", wrappedTainted);
    // ruleid: vuln-workbench.java.trust-boundary
    session.putValue(parameterName, "value");
  }

  void fixed(
      PreparedStatement statement,
      JdbcOperations jdbc,
      HttpSession session,
      HttpServletResponse response
  )
      throws Exception {
    // ok: vuln-workbench.java.command-injection
    new ProcessBuilder("/usr/bin/id", "-u").start();
    // ok: vuln-workbench.java.command-injection
    Runtime.getRuntime().exec("date");
    // ok: vuln-workbench.java.sql-injection
    statement.execute();
    // ok: vuln-workbench.java.sql-injection
    statement.setString(1, "value");
    // ok: vuln-workbench.java.sql-injection
    jdbc.query("SELECT name FROM users", null);
    // ok: vuln-workbench.java.sql-injection
    jdbc.queryForLong("SELECT count(*) FROM users");
    // ok: vuln-workbench.java.sql-injection
    jdbc.batchUpdate("DELETE FROM expired_users");
    // ok: vuln-workbench.java.xss-response-writer
    response.getWriter().write("safe");
    // ok: vuln-workbench.java.xss-response-writer
    response.setStatus(204);
    // ok: vuln-workbench.java.ssrf-url-connection
    new URL("https://example.invalid/health").openConnection();
    // ok: vuln-workbench.java.ssrf-url-connection
    URL safe = new URL("https://example.invalid/");
    // ok: vuln-workbench.java.path-traversal-file
    new File("settings.json");
    // ok: vuln-workbench.java.path-traversal-file
    File safeFile = new File("/srv/static/index.html");
    // ok: vuln-workbench.java.unsafe-deserialization
    String value = "{}";
    // ok: vuln-workbench.java.unsafe-deserialization
    byte[] bytes = new byte[0];
    // ok: vuln-workbench.java.weak-hash
    MessageDigest.getInstance("SHA-256");
    // ok: vuln-workbench.java.weak-hash
    MessageDigest.getInstance("SHA-512");
    // ok: vuln-workbench.java.weak-random
    new SecureRandom();
    // ok: vuln-workbench.java.weak-random
    SecureRandom.getInstanceStrong();
    // ok: vuln-workbench.java.weak-cipher
    Cipher.getInstance("AES/GCM/NoPadding");
    // ok: vuln-workbench.java.weak-cipher
    Cipher.getInstance("ChaCha20-Poly1305");
    // ok: vuln-workbench.java.ldap-injection
    String safeLdapFilter = "(uid=service)";
    // ok: vuln-workbench.java.ldap-injection
    String safeBase = "ou=users";
    // ok: vuln-workbench.java.xpath-injection
    String safeXPath = "/users/user";
    // ok: vuln-workbench.java.xpath-injection
    String safeNode = "user";
    Cookie secureCookie = new Cookie("id", "value");
    // ok: vuln-workbench.java.insecure-cookie
    secureCookie.setSecure(true);
    // ok: vuln-workbench.java.insecure-cookie
    secureCookie.setHttpOnly(true);
    // ok: vuln-workbench.java.trust-boundary
    String safeSessionKey = "userId";
    // ok: vuln-workbench.java.trust-boundary
    String safeSessionValue = "system";
    // ok: vuln-workbench.java.trust-boundary
    session.putValue("userId", "system");
  }
}
