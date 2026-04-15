import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useBusiness } from "../../contexts/business-context";
import { useTheme } from "../../contexts/theme-context";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { fetchAdchatApi } from "../../lib/fetch-adchat-api";
import { Shimmer } from "../../components/Shimmer";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

// --- Types ---

type LeadStatus = "new" | "contacted" | "qualified" | "proposal" | "won" | "lost" | "not_relevant";

type Lead = {
  id: string;
  lead_id: string;
  form_id: string | null;
  form_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  page_id: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  custom_fields: Record<string, string>;
  ad_image_url: string | null;
  ad_headline: string | null;
  ad_body: string | null;
  status: LeadStatus;
  assigned_to: string | null;
  notes: string | null;
  next_follow_up: string | null;
  deal_value: number | null;
  created_at: string;
  updated_at: string;
  meta_created_time: string | null;
  lead_updates: { count: number }[] | null;
};

type LeadUpdate = {
  id: string;
  lead_id: string;
  content: string;
  type: string;
  created_at: string;
};

type LeadStats = {
  total: number;
  new_today: number;
  new_this_week: number;
  by_status: Record<string, number>;
  by_campaign: Record<string, number>;
  conversion_rate: number;
  pending: number;
};

// --- Constants ---

const STATUS_COLORS: Record<LeadStatus, string> = {
  new: "#3B82F6",
  contacted: "#EAB308",
  qualified: "#22C55E",
  proposal: "#8B5CF6",
  won: "#059669",
  lost: "#EF4444",
  not_relevant: "#94A3B8",
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "חדש",
  contacted: "יצר קשר",
  qualified: "מוסמך",
  proposal: "הצעה",
  won: "סגור",
  lost: "אבוד",
  not_relevant: "לא רלוונטי",
};

const FILTER_TABS: { key: string; label: string }[] = [
  { key: "", label: "הכל" },
  { key: "new", label: "חדש" },
  { key: "contacted", label: "יצר קשר" },
  { key: "qualified", label: "מוסמך" },
  { key: "proposal", label: "הצעה" },
  { key: "won", label: "סגור" },
  { key: "not_relevant", label: "לא רלוונטי" },
];

const UPDATE_TYPES: { key: string; label: string; icon: string }[] = [
  { key: "note", label: "הערה", icon: "create-outline" },
  { key: "call", label: "שיחה", icon: "call-outline" },
  { key: "whatsapp", label: "וואטסאפ", icon: "logo-whatsapp" },
  { key: "email", label: "מייל", icon: "mail-outline" },
  { key: "meeting", label: "פגישה", icon: "people-outline" },
];

// --- Helpers ---

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דק'`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שע'`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `לפני ${days} ימים`;
  const weeks = Math.floor(days / 7);
  return `לפני ${weeks} שבועות`;
}

function updateTypeIcon(type: string): string {
  const map: Record<string, string> = {
    note: "create-outline",
    call: "call-outline",
    email: "mail-outline",
    whatsapp: "logo-whatsapp",
    meeting: "people-outline",
    status_change: "swap-horizontal-outline",
  };
  return map[type] || "create-outline";
}

// --- Lead Card ---

function LeadCard({
  lead,
  onPress,
  selected,
  colors,
}: {
  lead: Lead;
  onPress: () => void;
  selected: boolean;
  colors: any;
}) {
  const statusColor = STATUS_COLORS[lead.status] || "#94A3B8";
  const updatesCount =
    lead.lead_updates && lead.lead_updates.length > 0
      ? lead.lead_updates[0].count
      : 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.leadCard,
        {
          backgroundColor: selected ? "rgba(79,110,247,0.08)" : colors.cardBg,
          borderColor: selected ? "#4F6EF7" : colors.cardBorder,
          borderRightWidth: 4,
          borderRightColor: statusColor,
        },
        pressed && { opacity: 0.9 },
      ]}
    >
      <View style={styles.leadCardTop}>
        {lead.ad_image_url ? (
          <Image
            source={{ uri: lead.ad_image_url }}
            style={styles.leadThumb}
          />
        ) : (
          <View style={[styles.leadThumbPlaceholder, { backgroundColor: statusColor + "22" }]}>
            <Ionicons name="person" size={20} color={statusColor} />
          </View>
        )}
        <View style={styles.leadCardInfo}>
          <Text style={[styles.leadName, { color: colors.text }]} numberOfLines={1}>
            {lead.full_name || "ללא שם"}
          </Text>
          <View style={styles.leadMeta}>
            {lead.phone ? (
              <Text style={[styles.leadMetaText, { color: colors.textMuted }]} numberOfLines={1}>
                {lead.phone}
              </Text>
            ) : null}
            {lead.email ? (
              <Text style={[styles.leadMetaText, { color: colors.textMuted }]} numberOfLines={1}>
                {lead.email}
              </Text>
            ) : null}
          </View>
          {lead.campaign_name ? (
            <Text style={[styles.leadCampaign, { color: colors.textMuted }]} numberOfLines={1}>
              {lead.campaign_name}
              {lead.form_name ? ` \u2190 ${lead.form_name}` : ""}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.leadCardBottom}>
        <View style={[styles.statusChip, { backgroundColor: statusColor + "1A", borderColor: statusColor + "33" }]}>
          <Text style={[styles.statusChipText, { color: statusColor }]}>
            {STATUS_LABELS[lead.status] || lead.status}
          </Text>
        </View>
        <Text style={[styles.timeAgo, { color: colors.textMuted }]}>
          {timeAgo(lead.meta_created_time || lead.created_at)}
        </Text>
        {updatesCount > 0 ? (
          <View style={styles.updatesBadge}>
            <Ionicons name="chatbubble-outline" size={12} color={colors.textMuted} />
            <Text style={[styles.updatesBadgeText, { color: colors.textMuted }]}>{updatesCount}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// --- Lead Detail ---

function LeadDetail({
  leadId,
  businessId,
  colors,
  onClose,
  isDesktop,
  onLeadUpdated,
}: {
  leadId: string;
  businessId: string;
  colors: any;
  onClose?: () => void;
  isDesktop: boolean;
  onLeadUpdated: () => void;
}) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [updates, setUpdates] = useState<LeadUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [dealValue, setDealValue] = useState("");
  const [newUpdateText, setNewUpdateText] = useState("");
  const [newUpdateType, setNewUpdateType] = useState("note");
  const [submitting, setSubmitting] = useState(false);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadLead = useCallback(async () => {
    try {
      const res = await fetchAdchatApi(`${API_BASE}/api/leads/${leadId}`);
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setLead(json.lead);
        setUpdates(json.updates || []);
        setNotes(json.lead?.notes || "");
        setDealValue(json.lead?.deal_value != null ? String(json.lead.deal_value) : "");
      } else {
        console.error("[loadLead]", json?.error || res.status);
      }
    } catch (err) {
      console.error("[loadLead]", err);
    }
    setLoading(false);
  }, [leadId]);

  useEffect(() => {
    setLoading(true);
    void loadLead();
  }, [loadLead]);

  const patchLead = useCallback(
    async (patch: Record<string, any>) => {
      try {
        await fetchAdchatApi(`${API_BASE}/api/leads/${leadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        onLeadUpdated();
      } catch { /* ignore */ }
    },
    [leadId, onLeadUpdated],
  );

  const changeStatus = useCallback(
    (s: LeadStatus) => {
      setLead((prev) => (prev ? { ...prev, status: s } : prev));
      void patchLead({ status: s });
    },
    [patchLead],
  );

  const onNotesBlur = useCallback(() => {
    if (notesTimer.current) clearTimeout(notesTimer.current);
    void patchLead({ notes });
  }, [notes, patchLead]);

  const onDealBlur = useCallback(() => {
    const v = parseFloat(dealValue);
    void patchLead({ deal_value: Number.isFinite(v) ? v : null });
  }, [dealValue, patchLead]);

  const submitUpdate = useCallback(async () => {
    if (!newUpdateText.trim()) return;
    setSubmitting(true);
    try {
      await fetchAdchatApi(`${API_BASE}/api/leads/${leadId}/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newUpdateText.trim(), type: newUpdateType }),
      });
      setNewUpdateText("");
      await loadLead();
      onLeadUpdated();
    } catch { /* ignore */ }
    setSubmitting(false);
  }, [leadId, newUpdateText, newUpdateType, loadLead, onLeadUpdated]);

  if (loading) {
    return (
      <View style={[styles.detailContainer, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color="#4F6EF7" style={{ marginTop: 40 }} />
      </View>
    );
  }

  if (!lead) {
    return (
      <View style={[styles.detailContainer, { backgroundColor: colors.bg }]}>
        <Text style={[styles.detailEmpty, { color: colors.textMuted }]}>ליד לא נמצא</Text>
      </View>
    );
  }

  const statusColor = STATUS_COLORS[lead.status] || "#94A3B8";

  return (
    <ScrollView
      style={[styles.detailContainer, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.detailContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.detailHeader}>
        {!isDesktop && onClose ? (
          <Pressable onPress={onClose} style={styles.backBtn}>
            <Ionicons name="arrow-forward" size={22} color={colors.text} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={[styles.detailName, { color: colors.text }]}>
            {lead.full_name || "ללא שם"}
          </Text>
          <View style={[styles.statusChip, { backgroundColor: statusColor + "1A", borderColor: statusColor + "33", alignSelf: "flex-end", marginTop: 6 }]}>
            <Text style={[styles.statusChipText, { color: statusColor }]}>
              {STATUS_LABELS[lead.status]}
            </Text>
          </View>
        </View>
      </View>

      {/* Quick actions */}
      <View style={styles.quickActions}>
        {lead.phone ? (
          <Pressable
            style={[styles.quickBtn, { backgroundColor: "#22C55E22", borderColor: "#22C55E44" }]}
            onPress={() => Linking.openURL(`tel:${lead.phone}`)}
          >
            <Ionicons name="call" size={18} color="#22C55E" />
            <Text style={[styles.quickBtnText, { color: "#22C55E" }]}>התקשר</Text>
          </Pressable>
        ) : null}
        {lead.phone ? (
          <Pressable
            style={[styles.quickBtn, { backgroundColor: "#25D36622", borderColor: "#25D36644" }]}
            onPress={() => {
              const clean = lead.phone!.replace(/\D/g, "");
              Linking.openURL(`https://wa.me/${clean}`);
            }}
          >
            <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
            <Text style={[styles.quickBtnText, { color: "#25D366" }]}>וואטסאפ</Text>
          </Pressable>
        ) : null}
        {lead.email ? (
          <Pressable
            style={[styles.quickBtn, { backgroundColor: "#3B82F622", borderColor: "#3B82F644" }]}
            onPress={() => Linking.openURL(`mailto:${lead.email}`)}
          >
            <Ionicons name="mail" size={18} color="#3B82F6" />
            <Text style={[styles.quickBtnText, { color: "#3B82F6" }]}>מייל</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Status selector */}
      <View style={[styles.section, { borderColor: colors.cardBorder }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>סטטוס</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusRow}>
          {(Object.keys(STATUS_LABELS) as LeadStatus[]).map((s) => {
            const sc = STATUS_COLORS[s];
            const active = lead.status === s;
            return (
              <Pressable
                key={s}
                onPress={() => changeStatus(s)}
                style={[
                  styles.statusOption,
                  {
                    backgroundColor: active ? sc + "1A" : "transparent",
                    borderColor: active ? sc : colors.cardBorder,
                  },
                ]}
              >
                <View style={[styles.statusDot, { backgroundColor: sc }]} />
                <Text style={[styles.statusOptionText, { color: active ? sc : colors.textMuted }]}>
                  {STATUS_LABELS[s]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Contact info */}
      <View style={[styles.section, { borderColor: colors.cardBorder }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>פרטי קשר</Text>
        {[
          { label: "שם", value: lead.full_name },
          { label: "טלפון", value: lead.phone },
          { label: "מייל", value: lead.email },
          { label: "עיר", value: lead.city },
        ]
          .filter((f) => f.value)
          .map((f) => (
            <View key={f.label} style={styles.fieldRow}>
              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{f.label}</Text>
              <Text style={[styles.fieldValue, { color: colors.text }]}>{f.value}</Text>
            </View>
          ))}
        {lead.custom_fields && Object.keys(lead.custom_fields).length > 0
          ? Object.entries(lead.custom_fields).map(([k, v]) => (
              <View key={k} style={styles.fieldRow}>
                <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{k}</Text>
                <Text style={[styles.fieldValue, { color: colors.text }]}>{v}</Text>
              </View>
            ))
          : null}
      </View>

      {/* Ad info */}
      {(lead.ad_image_url || lead.campaign_name) ? (
        <View style={[styles.section, { borderColor: colors.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>פרטי מודעה</Text>
          {lead.ad_image_url ? (
            <Image source={{ uri: lead.ad_image_url }} style={styles.adImage} />
          ) : null}
          {lead.campaign_name ? (
            <Text style={[styles.adBreadcrumb, { color: colors.textMuted }]}>
              {[lead.campaign_name, lead.adset_name, lead.ad_name].filter(Boolean).join(" \u2190 ")}
            </Text>
          ) : null}
          {lead.form_name ? (
            <Text style={[styles.formName, { color: colors.textMuted }]}>
              טופס: {lead.form_name}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* CRM */}
      <View style={[styles.section, { borderColor: colors.cardBorder }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>CRM</Text>
        <View style={styles.fieldRow}>
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>שווי עסקה</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.cardBorder, backgroundColor: colors.inputBg }]}
            value={dealValue}
            onChangeText={setDealValue}
            onBlur={onDealBlur}
            placeholder="₪0"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
          />
        </View>
        <Text style={[styles.fieldLabel, { color: colors.textMuted, marginTop: 10, textAlign: "right" }]}>הערות</Text>
        <TextInput
          style={[styles.notesInput, { color: colors.text, borderColor: colors.cardBorder, backgroundColor: colors.inputBg }]}
          value={notes}
          onChangeText={setNotes}
          onBlur={onNotesBlur}
          placeholder="הוסף הערות..."
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
        />
      </View>

      {/* Timeline */}
      <View style={[styles.section, { borderColor: colors.cardBorder }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>ציר זמן</Text>

        {/* Add update */}
        <View style={styles.addUpdateBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.updateTypeTabs}>
            {UPDATE_TYPES.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setNewUpdateType(t.key)}
                style={[
                  styles.updateTypeTab,
                  {
                    backgroundColor: newUpdateType === t.key ? "#4F6EF722" : "transparent",
                    borderColor: newUpdateType === t.key ? "#4F6EF7" : colors.cardBorder,
                  },
                ]}
              >
                <Ionicons
                  name={t.icon as any}
                  size={14}
                  color={newUpdateType === t.key ? "#4F6EF7" : colors.textMuted}
                />
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "700",
                    color: newUpdateType === t.key ? "#4F6EF7" : colors.textMuted,
                    writingDirection: "rtl",
                  }}
                >
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.addUpdateRow}>
            <TextInput
              style={[styles.updateInput, { color: colors.text, borderColor: colors.cardBorder, backgroundColor: colors.inputBg }]}
              value={newUpdateText}
              onChangeText={setNewUpdateText}
              placeholder="הוסף עדכון..."
              placeholderTextColor={colors.textMuted}
            />
            <Pressable
              onPress={submitUpdate}
              disabled={submitting || !newUpdateText.trim()}
              style={[styles.sendBtn, (!newUpdateText.trim() || submitting) && { opacity: 0.5 }]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Ionicons name="send" size={18} color="#FFF" />
              )}
            </Pressable>
          </View>
        </View>

        {/* Updates list */}
        {updates.map((u) => (
          <View key={u.id} style={[styles.updateItem, { borderColor: colors.cardBorder }]}>
            <View style={styles.updateIcon}>
              <Ionicons name={updateTypeIcon(u.type) as any} size={16} color={colors.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.updateContent, { color: colors.text }]}>{u.content}</Text>
              <Text style={[styles.updateTime, { color: colors.textMuted }]}>{timeAgo(u.created_at)}</Text>
            </View>
          </View>
        ))}
        {updates.length === 0 ? (
          <Text style={[styles.emptyTimeline, { color: colors.textMuted }]}>אין עדכונים עדיין</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

// --- Main Screen ---

export default function LeadsScreen() {
  const { business, loading: businessLoading } = useBusiness();
  const { isDesktop } = useResponsiveLayout();
  const rawTabBarHeight = useBottomTabBarHeight();
  const tabBarHeight = isDesktop ? 0 : rawTabBarHeight;
  const { colors } = useTheme();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bid = business?.id;

  const loadLeads = useCallback(
    async (p = 1, silent = false) => {
      if (!bid) return;
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({ business_id: bid, page: String(p), limit: "20" });
        if (statusFilter) params.set("status", statusFilter);
        if (search) params.set("search", search);
        const res = await fetchAdchatApi(`${API_BASE}/api/leads?${params}`);
        const json = await res.json().catch(() => ({}));
        if (res.ok) {
          setLeads(json.leads || []);
          setTotalPages(json.pages || 1);
          setPage(p);
          setLoadError(null);
        } else {
          const msg = json?.error || `שגיאה ${res.status}`;
          console.error("[loadLeads]", msg);
          setLoadError(String(msg));
        }
      } catch (err) {
        console.error("[loadLeads]", err);
        setLoadError(err instanceof Error ? err.message : String(err));
      }
      setLoading(false);
    },
    [bid, statusFilter, search],
  );

  const loadStats = useCallback(async () => {
    if (!bid) return;
    try {
      const res = await fetchAdchatApi(`${API_BASE}/api/leads/stats?business_id=${bid}`);
      const json = await res.json().catch(() => ({}));
      if (res.ok) setStats(json);
      else console.error("[loadStats]", json?.error || res.status);
    } catch (err) {
      console.error("[loadStats]", err);
    }
  }, [bid]);

  useEffect(() => {
    if (!bid) { setLoading(false); return; }
    void loadLeads();
    void loadStats();
  }, [loadLeads, loadStats, bid]);

  // Debounced search
  const onSearchChange = useCallback(
    (text: string) => {
      setSearch(text);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        void loadLeads(1, true);
      }, 400);
    },
    [loadLeads],
  );

  const onFilterChange = useCallback(
    (f: string) => {
      setStatusFilter(f);
      // loadLeads will re-run via effect since statusFilter changed
    },
    [],
  );

  // Re-fetch when filter changes
  useEffect(() => {
    if (!bid) return;
    void loadLeads(1, true);
  }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadLeads(1), loadStats()]);
    setRefreshing(false);
  }, [loadLeads, loadStats]);

  const onSync = useCallback(async () => {
    if (!bid || syncing) return;
    setSyncing(true);
    try {
      const res = await fetchAdchatApi(`${API_BASE}/api/leads/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: bid }),
      });
      if (res.ok) {
        setLastSync(new Date().toISOString());
        await Promise.all([loadLeads(1), loadStats()]);
      } else {
        const json = await res.json().catch(() => ({}));
        console.error("[onSync]", json?.error || res.status);
        setLoadError(json?.error || `שגיאה בסנכרון ${res.status}`);
      }
    } catch (err) {
      console.error("[onSync]", err);
      setLoadError(err instanceof Error ? err.message : String(err));
    }
    setSyncing(false);
  }, [bid, syncing, loadLeads, loadStats]);

  const onLeadUpdated = useCallback(() => {
    void loadLeads(page, true);
    void loadStats();
  }, [loadLeads, loadStats, page]);

  const onEndReached = useCallback(() => {
    if (page < totalPages && !loading) {
      void loadLeads(page + 1, true);
    }
  }, [page, totalPages, loading, loadLeads]);

  const newBadgeCount = stats?.pending || 0;

  // --- Render ---

  if (businessLoading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={colors.statusBar as any} />
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <Shimmer key={i} width="100%" height={80} borderRadius={14} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  const listContent = (
    <View style={{ flex: 1 }}>
      {/* Stats bar */}
      {stats ? (
        <View style={[styles.statsBar, { borderBottomColor: colors.separator, paddingHorizontal: isDesktop ? 16 : 16 }]}>
          {[
            { label: 'סה"כ לידים', value: String(stats.total) },
            { label: "חדשים היום", value: String(stats.new_today), highlight: true },
            { label: "שיעור המרה", value: `${stats.conversion_rate}%` },
            { label: "ממתינים לטיפול", value: String(stats.pending), alert: stats.pending > 0 },
          ].map((item, idx) => (
            <React.Fragment key={item.label}>
              {idx > 0 && <View style={[styles.statsDivider, { backgroundColor: colors.separator }]} />}
              <View style={styles.statsItem}>
                <Text
                  style={[
                    styles.statsValue,
                    {
                      color: item.alert ? "#EF4444" : item.highlight ? "#4F6EF7" : colors.text,
                    },
                  ]}
                >
                  {item.value}
                </Text>
                <Text style={[styles.statsLabel, { color: colors.textMuted }]}>{item.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      ) : null}

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.separator, paddingHorizontal: isDesktop ? 16 : 16 }]}>
        <View style={styles.headerTop}>
          <View style={styles.headerTitleRow}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>לידים</Text>
            {newBadgeCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{newBadgeCount}</Text>
              </View>
            ) : null}
          </View>
          <Pressable onPress={onSync} disabled={syncing} style={styles.syncBtn}>
            {syncing ? (
              <ActivityIndicator size="small" color="#4F6EF7" />
            ) : (
              <Ionicons name="refresh" size={20} color="#4F6EF7" />
            )}
            {lastSync ? (
              <Text style={[styles.syncTime, { color: colors.textMuted }]}>
                {new Date(lastSync).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
              </Text>
            ) : null}
          </Pressable>
        </View>

        {/* Search */}
        <View style={[styles.searchBox, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder }]}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            value={search}
            onChangeText={onSearchChange}
            placeholder="חיפוש לפי שם, טלפון, מייל..."
            placeholderTextColor={colors.textMuted}
          />
        </View>

        {/* Filter tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTER_TABS.map((f) => {
            const active = statusFilter === f.key;
            const count =
              f.key === ""
                ? stats?.total || 0
                : stats?.by_status?.[f.key] || 0;
            return (
              <Pressable
                key={f.key}
                onPress={() => onFilterChange(f.key)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? "rgba(79,110,247,0.12)" : "transparent",
                    borderColor: active ? "#4F6EF7" : colors.cardBorder,
                  },
                ]}
              >
                <Text style={[styles.filterChipText, { color: active ? "#4F6EF7" : colors.textMuted }]}>
                  {f.label}
                </Text>
                {count > 0 ? (
                  <View style={[styles.filterBadge, { backgroundColor: active ? "#4F6EF7" : colors.pillBg }]}>
                    <Text style={[styles.filterBadgeText, { color: active ? "#FFF" : colors.textMuted }]}>{count}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Leads list */}
      {loading && leads.length === 0 ? (
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1, 2, 3].map((i) => (
            <Shimmer key={i} width="100%" height={90} borderRadius={14} />
          ))}
        </View>
      ) : leads.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={{ fontSize: 40 }}>{loadError ? "⚠️" : "📋"}</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {loadError ? "שגיאה בטעינת לידים" : "עדיין אין לידים"}
          </Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            {loadError || "סנכרן את הלידים מ-Facebook Lead Ads"}
          </Text>
          <Pressable style={styles.syncBtnLarge} onPress={onSync}>
            <Ionicons name="refresh" size={18} color="#FFF" />
            <Text style={styles.syncBtnLargeText}>סנכרן לידים</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={leads}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <LeadCard
              lead={item}
              onPress={() => setSelectedLeadId(item.id)}
              selected={selectedLeadId === item.id}
              colors={colors}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: isDesktop ? 16 : 14, paddingTop: 10, paddingBottom: tabBarHeight + 80 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4F6EF7" />}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.3}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </View>
  );

  // Desktop: split view
  if (isDesktop) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={colors.statusBar as any} />
        <View style={styles.desktopLayout}>
          <View style={[styles.desktopLeft, { borderLeftColor: colors.separator }]}>
            {listContent}
          </View>
          <View style={[styles.desktopRight, { backgroundColor: colors.bg }]}>
            {selectedLeadId && bid ? (
              <LeadDetail
                leadId={selectedLeadId}
                businessId={bid}
                colors={colors}
                isDesktop
                onLeadUpdated={onLeadUpdated}
              />
            ) : (
              <View style={styles.detailPlaceholder}>
                <Ionicons name="people-outline" size={48} color={colors.textMuted} />
                <Text style={[styles.detailPlaceholderText, { color: colors.textMuted }]}>
                  בחר ליד מהרשימה
                </Text>
              </View>
            )}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Mobile: list or detail
  if (selectedLeadId && bid) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={colors.statusBar as any} />
        <LeadDetail
          leadId={selectedLeadId}
          businessId={bid}
          colors={colors}
          isDesktop={false}
          onClose={() => setSelectedLeadId(null)}
          onLeadUpdated={onLeadUpdated}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={colors.statusBar as any} />
      {listContent}
    </SafeAreaView>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  safe: { flex: 1 },

  // Stats bar
  statsBar: {
    flexDirection: "row-reverse",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  statsItem: { flex: 1, alignItems: "center" },
  statsValue: { fontSize: 18, fontWeight: "800" },
  statsLabel: { fontSize: 10, fontWeight: "600", marginTop: 2, writingDirection: "rtl" },
  statsDivider: { width: 1, height: 28 },

  // Header
  header: { paddingTop: 14 },
  headerTop: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  headerTitleRow: { flexDirection: "row-reverse", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 20, fontWeight: "800", writingDirection: "rtl", textAlign: "right" },
  badge: {
    backgroundColor: "#EF4444",
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: { color: "#FFF", fontSize: 11, fontWeight: "800" },
  syncBtn: { flexDirection: "row-reverse", alignItems: "center", gap: 6 },
  syncTime: { fontSize: 11, fontWeight: "600" },

  // Search
  searchBox: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    writingDirection: "rtl",
    textAlign: "right",
    padding: 0,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as any } : {}),
  },

  // Filter tabs
  filterRow: { flexDirection: "row-reverse", gap: 6, paddingBottom: 12 },
  filterChip: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1,
  },
  filterChipText: { fontSize: 12, fontWeight: "700", writingDirection: "rtl" },
  filterBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  filterBadgeText: { fontSize: 10, fontWeight: "800" },

  // Lead card
  leadCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  leadCardTop: {
    flexDirection: "row-reverse",
    gap: 12,
  },
  leadThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  leadThumbPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  leadCardInfo: { flex: 1, gap: 2 },
  leadName: { fontSize: 15, fontWeight: "800", writingDirection: "rtl", textAlign: "right" },
  leadMeta: { flexDirection: "row-reverse", gap: 12 },
  leadMetaText: { fontSize: 12, fontWeight: "500", writingDirection: "rtl" },
  leadCampaign: { fontSize: 11, fontWeight: "600", writingDirection: "rtl", textAlign: "right", marginTop: 2 },
  leadCardBottom: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 10,
    marginTop: 10,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusChipText: { fontSize: 11, fontWeight: "800", writingDirection: "rtl" },
  timeAgo: { fontSize: 11, fontWeight: "600" },
  updatesBadge: { flexDirection: "row", alignItems: "center", gap: 3 },
  updatesBadgeText: { fontSize: 11, fontWeight: "600" },

  // Empty state
  emptyState: { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "800", writingDirection: "rtl" },
  emptyBody: { fontSize: 13, fontWeight: "600", writingDirection: "rtl", textAlign: "center", lineHeight: 20 },
  syncBtnLarge: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#4F6EF7",
  },
  syncBtnLargeText: { color: "#FFF", fontSize: 14, fontWeight: "800" },

  // Desktop layout
  desktopLayout: { flex: 1, flexDirection: "row-reverse" },
  desktopLeft: { width: 380, borderLeftWidth: 1 },
  desktopRight: { flex: 1 },

  // Detail
  detailContainer: { flex: 1 },
  detailContent: { padding: 16, paddingBottom: 100 },
  detailEmpty: { textAlign: "center", marginTop: 40, fontSize: 14 },
  detailHeader: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  backBtn: { padding: 4 },
  detailName: { fontSize: 22, fontWeight: "800", writingDirection: "rtl", textAlign: "right" },
  detailPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  detailPlaceholderText: { fontSize: 14, fontWeight: "600", writingDirection: "rtl" },

  // Quick actions
  quickActions: {
    flexDirection: "row-reverse",
    gap: 10,
    marginBottom: 16,
  },
  quickBtn: {
    flex: 1,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  quickBtnText: { fontSize: 13, fontWeight: "800", writingDirection: "rtl" },

  // Sections
  section: {
    borderTopWidth: 1,
    paddingTop: 14,
    marginTop: 14,
  },
  sectionTitle: { fontSize: 15, fontWeight: "800", writingDirection: "rtl", textAlign: "right", marginBottom: 10 },

  // Status selector
  statusRow: { flexDirection: "row-reverse", gap: 6, paddingBottom: 4 },
  statusOption: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusOptionText: { fontSize: 11, fontWeight: "700", writingDirection: "rtl" },

  // Fields
  fieldRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  fieldLabel: { fontSize: 12, fontWeight: "600", writingDirection: "rtl" },
  fieldValue: { fontSize: 13, fontWeight: "700", writingDirection: "rtl" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
    minWidth: 100,
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    fontWeight: "500",
    writingDirection: "rtl",
    textAlign: "right",
    minHeight: 80,
  },

  // Ad info
  adImage: { width: "100%", height: 180, borderRadius: 12, marginBottom: 8 },
  adBreadcrumb: { fontSize: 12, fontWeight: "600", writingDirection: "rtl", textAlign: "right" },
  formName: { fontSize: 12, fontWeight: "600", writingDirection: "rtl", textAlign: "right", marginTop: 4 },

  // Timeline
  addUpdateBar: { marginBottom: 14 },
  updateTypeTabs: { flexDirection: "row-reverse", gap: 6, marginBottom: 8 },
  updateTypeTab: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  addUpdateRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
  },
  updateInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    fontWeight: "500",
    writingDirection: "rtl",
    textAlign: "right",
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#4F6EF7",
    alignItems: "center",
    justifyContent: "center",
  },
  updateItem: {
    flexDirection: "row-reverse",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  updateIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(79,110,247,0.08)", alignItems: "center", justifyContent: "center" },
  updateContent: { fontSize: 13, fontWeight: "600", writingDirection: "rtl", textAlign: "right" },
  updateTime: { fontSize: 11, fontWeight: "500", marginTop: 2, writingDirection: "rtl", textAlign: "right" },
  emptyTimeline: { fontSize: 12, textAlign: "center", paddingVertical: 12, writingDirection: "rtl" },
});
