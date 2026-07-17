import { z } from "zod";

const zapInstanceSchema = z
	.object({
		uri: z.string().min(1),
		method: z.string().optional(),
		param: z.string().optional(),
		attack: z.string().optional(),
		evidence: z.string().optional(),
		otherinfo: z.string().optional(),
	})
	.catchall(z.unknown());

const zapAlertSchema = z
	.object({
		pluginid: z.string().min(1),
		alertRef: z.string().optional(),
		name: z.string().optional(),
		alert: z.string().optional(),
		riskcode: z.string(),
		confidence: z.string().optional(),
		desc: z.string().optional(),
		solution: z.string().optional(),
		reference: z.string().optional(),
		cweid: z.string().optional(),
		wascid: z.string().optional(),
		instances: z.array(zapInstanceSchema).optional(),
	})
	.catchall(z.unknown());

const zapSiteSchema = z
	.object({
		"@name": z.string().optional(),
		"@host": z.string().optional(),
		"@port": z.string().optional(),
		"@ssl": z.string().optional(),
		alerts: z.array(zapAlertSchema).optional(),
	})
	.catchall(z.unknown());

export const zapReportSchema = z
	.object({
		"@programName": z.string().min(1),
		"@version": z.string().min(1),
		site: z.array(zapSiteSchema),
	})
	.catchall(z.unknown());

export type ZapReport = z.infer<typeof zapReportSchema>;
export type ZapAlert = z.infer<typeof zapAlertSchema>;
export type ZapInstance = z.infer<typeof zapInstanceSchema>;
export type ZapSite = z.infer<typeof zapSiteSchema>;

export function parseZapReport(value: unknown): ZapReport {
	return zapReportSchema.parse(value);
}
