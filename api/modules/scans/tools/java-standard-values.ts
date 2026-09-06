import {
	collectionCall,
	known,
	safe,
	type Value,
} from "./java-constant-values";
export function javaStandardMethod(
	receiver: Value,
	name: string,
	args: Value[],
): Value | null {
	if (receiver.kind === "html" && !args.length) {
		if (name === "toCharArray") return receiver;
		if (name === "length") return { ...safe(), javaType: "number" };
	}
	if (receiver.kind === "list" && receiver.flavor === "string-builder")
		return collectionCall(receiver, name, args);
	if (known(receiver) && args.every(known)) {
		if (
			name === "getResource" &&
			receiver.javaType === "class-loader" &&
			args.length === 1
		)
			return { ...safe(), javaType: "url" };
		if (
			receiver.javaType === "url" &&
			/^(?:toURI|getPath)$/.test(name ?? "") &&
			!args.length
		)
			return { ...safe(), javaType: "url" };
		if (
			receiver.javaType === "file-descriptor" &&
			name === "getFD" &&
			!args.length
		)
			return receiver;
		if (
			receiver.javaType === "file" &&
			/^(?:getPath|getAbsolutePath)$/.test(name ?? "") &&
			!args.length
		)
			return safe();
		if (
			!receiver.javaType &&
			[
				"toCharArray",
				"getBytes",
				"length",
				"replace",
				"substring",
				"split",
			].includes(name ?? "")
		) {
			if (name === "length")
				return {
					...safe(
						typeof receiver.value === "string"
							? receiver.value.length
							: undefined,
					),
					javaType: "number",
				};
			if (name === "getBytes" || name === "split")
				return { kind: "list", flavor: "unknown-length", items: [safe()] };
			if (name === "toCharArray")
				return {
					kind: "list",
					items:
						typeof receiver.value === "string"
							? receiver.value.split("").map((value) => safe(value))
							: [safe()],
				};
			return safe();
		}
	}
	return null;
}
