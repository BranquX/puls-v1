import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  countMetPasswordRules,
  PASSWORD_RULE_LABELS,
  passwordStrengthTier,
} from "../lib/password-validation";

type Props = {
  password: string;
};

const TIER_COLORS = {
  weak: { bar: "#F87171", label: "#FCA5A5", text: "חלש" },
  medium: { bar: "#EAB308", label: "#FDE047", text: "בינוני" },
  strong: { bar: "#4ADE80", label: "#86EFAC", text: "חזק" },
} as const;

export function PasswordRequirements({ password }: Props) {
  const tier = passwordStrengthTier(password);
  const metCount = countMetPasswordRules(password);
  const fillRatio = metCount / PASSWORD_RULE_LABELS.length;

  const colors = TIER_COLORS[tier];

  const rulesUi = useMemo(
    () =>
      PASSWORD_RULE_LABELS.map((rule) => ({
        ...rule,
        ok: rule.test(password),
      })),
    [password],
  );

  if (password.length === 0) {
    return null;
  }

  return (
    <View style={styles.wrap} accessibilityLanguage="he">
      <View style={styles.meterHeader}>
        <Text style={[styles.strengthLabel, { color: colors.label }]}>
          חוזק סיסמה: {colors.text}
        </Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${Math.round(fillRatio * 100)}%`,
              backgroundColor: colors.bar,
            },
          ]}
        />
      </View>
      <View style={styles.list}>
        {rulesUi.map((r) => (
          <View key={r.key} style={styles.ruleRow}>
            <Text
              style={[styles.ruleIcon, r.ok ? styles.iconOk : styles.iconBad]}
            >
              {r.ok ? "✓" : "✗"}
            </Text>
            <Text
              style={[styles.ruleText, r.ok ? styles.ruleOk : styles.ruleBad]}
            >
              {r.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 10,
    gap: 8,
  },
  meterHeader: {
    flexDirection: "row-reverse",
    justifyContent: "flex-start",
  },
  strengthLabel: {
    fontSize: 12,
    fontWeight: "700",
  },
  track: {
    height: 6,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 4,
    minWidth: 4,
  },
  list: {
    marginTop: 4,
    gap: 6,
  },
  ruleRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
  },
  ruleIcon: {
    fontSize: 14,
    fontWeight: "800",
    width: 18,
    textAlign: "center",
  },
  iconOk: { color: "#4ADE80" },
  iconBad: { color: "#F87171" },
  ruleText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "right",
  },
  ruleOk: {
    color: "rgba(134, 239, 172, 0.95)",
  },
  ruleBad: {
    color: "rgba(248, 113, 113, 0.9)",
  },
});
