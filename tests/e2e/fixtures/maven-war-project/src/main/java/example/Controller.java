package example;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller
final class ExampleController {
	@RequestMapping("/")
	void index() {}
}
