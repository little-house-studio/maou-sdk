import { createContext, createElement, useContext, type ReactNode } from "react";
import type { AppPorts } from "./types";

const PortsContext = createContext<AppPorts | null>(null);

export function PortsProvider({
  ports,
  children,
}: {
  ports: AppPorts;
  children: ReactNode;
}) {
  return createElement(PortsContext.Provider, { value: ports }, children);
}

export function useAppPorts(): AppPorts {
  const ports = useContext(PortsContext);
  if (!ports) throw new Error("PortsProvider missing");
  return ports;
}

export function useOptionalAppPorts(): AppPorts | null {
  return useContext(PortsContext);
}
