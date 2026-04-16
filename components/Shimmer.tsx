import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, ViewStyle } from "react-native";
import { useTheme } from "../contexts/theme-context";

type Props = {
  width?: ViewStyle["width"];
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
};

export function Shimmer({ width = "100%", height = 16, borderRadius = 8, style }: Props) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius, backgroundColor: colors.skeletonBg, opacity },
        style,
      ]}
    />
  );
}

export function ShimmerBlock({ style }: { style?: ViewStyle }) {
  return <Shimmer style={style} />;
}
