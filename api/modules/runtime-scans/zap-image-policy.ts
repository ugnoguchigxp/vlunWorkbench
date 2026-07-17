export const ZAP_VERSION = "2.17.0";
export const ZAP_STABLE_IMAGE =
	"zaproxy/zap-stable@sha256:8d387b1a63e3425beef4846e39719f5af2a787753af2d8b6558c6257d7a577a2";
export const ZAP_REPORT_FILENAME = "zap-report.json";

export function isPinnedZapImage(image: string): boolean {
	return /^zaproxy\/zap-stable@sha256:[a-f0-9]{64}$/.test(image);
}

if (!isPinnedZapImage(ZAP_STABLE_IMAGE)) {
	throw new Error("ZAP image policy must use an immutable image index digest.");
}
