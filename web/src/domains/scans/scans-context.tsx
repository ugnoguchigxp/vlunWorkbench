import { createContext, useContext, type ReactNode } from "react";
import type { ScansController } from "./use-scans-controller";

const ScansContext = createContext<ScansController | null>(null);

export const ScansProvider = ({
	children,
	value,
}: {
	children: ReactNode;
	value: ScansController;
}) => <ScansContext.Provider value={value}>{children}</ScansContext.Provider>;

export const useScans = () => {
	const value = useContext(ScansContext);
	if (!value) throw new Error("useScans must be used within ScansProvider.");
	return value;
};
