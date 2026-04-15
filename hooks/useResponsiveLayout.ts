import { useMemo } from "react";
import { useWindowDimensions } from "react-native";

export type LayoutMode = "mobile" | "desktop";

const DESKTOP_BREAKPOINT = 768;
export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  return useMemo(() => {
    const isDesktop = width > DESKTOP_BREAKPOINT;
    const sidebarWidth = isDesktop ? Math.round(width * 0.1) : 0;
    return {
      isDesktop,
      mode: (isDesktop ? "desktop" : "mobile") as LayoutMode,
      sidebarWidth,
      contentWidth: isDesktop ? width - sidebarWidth : width,
      mediaColumns: isDesktop ? (width > 1200 ? 5 : 4) : 2,
      homeColumns: isDesktop ? 3 : 1,
      width,
      height,
    };
  }, [width, height]);
}
