import { z } from "zod";
import { projectSchema } from "./scan.schema";

/** Serialized project contract shared by the API and browser transport. */
export const projectApiSchema = projectSchema.extend({
	createdAt: z.string(),
	updatedAt: z.string(),
	pathPolicy: z
		.object({
			status: z.enum(["allowed", "blocked", "missing"]),
			reasonCode: z.string().nullable(),
		})
		.optional(),
});
export const projectListResponseSchema = z.object({
	projects: z.array(projectApiSchema),
});
export const projectResponseSchema = z.object({ project: projectApiSchema });
export type ProjectApi = z.infer<typeof projectApiSchema>;
