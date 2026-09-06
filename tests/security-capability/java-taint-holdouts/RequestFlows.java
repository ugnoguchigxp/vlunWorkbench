import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.HashMap;

class RequestFlows {
  void separateArgument(HttpServletRequest request, Statement statement) throws Exception {
    String param=request.getParameter("q");
    String bar; int num=86;
    if ((7*42)-num>200) bar="safe"; else bar=param;
    // expect: sql-injection
    statement.execute(param);
    // reject: sql-injection
    statement.execute(bar);
  }
  void occurrence(HttpServletRequest request, Statement statement) throws Exception {
    String param=request.getParameter("q"); String bar=param;
    // expect: sql-injection
    statement.execute(bar);
    int num=86; if ((7*42)-num>200) bar="safe"; else bar=param;
    // reject: sql-injection
    statement.execute(bar);
  }
  void changedCondition(HttpServletRequest request, Statement statement) throws Exception {
    String param=request.getParameter("q"); int num=86; num=106; String bar;
    if ((7*42)-num>200) bar="safe"; else bar=param;
    // expect: sql-injection
    statement.execute(bar);
  }
  void listMutation(HttpServletRequest request, Statement statement) throws Exception {
    String param=request.getParameter("q");
    List<String> values=new ArrayList<String>(); values.add("safe"); values.set(0,param);
    // expect: sql-injection
    statement.execute(values.get(0));
  }
  void mapMutation(HttpServletRequest request, Statement statement) throws Exception {
    String param=request.getParameter("q");
    HashMap<String,Object> values=new HashMap<String,Object>();values.put("key","safe");values.replace("key",param);
    // expect: sql-injection
    statement.execute((String)values.get("key"));
  }
  void overwrite(HttpServletRequest request, Statement statement) throws Exception {
    String input=request.getParameter("q"); List<String> values=new ArrayList<String>();
    values.add(input);values.add("safe");values.remove(0);
    // reject: sql-injection
    statement.execute(values.get(0));
  }
  void namedWrapper(HttpServletRequest request, Statement statement, HttpServletResponse response) throws Exception {
    UserInput input=new UserInput(request);
    // expect: sql-injection
    statement.execute(input.value("q"));
    // expect: command-injection
    Runtime.getRuntime().exec(input.value("q"));
    // expect: path-traversal-file
    new java.io.File(input.value("q"));
    // expect: xss-response-writer
    response.getWriter().print(input.value("q"));
    // reject: sql-injection
    statement.execute(input.constant("q"));
  }
  void writerAlias(HttpServletRequest request, HttpServletResponse response) throws Exception {
    java.io.PrintWriter output=response.getWriter();
    // expect: xss-response-writer
    output.print(request.getParameter("q"));
    // reject: xss-response-writer
    output.print("constant");
  }
  void encodedContext(HttpServletRequest request, HttpServletResponse response) throws Exception {
    response.setContentType("text/html");
    String value=org.owasp.esapi.ESAPI.encoder().encodeForHTML(request.getParameter("q"));
    // expect: xss-encoding-context
    response.getWriter().print("<script>" + value + "</script>");
    // expect: xss-encoding-context
    response.getWriter().print("<a href=\"" + value + "\">link</a>");
  }
  void encodedBody(HttpServletRequest request, HttpServletResponse response) throws Exception {
    response.setContentType("text/html");
    String value=org.owasp.esapi.ESAPI.encoder().encodeForHTML(request.getParameter("q"));
    // reject: xss-encoding-context
    response.getWriter().print(value);
    // reject: xss-response-writer
    response.getWriter().print(value);
  }
  void builderMutation(HttpServletRequest request, Statement statement) throws Exception {
    StringBuilder builder=new StringBuilder("fixed");builder.append(request.getParameter("q"));
    // expect: sql-injection
    statement.execute(builder.toString());
  }
  void builderInsert(HttpServletRequest request, Statement statement) throws Exception {
    StringBuilder builder=new StringBuilder("fixed");builder.insert(0,request.getParameter("q"));
    // expect: sql-injection
    statement.execute(builder.toString());
  }
  void builderCharacter(HttpServletRequest request, Statement statement) throws Exception {
    StringBuilder builder=new StringBuilder("fixed");builder.setCharAt(0,request.getParameter("q").charAt(0));
    // expect: sql-injection
    statement.execute(builder.toString());
  }
  void safeBuilder(HttpServletRequest request, Statement statement) throws Exception {
    UserInput input=new UserInput(request);
    StringBuilder builder=new StringBuilder(input.constant("q"));builder.append("suffix");
    // reject: sql-injection
    statement.execute(builder.toString());
  }
  void splitMutation(HttpServletRequest request, Statement statement) throws Exception {
    String[] values="fixed words".split(" ");values[0]=request.getParameter("q");
    // expect: sql-injection
    statement.execute(values[0]);
  }
  void safeSplit(HttpServletRequest request, Statement statement) throws Exception {
    UserInput input=new UserInput(request);String value=input.constant("q").split(" ")[0];
    // reject: sql-injection
    statement.execute(value);
  }
  void unknownFormat(HttpServletRequest request, HttpServletResponse response) throws Exception {
    response.setContentType("text/html");StringBuilder format=new StringBuilder("<script>");format.append("%s</script>");
    String value=org.springframework.web.util.HtmlUtils.htmlEscape(request.getParameter("q"));
    // expect: xss-response-writer
    response.getWriter().printf(format.toString(),value);
    // expect: xss-response-writer
    response.getWriter().printf("%cscript>%s%c/script>",60,value,60);
  }
  void fixedQuery(HttpServletRequest request, Statement statement) throws Exception {
    String input=request.getParameter("q");
    // reject: sql-injection
    statement.execute("SELECT id FROM users");
  }
}
class UserInput {
  private HttpServletRequest request;
  UserInput(HttpServletRequest input) {this.request=input;}
  String value(String key) {return request.getParameter(key);}
  String constant(String key) {return "fixed";}
}
