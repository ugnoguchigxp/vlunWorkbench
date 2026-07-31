import { registerBuiltInPlugins } from "../../modules/project-capabilities/plugin-registry";
import { gradleBuildPlugin } from "./java/gradle";
import { javaLanguagePlugin } from "./java/language";
import { mavenBuildPlugin } from "./java/maven";
import { springFrameworkPlugin } from "./java/spring";
import { typescriptFrameworkPlugins } from "./typescript/frameworks";
import { typescriptLanguagePlugin } from "./typescript/language";
import { npmBuildPlugin } from "./typescript/npm";
import { goFrameworkPlugins } from "./go/frameworks";
import { goLanguagePlugin } from "./go/language";
import { goModulesPlugin } from "./go/modules";
import { pythonFrameworkPlugins } from "./python/frameworks";
import { pythonLanguagePlugin } from "./python/language";
import { pythonRequirementsPlugin } from "./python/requirements";

export const BUILT_IN_TECHNOLOGY_PLUGINS = [
	typescriptLanguagePlugin,
	npmBuildPlugin,
	...typescriptFrameworkPlugins,
	javaLanguagePlugin,
	mavenBuildPlugin,
	gradleBuildPlugin,
	springFrameworkPlugin,
	pythonLanguagePlugin,
	pythonRequirementsPlugin,
	...pythonFrameworkPlugins,
	goLanguagePlugin,
	goModulesPlugin,
	...goFrameworkPlugins,
] as const;

export const builtInTechnologyPluginRegistry = registerBuiltInPlugins(
	BUILT_IN_TECHNOLOGY_PLUGINS,
);
