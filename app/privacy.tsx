import React from "react";
import {
  SafeAreaView,
  ScrollView,
  Text,
  View,
  Pressable,
  StyleSheet,
  StatusBar,
} from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "../contexts/theme-context";

export default function PrivacyScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={colors.statusBar} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.separator }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={[styles.backArrow, { color: colors.text }]}>←</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          מדיניות פרטיות
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* כללי */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>כללי</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          אפליקציית פולס. מספקת שירותי ניהול פרסום דיגיטלי לעסקים קטנים ובינוניים
          בישראל.
        </Text>

        {/* מידע שאנחנו אוספים */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          מידע שאנחנו אוספים
        </Text>
        <View style={styles.bulletList}>
          <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
            • פרטי עסק (שם, תעשייה, אתר, טלפון)
          </Text>
          <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
            • נתוני מותג (צבעים, פונטים, טון דיבור)
          </Text>
          <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
            • נתוני קהל יעד
          </Text>
          <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
            • שיחות עם הסוכנים (דנה, יוני, רון, מאיה, נועה)
          </Text>
          <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
            • גרפיקות שנוצרו
          </Text>
        </View>

        {/* שימוש בנתוני Meta */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          שימוש בנתוני Meta
        </Text>
        <View style={styles.bulletList}>
          <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
            • אנו מתחברים לחשבון הפייסבוק שלך באמצעות OAuth
          </Text>
          <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
            • אנו קוראים נתוני קמפיינים, הוצאות, קליקים ולידים
          </Text>
          <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
            • אנו לא משנים או מוחקים קמפיינים ללא אישורך המפורש
          </Text>
          <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
            • הטוקן נשמר בצורה מוצפנת ומתחדש אוטומטית
          </Text>
        </View>

        {/* אבטחת מידע */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          אבטחת מידע
        </Text>
        <View style={styles.bulletList}>
          <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
            • כל המידע מאוחסן בשרתי Supabase מאובטחים
          </Text>
          <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
            • הגישה מוגנת באמצעות Row Level Security
          </Text>
          <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
            • תקשורת מוצפנת ב-SSL
          </Text>
        </View>

        {/* מחיקת חשבון */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          מחיקת חשבון
        </Text>
        <View style={styles.bulletList}>
          <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
            • ניתן למחוק את החשבון בכל עת דרך ההגדרות
          </Text>
          <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
            • מחיקה תסיר את כל המידע שלך באופן בלתי הפיך
          </Text>
        </View>

        {/* יצירת קשר */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          יצירת קשר
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          לשאלות בנושא פרטיות: eden@puls.co.il
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
  },
  backArrow: {
    fontSize: 22,
    fontWeight: "600",
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
    writingDirection: "rtl",
  },
  headerSpacer: {
    width: 38,
  },
  scrollContent: {
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 48,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
    marginTop: 24,
    marginBottom: 10,
  },
  body: {
    fontSize: 15,
    lineHeight: 24,
    textAlign: "right",
    writingDirection: "rtl",
  },
  bulletList: {
    gap: 8,
  },
  bulletItem: {
    fontSize: 15,
    lineHeight: 24,
    textAlign: "right",
    writingDirection: "rtl",
  },
});
