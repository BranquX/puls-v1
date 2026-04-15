import React from "react";
import { StyleSheet, Text, View } from "react-native";

type PulsLogoProps = {
  size?: "sm" | "md" | "lg";
  variant?: "dark" | "light";
  showText?: boolean;
};

const SIZES = { sm: 24, md: 32, lg: 44 };
const FONT_SIZES = { sm: 16, md: 20, lg: 28 };

export default function PulsLogo({ size = "md", variant = "dark", showText = true }: PulsLogoProps) {
  const s = SIZES[size];
  const textColor = variant === "dark" ? "#F3F6FF" : "#0A0F1E";
  return (
    <View style={styles.row}>
      <View style={[styles.iconWrap, { width: s, height: s, borderRadius: s * 0.3 }]}>
        <Text style={[styles.iconText, { fontSize: s * 0.5 }]}>{"\u3030"}</Text>
      </View>
      {showText && (
        <Text style={[styles.brand, { fontSize: FONT_SIZES[size], color: textColor }]}>
          Puls<Text style={styles.dot}>.</Text>
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row-reverse", alignItems: "center", gap: 8 },
  iconWrap: {
    backgroundColor: "#4F6EF7",
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: { color: "#FFFFFF" },
  brand: { fontWeight: "800" },
  dot: { color: "#4F6EF7", fontWeight: "900" },
});
