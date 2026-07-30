import java.io.File;
import java.io.ObjectInputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.Random;
import javax.servlet.http.HttpServletResponse;

class OwnedCore {
  void vulnerable(
      String input,
      Statement statement,
      ObjectInputStream stream,
      HttpServletResponse response
  ) throws Exception {
    // ruleid: vuln-workbench.java.command-injection
    Runtime.getRuntime().exec(input);
    // ruleid: vuln-workbench.java.command-injection
    Runtime.getRuntime().exec(new String(input));
    // ruleid: vuln-workbench.java.sql-injection
    statement.execute(input);
    // ruleid: vuln-workbench.java.sql-injection
    statement.executeQuery(input);
    // ruleid: vuln-workbench.java.xss-response-writer
    response.getWriter().write(input);
    // ruleid: vuln-workbench.java.xss-response-writer
    response.getWriter().write(input + "!");
    // ruleid: vuln-workbench.java.ssrf-url-connection
    new URL(input).openConnection();
    // ruleid: vuln-workbench.java.ssrf-url-connection
    new URL(new String(input)).openConnection();
    // ruleid: vuln-workbench.java.path-traversal-file
    new File(input);
    // ruleid: vuln-workbench.java.path-traversal-file
    new File(input + ".txt");
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
  }

  void fixed(PreparedStatement statement, HttpServletResponse response)
      throws Exception {
    // ok: vuln-workbench.java.command-injection
    new ProcessBuilder("/usr/bin/id", "-u").start();
    // ok: vuln-workbench.java.command-injection
    Runtime.getRuntime().exec("date");
    // ok: vuln-workbench.java.sql-injection
    statement.execute();
    // ok: vuln-workbench.java.sql-injection
    statement.setString(1, "value");
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
  }
}
