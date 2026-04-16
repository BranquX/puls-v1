import React from "react";
import {
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "../contexts/theme-context";

const LAST_UPDATED = "15 באפריל 2026";

function Section({ title, children, colors }: { title: string; children: React.ReactNode; colors: ReturnType<typeof useTheme>["colors"] }) {
  return (
    <View style={s.section}>
      <Text style={[s.sectionTitle, { color: colors.text }]}>{title}</Text>
      {children}
    </View>
  );
}

function P({ children, colors }: { children: React.ReactNode; colors: ReturnType<typeof useTheme>["colors"] }) {
  return <Text style={[s.body, { color: colors.textSecondary }]}>{children}</Text>;
}

function Bullet({ children, colors }: { children: React.ReactNode; colors: ReturnType<typeof useTheme>["colors"] }) {
  return <Text style={[s.bullet, { color: colors.textSecondary }]}>{`\u2022  ${children}`}</Text>;
}

export default function PrivacyScreen() {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={colors.statusBar} />
      <ScrollView
        contentContainerStyle={[s.scroll, Platform.OS === "web" ? ({ direction: "rtl" } as const) : null]}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.content}>
          <Text style={[s.logo, { color: colors.text }]}>Puls.</Text>
          <Text style={[s.title, { color: colors.text }]}>מדיניות פרטיות</Text>
          <Text style={[s.updated, { color: colors.textMuted }]}>עדכון אחרון: {LAST_UPDATED}</Text>

          <View style={[s.card, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>

            <Section title="1. כללי" colors={colors}>
              <P colors={colors}>
                Puls. ("האפליקציה", "אנחנו") היא פלטפורמה לניהול פרסום דיגיטלי לעסקים קטנים ובינוניים בישראל. מדיניות פרטיות זו מסבירה אילו נתונים אנו אוספים, כיצד אנו משתמשים בהם, ומהן זכויותיך בנוגע למידע שלך.
              </P>
              <P colors={colors}>
                בשימוש באפליקציה אתה מסכים לתנאי מדיניות זו.
              </P>
            </Section>

            <Section title="2. מידע שאנו אוספים" colors={colors}>
              <P colors={colors}>אנו אוספים את סוגי המידע הבאים:</P>
              <Bullet colors={colors}>פרטי חשבון — כתובת אימייל וסיסמה (מוצפנת)</Bullet>
              <Bullet colors={colors}>פרטי עסק — שם, תחום, אתר אינטרנט, טלפון, כתובת, תיאור</Bullet>
              <Bullet colors={colors}>נתוני מותג — צבעים, פונטים, טון דיבור, לוגו, סגנון עיצובי</Bullet>
              <Bullet colors={colors}>נתוני קהל יעד — גיל, מגדר, אזור גיאוגרפי, מתחרים</Bullet>
              <Bullet colors={colors}>שיחות עם סוכני AI — היסטוריית צ'אט עם דנה, יוני, רון, מאיה ונועה</Bullet>
              <Bullet colors={colors}>גרפיקות ותמונות — תמונות שנוצרו באמצעות מאיה ונשמרו בספרייה</Bullet>
              <Bullet colors={colors}>זיכרון לקוח — תובנות ומידע שנלמד מהשיחות לשיפור השירות</Bullet>
            </Section>

            <Section title="3. שימוש בנתוני Meta (פייסבוק)" colors={colors}>
              <P colors={colors}>
                כאשר אתה מחבר את חשבון הפייסבוק שלך לאפליקציה, אנו מקבלים גישה לנתונים הבאים באמצעות Facebook Login ו-Meta Marketing API:
              </P>
              <Bullet colors={colors}>חשבונות מודעות — מזהה, שם, סטטוס</Bullet>
              <Bullet colors={colors}>קמפיינים — שם, תקציב, סטטוס, ביצועים (הוצאה, קליקים, חשיפות)</Bullet>
              <Bullet colors={colors}>דפי פייסבוק — מזהה ושם</Bullet>
              <Bullet colors={colors}>חשבונות אינסטגרם עסקיים — מזהה ושם משתמש</Bullet>
              <Bullet colors={colors}>לידים — נתוני טפסים (שם, אימייל, טלפון של לידים שהגיעו מהמודעות שלך)</Bullet>
              <Bullet colors={colors}>פיקסלים — מזהה ושם</Bullet>
              <P colors={colors}>
                אנו משתמשים בנתונים אלה אך ורק כדי להציג לך ניתוח ביצועים, המלצות לשיפור, והתראות על קמפיינים. אנו לא מוכרים או משתפים נתונים אלה עם צד שלישי.
              </P>
              <P colors={colors}>
                אנו לא משנים, יוצרים או מוחקים קמפיינים ללא אישורך המפורש. כל פעולה דורשת אישור בצ'אט לפני ביצוע.
              </P>
            </Section>

            <Section title="4. שימוש מוגבל בנתונים (Limited Data Use)" colors={colors}>
              <P colors={colors}>
                השימוש שלנו בנתונים שמתקבלים מ-Facebook APIs עומד בדרישות Meta Platform Terms ו-Developer Policies, לרבות:
              </P>
              <Bullet colors={colors}>אנו משתמשים בנתונים רק למטרות שתוארו בהרשאות שנתבקשו</Bullet>
              <Bullet colors={colors}>אנו לא מעבירים נתונים לצדדים שלישיים, כולל לא לפלטפורמות פרסום מתחרות</Bullet>
              <Bullet colors={colors}>אנו לא משתמשים בנתונים לבניית פרופילי משתמשים שאינם קשורים לשירות</Bullet>
              <Bullet colors={colors}>אנו לא מוכרים, מרשים או מאפשרים כרייה של נתונים</Bullet>
              <Bullet colors={colors}>אנו מאחסנים נתונים באופן מאובטח ומוחקים אותם עם מחיקת החשבון</Bullet>
            </Section>

            <Section title="5. אבטחת מידע" colors={colors}>
              <Bullet colors={colors}>כל המידע מאוחסן בשרתי Supabase מאובטחים עם הצפנה בתעבורה (SSL/TLS) ובמנוחה</Bullet>
              <Bullet colors={colors}>הגישה לנתונים מוגנת באמצעות Row Level Security (RLS) — כל משתמש רואה רק את הנתונים שלו</Bullet>
              <Bullet colors={colors}>טוקן הגישה ל-Meta נשמר בצורה מוצפנת ומתחדש אוטומטית כל 60 יום</Bullet>
              <Bullet colors={colors}>סיסמאות מוצפנות באמצעות bcrypt ואינן נגישות לנו</Bullet>
              <Bullet colors={colors}>כל ה-API endpoints מוגנים באמצעות JWT authentication</Bullet>
            </Section>

            <Section title="6. שיתוף מידע עם צדדים שלישיים" colors={colors}>
              <P colors={colors}>אנו משתמשים בשירותים הבאים לצורך הפעלת האפליקציה:</P>
              <Bullet colors={colors}>Supabase — אחסון נתונים ואימות משתמשים</Bullet>
              <Bullet colors={colors}>Anthropic (Claude) — עיבוד שיחות עם סוכני AI</Bullet>
              <Bullet colors={colors}>Google (Gemini) — יצירת תמונות</Bullet>
              <Bullet colors={colors}>Meta APIs — קריאת וניהול נתוני קמפיינים</Bullet>
              <P colors={colors}>
                אנו לא מוכרים, משכירים או משתפים את המידע האישי שלך עם גורמים אחרים מעבר לנדרש להפעלת השירות.
              </P>
            </Section>

            <Section title="7. מחיקת נתונים" colors={colors}>
              <P colors={colors}>
                באפשרותך למחוק את חשבונך ואת כל הנתונים שלך בכל עת:
              </P>
              <Bullet colors={colors}>היכנסו להגדרות באפליקציה ← לחצו על "מחק חשבון"</Bullet>
              <Bullet colors={colors}>כל הנתונים יימחקו באופן בלתי הפיך, כולל: פרטי עסק, שיחות, גרפיקות, זיכרון לקוח, וטוקני Meta</Bullet>
              <Bullet colors={colors}>לא ניתן לשחזר את המידע לאחר מחיקה</Bullet>
              <P colors={colors}>
                לחלופין, ניתן לשלוח בקשת מחיקה לכתובת: eden@puls.co.il
              </P>
            </Section>

            <Section title="8. ניתוק חשבון Meta" colors={colors}>
              <P colors={colors}>
                באפשרותך לנתק את חשבון ה-Meta שלך בכל עת דרך ההגדרות באפליקציה. ניתוק יסיר את טוקן הגישה ואת כל נתוני הקמפיינים מהמערכת שלנו. ניתן גם לבטל את ההרשאות דרך הגדרות הפרטיות בפייסבוק.
              </P>
            </Section>

            <Section title="9. זכויות המשתמש" colors={colors}>
              <P colors={colors}>יש לך את הזכויות הבאות:</P>
              <Bullet colors={colors}>גישה — לצפות בכל המידע שנאסף עליך</Bullet>
              <Bullet colors={colors}>תיקון — לעדכן או לתקן מידע שגוי</Bullet>
              <Bullet colors={colors}>מחיקה — למחוק את כל המידע שלך</Bullet>
              <Bullet colors={colors}>ניתוק — לנתק שילובים עם Meta בכל עת</Bullet>
              <Bullet colors={colors}>ייצוא — לבקש עותק של הנתונים שלך</Bullet>
            </Section>

            <Section title="10. עדכונים למדיניות" colors={colors}>
              <P colors={colors}>
                אנו עשויים לעדכן מדיניות זו מעת לעת. שינויים מהותיים יפורסמו באפליקציה. המשך השימוש לאחר עדכון מהווה הסכמה לשינויים.
              </P>
            </Section>

            <Section title="11. יצירת קשר" colors={colors}>
              <P colors={colors}>לשאלות או בקשות בנושא פרטיות:</P>
              <P colors={colors}>אימייל: eden@puls.co.il</P>
            </Section>

          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flexGrow: 1 },
  content: { maxWidth: 680, width: "100%", alignSelf: "center", paddingHorizontal: 22, paddingTop: 40, paddingBottom: 60 },
  logo: { fontSize: 32, fontWeight: "900", textAlign: "center", letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: "800", textAlign: "center", marginTop: 8 },
  updated: { fontSize: 13, textAlign: "center", marginTop: 6, marginBottom: 24 },
  card: { borderRadius: 16, borderWidth: 1, padding: 24 },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 17, fontWeight: "800", textAlign: "right", writingDirection: "rtl", marginBottom: 10 },
  body: { fontSize: 15, lineHeight: 26, textAlign: "right", writingDirection: "rtl", marginBottom: 8 },
  bullet: { fontSize: 15, lineHeight: 26, textAlign: "right", writingDirection: "rtl", paddingRight: 4, marginBottom: 4 },
});
