import { createHash } from "node:crypto";
import {
	type SecurityIntelligenceAssessmentV1,
	securityIntelligenceAssessmentV1Schema,
} from "./schemas/security-intelligence-assessment.schema";

export type SecurityIntelligenceCanonicalJson =
	| null
	| boolean
	| number
	| string
	| SecurityIntelligenceCanonicalJson[]
	| { [key: string]: SecurityIntelligenceCanonicalJson };

export function canonicalizeSecurityIntelligenceValue(
	value: unknown,
): SecurityIntelligenceCanonicalJson {
	if (value === null || typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		if (value.normalize("NFC") !== value) {
			throw new Error("security_intelligence:canonical_unicode_must_be_nfc");
		}
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new Error("security_intelligence:canonical_number_must_be_finite");
		}
		return value;
	}
	if (Array.isArray(value)) {
		const propertyNames = Object.getOwnPropertyNames(value);
		const expectedPropertyNames = [
			...Array.from({ length: value.length }, (_, index) => String(index)),
			"length",
		];
		if (
			propertyNames.length !== expectedPropertyNames.length ||
			propertyNames.some(
				(propertyName, index) => propertyName !== expectedPropertyNames[index],
			) ||
			Object.getOwnPropertySymbols(value).length > 0
		) {
			throw new Error(
				"security_intelligence:canonical_sparse_or_extended_array_not_supported",
			);
		}
		const result: SecurityIntelligenceCanonicalJson[] = [];
		for (let index = 0; index < value.length; index += 1) {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
			if (!descriptor || !("value" in descriptor)) {
				throw new Error(
					"security_intelligence:canonical_plain_array_value_required",
				);
			}
			result.push(canonicalizeSecurityIntelligenceValue(descriptor.value));
		}
		return result;
	}
	if (typeof value === "object") {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new Error("security_intelligence:canonical_plain_object_required");
		}
		const object = value as Record<string, unknown>;
		if (Object.getOwnPropertySymbols(object).length > 0) {
			throw new Error(
				"security_intelligence:canonical_symbol_property_not_supported",
			);
		}
		const result = Object.create(null) as Record<
			string,
			SecurityIntelligenceCanonicalJson
		>;
		const keys = Object.getOwnPropertyNames(object).sort();
		for (const key of keys) {
			if (key.normalize("NFC") !== key) {
				throw new Error("security_intelligence:canonical_unicode_must_be_nfc");
			}
			const descriptor = Object.getOwnPropertyDescriptor(object, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) {
				throw new Error(
					"security_intelligence:canonical_plain_object_property_required",
				);
			}
			if (descriptor.value === undefined) {
				throw new Error(
					"security_intelligence:canonical_undefined_not_supported",
				);
			}
			result[key] = canonicalizeSecurityIntelligenceValue(descriptor.value);
		}
		return result;
	}
	throw new Error("security_intelligence:canonical_value_not_json");
}

export function canonicalStringifySecurityIntelligenceValue(
	value: unknown,
): string {
	return JSON.stringify(canonicalizeSecurityIntelligenceValue(value));
}

export function securityIntelligenceAssessmentSemanticCanonicalJson(
	assessment: SecurityIntelligenceAssessmentV1,
): string {
	const {
		assessmentRef: _assessmentRef,
		generatedAt: _generatedAt,
		...semantic
	} = assessment;
	return canonicalStringifySecurityIntelligenceValue(semantic);
}

export function deriveSecurityIntelligenceAssessmentRef(
	assessment: SecurityIntelligenceAssessmentV1,
): `sia:v1:${string}` {
	const digest = createHash("sha256")
		.update(securityIntelligenceAssessmentSemanticCanonicalJson(assessment))
		.digest("hex");
	return `sia:v1:${digest}`;
}

export function assertSecurityIntelligenceAssessmentSemanticIdentity(
	assessment: SecurityIntelligenceAssessmentV1,
): void {
	if (
		assessment.assessmentRef !==
		deriveSecurityIntelligenceAssessmentRef(assessment)
	) {
		throw new Error("security_intelligence:assessment_ref_mismatch");
	}
}

export function parseSecurityIntelligenceAssessmentV1(
	input: unknown,
): SecurityIntelligenceAssessmentV1 {
	const assessment = securityIntelligenceAssessmentV1Schema.parse(input, {
		error: (issue) =>
			issue.code === "unrecognized_keys"
				? "security_intelligence:unknown_field"
				: undefined,
	});
	assertSecurityIntelligenceAssessmentSemanticIdentity(assessment);
	return assessment;
}
