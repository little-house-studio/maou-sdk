/** Panel —— 带边框/标题的 RPG 容器框 */
import React from "react";
import { Box, Text } from "ink";
import { currentTheme } from "../theme.js";

type BorderStyle = "round" | "single" | "double" | "bold" | "classic";

export function Panel({
  title,
  children,
  borderStyle = "round",
  borderColor,
  focused = false,
  flexGrow,
  width,
  height,
  padX = 1,
  icon,
}: {
  title?: string;
  children?: React.ReactNode;
  borderStyle?: BorderStyle;
  borderColor?: string;
  focused?: boolean;
  flexGrow?: number;
  width?: number | string;
  height?: number | string;
  padX?: number;
  icon?: string;
}) {
  const t = currentTheme;
  const bc = focused ? t.accent : borderColor ?? t.border;
  return (
    <Box
      flexDirection="column"
      borderStyle={borderStyle as any}
      borderColor={bc}
      flexGrow={flexGrow}
      width={width as any}
      height={height as any}
      paddingX={padX}
    >
      {title !== undefined && (
        <Box marginTop={-1} marginBottom={0}>
          <Text color={bc} bold>{icon ? `${icon} ` : ""}{title}{focused ? " ◆" : ""}</Text>
        </Box>
      )}
      {children}
    </Box>
  );
}
