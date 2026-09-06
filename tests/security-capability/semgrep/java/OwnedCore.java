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
    statement.addBatch("DELETE FROM users WHERE name='" + tainted + "'");
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

  void collectionFlows(HttpServletRequest request, HttpServletResponse response,
      JdbcOperations jdbc) throws Exception {
    String supplied = request.getParameter("name");
    java.util.List<String> arguments = new java.util.ArrayList<>();
    arguments.add("sh");
    arguments.add("-c");
    arguments.add(supplied);
    // ruleid: vuln-workbench.java.command-injection
    new ProcessBuilder(arguments);
    ProcessBuilder builder = new ProcessBuilder();
    // ruleid: vuln-workbench.java.command-injection
    builder.command(arguments);
    java.util.Map<String, String> values = new java.util.HashMap<>();
    values.put("selected", supplied);
    // ruleid: vuln-workbench.java.xss-response-writer
    response.getWriter().print(values.get("selected"));
    // ruleid: vuln-workbench.java.sql-injection
    jdbc.queryForRowSet("SELECT * FROM users WHERE name='" + supplied + "'");
    // ruleid: vuln-workbench.java.sql-injection
    jdbc.queryForMap("SELECT * FROM users WHERE name='" + supplied + "'");
    // ruleid: vuln-workbench.java.sql-injection
    jdbc.queryForObject("SELECT name FROM users WHERE name='" + supplied + "'", String.class);
    // ok: vuln-workbench.java.sql-injection
    jdbc.queryForRowSet("SELECT * FROM users WHERE name=?", supplied);
    // ok: vuln-workbench.java.sql-injection
    jdbc.queryForObject("SELECT name FROM users WHERE name=?", String.class, supplied);
    // ok: vuln-workbench.java.sql-injection
    jdbc.update("UPDATE users SET name=?", supplied);
    String name = request.getParameterNames().nextElement();
    // ruleid: vuln-workbench.java.xss-response-writer
    response.getWriter().print(name);
    // ruleid: vuln-workbench.java.command-injection
    Runtime.getRuntime().exec(name);
    // ruleid: vuln-workbench.java.path-traversal-file
    new java.io.FileInputStream(java.nio.file.Paths.get(supplied).toRealPath());
    // ruleid: vuln-workbench.java.path-traversal-file
    new java.io.FileInputStream(new File(supplied).getCanonicalPath());
    // ok: vuln-workbench.java.command-injection
    new ProcessBuilder(java.util.List.of("/usr/bin/id", "-u"));
    // ok: vuln-workbench.java.xss-response-writer
    response.getWriter().print(org.owasp.encoder.Encode.forHtml("constant"));
  }

  void configuredDigestOne() throws Exception {
    java.util.Properties settings = new java.util.Properties();
    settings.load(getClass().getClassLoader().getResourceAsStream("digests.properties"));
    String algorithm = settings.getProperty("legacy", "SHA-256");
    // ruleid: vuln-workbench.java.configured-weak-hash
    java.security.MessageDigest.getInstance(algorithm);
  }

  void configuredDigestTwo() throws Exception {
    java.util.Properties settings = new java.util.Properties();
    settings.load(getClass().getClassLoader().getResourceAsStream("digests.properties"));
    String digest = settings.getProperty("legacySecond", "SHA-512");
    // ruleid: vuln-workbench.java.configured-weak-hash
    java.security.MessageDigest.getInstance(digest, "SUN");
  }

  void explicitStrongDigests() throws Exception {
    // ok: vuln-workbench.java.configured-weak-hash
    java.security.MessageDigest.getInstance("SHA-256");
    // ok: vuln-workbench.java.configured-weak-hash
    java.security.MessageDigest.getInstance("SHA-512", "SUN");
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
    statement.addBatch();
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
  void encodedScript(HttpServletRequest request, HttpServletResponse response) throws Exception {
    String value = org.owasp.esapi.ESAPI.encoder().encodeForHTML(request.getParameter("q"));
    // ruleid: vuln-workbench.java.xss-encoding-context
    response.getWriter().print("<script>const x='" + value);
    // ruleid: vuln-workbench.java.xss-encoding-context
    response.getWriter().printf("<a href='%s'>link</a>", value);
  }
  void encodedBody(HttpServletRequest request, HttpServletResponse response) throws Exception {
    String value = org.owasp.esapi.ESAPI.encoder().encodeForHTML(request.getParameter("q"));
    // ok: vuln-workbench.java.xss-encoding-context
    response.getWriter().print(value);
    // ok: vuln-workbench.java.xss-encoding-context
    response.getWriter().print("<p>" + value);
  }
}
