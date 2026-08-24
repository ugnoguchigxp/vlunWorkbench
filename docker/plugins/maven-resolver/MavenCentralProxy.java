import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public final class MavenCentralProxy {
  private static final URI UPSTREAM = URI.create("https://repo.maven.apache.org");
  private static final String PREFIX = "/maven2";
  private static final Set<String> REQUEST_HEADERS = Set.of(
      "accept", "if-match", "if-modified-since", "if-none-match", "range", "user-agent");
  private static final Set<String> RESPONSE_HEADERS = Set.of(
      "accept-ranges", "cache-control", "content-length", "content-range", "content-type",
      "etag", "last-modified");
  private static final HttpClient CLIENT = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(15))
      .followRedirects(HttpClient.Redirect.NEVER)
      .build();

  private MavenCentralProxy() {}

  public static void main(String[] args) throws Exception {
    if (args.length == 1 && args[0].equals("health")) {
      var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:8080/health"))
          .timeout(Duration.ofSeconds(2)).GET().build();
      if (CLIENT.send(request, HttpResponse.BodyHandlers.discarding()).statusCode() != 200) {
        throw new IOException("maven_central_proxy_unhealthy");
      }
      return;
    }
    var server = HttpServer.create(new InetSocketAddress("0.0.0.0", 8080), 32);
    server.createContext("/health", exchange -> {
      if (!exchange.getRequestMethod().equals("GET")) {
        sendText(exchange, 405, "method_not_allowed");
        return;
      }
      sendText(exchange, 200, "ok");
    });
    server.createContext(PREFIX, MavenCentralProxy::proxy);
    server.setExecutor(null);
    server.start();
  }

  private static void proxy(HttpExchange exchange) throws IOException {
    String method = exchange.getRequestMethod();
    if (!method.equals("GET") && !method.equals("HEAD")) {
      exchange.getResponseHeaders().set("Allow", "GET, HEAD");
      sendText(exchange, 405, "method_not_allowed");
      return;
    }
    URI incoming = exchange.getRequestURI();
    String rawPath = incoming.getRawPath();
    if (!rawPath.equals(PREFIX) && !rawPath.startsWith(PREFIX + "/")) {
      sendText(exchange, 404, "not_found");
      return;
    }
    String suffix = rawPath.substring(PREFIX.length());
    if (suffix.isEmpty()) suffix = "/";
    URI target;
    try {
      target = new URI(
          UPSTREAM.getScheme(), null, UPSTREAM.getHost(), -1,
          "/maven2" + suffix, incoming.getRawQuery(), null);
    } catch (Exception error) {
      sendText(exchange, 400, "invalid_repository_path");
      return;
    }

    try {
      HttpResponse<InputStream> upstream = fetch(target, method, exchange);
      for (var entry : upstream.headers().map().entrySet()) {
        if (RESPONSE_HEADERS.contains(entry.getKey().toLowerCase(Locale.ROOT))) {
          exchange.getResponseHeaders().put(entry.getKey(), List.copyOf(entry.getValue()));
        }
      }
      long length = upstream.headers().firstValueAsLong("content-length").orElse(0L);
      if (method.equals("HEAD")) {
        exchange.sendResponseHeaders(upstream.statusCode(), -1);
        upstream.body().close();
      } else {
        exchange.sendResponseHeaders(upstream.statusCode(), length);
        try (InputStream body = upstream.body(); var output = exchange.getResponseBody()) {
          body.transferTo(output);
        }
      }
    } catch (Exception error) {
      sendText(exchange, 502, "maven_central_proxy_upstream_failed");
    } finally {
      exchange.close();
    }
  }

  private static HttpResponse<InputStream> fetch(
      URI initial, String method, HttpExchange exchange) throws Exception {
    URI current = initial;
    for (int redirects = 0; redirects <= 3; redirects += 1) {
      var builder = HttpRequest.newBuilder(current).timeout(Duration.ofSeconds(30));
      exchange.getRequestHeaders().forEach((name, values) -> {
        if (REQUEST_HEADERS.contains(name.toLowerCase(Locale.ROOT))) {
          values.forEach(value -> builder.header(name, value));
        }
      });
      builder.method(method, HttpRequest.BodyPublishers.noBody());
      HttpResponse<InputStream> response = CLIENT.send(
          builder.build(), HttpResponse.BodyHandlers.ofInputStream());
      if (response.statusCode() < 300 || response.statusCode() >= 400) return response;
      String location = response.headers().firstValue("location").orElse(null);
      if (location == null || redirects == 3) return response;
      URI redirected = current.resolve(location);
      response.body().close();
      if (!sameOrigin(redirected, UPSTREAM)) {
        throw new IOException("maven_central_redirect_origin_rejected");
      }
      current = redirected;
    }
    throw new IOException("maven_central_redirect_limit_exceeded");
  }

  private static boolean sameOrigin(URI left, URI right) {
    return left.getScheme().equalsIgnoreCase(right.getScheme())
        && left.getHost().equalsIgnoreCase(right.getHost())
        && normalizedPort(left) == normalizedPort(right);
  }

  private static int normalizedPort(URI value) {
    if (value.getPort() >= 0) return value.getPort();
    return value.getScheme().equalsIgnoreCase("https") ? 443 : 80;
  }

  private static void sendText(HttpExchange exchange, int status, String text) throws IOException {
    byte[] body = text.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
    exchange.sendResponseHeaders(status, body.length);
    exchange.getResponseBody().write(body);
    exchange.close();
  }
}
