import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  FlatList,
  Image,
  Share,
  Alert,
  ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useBusiness } from "../../contexts/business-context";
import { useTheme } from "../../contexts/theme-context";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { fetchAdchatApi } from "../../lib/fetch-adchat-api";
import { supabase } from "../../lib/supabase";

type ChatRole = "agent" | "user";

type AgentKey = "dana" | "yoni" | "ron" | "maya" | "noa";
type IntentKey = AgentKey | "campaign";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: number;
  image_base64?: string;
  mime_type?: string;
  agent?: AgentKey;
  pending_actions?: PendingAction[];
};

const TYPING_PLACEHOLDER: ChatMessage = {
  id: "typing",
  role: "agent",
  text: "",
  createdAt: 0,
};

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";
const PROXY_ENDPOINT = `${API_BASE}/api/chat`;

type ClientMemoryPayload = {
  business_id: string;
  by_category: Record<string, Record<string, string>>;
};

type MemoryUpdate = { category: string; key: string; value: string };

type PendingAction = {
  type: string;
  label_he: string;
  params: Record<string, any>;
};

type ProxyReply = {
  text: string;
  memory_updates: MemoryUpdate[];
  image_base64?: string;
  mime_type?: string;
  suggested_replies?: string[];
  agent?: AgentKey;
  delegated_to?: AgentKey | null;
  pending_actions?: PendingAction[];
};

class ChatProxyError extends Error {
  readonly code: "overload" | "auth_expired" | "unknown";
  readonly status: number;

  constructor(message: string, code: "overload" | "auth_expired" | "unknown", status: number) {
    super(message);
    this.name = "ChatProxyError";
    this.code = code;
    this.status = status;
  }
}

type ChatSessionListItem = {
  id: string;
  title: string | null;
  agent: AgentKey | string | null;
  created_at: string;
  updated_at: string;
};

const INITIAL_GREETING: ChatMessage = {
  id: "m-1",
  role: "agent",
  text: "שלום! אני דנה 👋 מה תרצו לקדם היום?",
  createdAt: 0,
  agent: "dana",
};

const AGENT_AVATARS: Record<string, string> = {
  dana: "https://i.pravatar.cc/150?img=47",
  yoni: "https://i.pravatar.cc/150?img=33",
  ron: "https://i.pravatar.cc/150?img=12",
  maya: "https://i.pravatar.cc/150?img=45",
  noa: "https://i.pravatar.cc/150?img=44",
};

const AGENTS: Record<
  AgentKey,
  { name: string; role: string; emoji: string; color: string; avatar: string }
> = {
  dana: { name: "דנה", role: "מנהלת לקוח", emoji: "👩‍💼", color: "#4F6EF7", avatar: AGENT_AVATARS.dana },
  yoni: { name: "יוני", role: "קופירייטר", emoji: "✍️", color: "#7C3AED", avatar: AGENT_AVATARS.yoni },
  ron: { name: "רון", role: "אנליסט ביצועים", emoji: "📊", color: "#22C55E", avatar: AGENT_AVATARS.ron },
  maya: { name: "מאיה", role: "קריאייטיב", emoji: "🎨", color: "#F97316", avatar: AGENT_AVATARS.maya },
  noa: { name: "נועה", role: "אסטרטגיית תוכן", emoji: "📱", color: "#EC4899", avatar: AGENT_AVATARS.noa },
};

const INTENT_ROUTING = {
  graphic: [
    "תמונה",
    "גרפיקה",
    "עיצוב",
    "באנר",
    "פוסט",
    "image",
    "design",
    "creative",
  ],
  copy: ["טקסט", "כותרת", "קופי", "מודעה", "תיאור", "copy", "text", "ad"],
  analysis: ["נתח", "ביצועים", "ctr", "roi", "תוצאות", "דוח", "analyze"],
  content: ["פוסטים", "תוכן", "לוח", "אסטרטגיה", "content", "calendar"],
  campaign: ["קמפיין", "campaign", "פרסום", "advertise"],
} as const;

function detectIntent(message: string): IntentKey {
  const msg = String(message || "").toLowerCase();
  if (!msg.trim()) return "dana";
  if (INTENT_ROUTING.graphic.some((k) => msg.includes(k))) return "maya";
  if (INTENT_ROUTING.copy.some((k) => msg.includes(k))) return "yoni";
  if (INTENT_ROUTING.analysis.some((k) => msg.includes(k))) return "ron";
  if (INTENT_ROUTING.content.some((k) => msg.includes(k))) return "noa";
  if (INTENT_ROUTING.campaign.some((k) => msg.includes(k))) return "campaign";
  return "dana";
}

function resolveOptimisticAgent(message: string, fallback: AgentKey): AgentKey {
  const intent = detectIntent(message);
  if (intent === "campaign") return "dana";
  return intent || fallback;
}

function smartSuggestedRepliesFor(reply: ProxyReply): string[] {
  const a = resolveActiveAgent(reply);
  const hasImage = typeof reply.image_base64 === "string" && reply.image_base64.trim();
  if (a === "maya" || hasImage) {
    return ["עשה עוד גרסה", "שנה צבעים", "הוסף טקסט", "שמור בספרייה"];
  }
  if (a === "yoni") {
    return ["גרסה ארוכה יותר", "יותר רשמי", "יותר קליל", "הכן גרפיקה לזה"];
  }
  if (a === "ron") {
    return ["מה לשפר?", "השווה לחודש קודם", "הכן דוח", "הצע ניסוי A/B"];
  }
  return Array.isArray(reply.suggested_replies)
    ? reply.suggested_replies
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];
}

function resolveActiveAgent(reply: ProxyReply | null | undefined): AgentKey {
  const d = reply?.delegated_to;
  if (d && AGENTS[d]) return d;
  const a = reply?.agent;
  if (a && AGENTS[a]) return a;
  return "dana";
}

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ seedMessage?: string; sessionId?: string }>();
  const { business, loading: businessLoading } = useBusiness();
  const { colors, mode } = useTheme();
  const { isDesktop } = useResponsiveLayout();
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<{
    base64: string;
    mime_type: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [clientMemory, setClientMemory] = useState<ClientMemoryPayload | null>(
    null,
  );
  const [chatReady, setChatReady] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentKey>("dana");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionListItem[]>([]);
  const [overloadRetry, setOverloadRetry] = useState<{
    thread: ChatMessage[];
    optimisticAgent: AgentKey;
    opts: { errorIdSuffix: string };
  } | null>(null);

  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const seedProcessedRef = useRef<string | null>(null);
  const isTypingRef = useRef(false);
  const initChatForBusinessRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedFingerprintRef = useRef<string>("");

  messagesRef.current = messages;
  isTypingRef.current = isTyping;

  const seedFromParams = useMemo(() => {
    const raw = params.seedMessage;
    if (typeof raw === "string") return raw;
    if (Array.isArray(raw) && raw[0]) return raw[0];
    return undefined;
  }, [params.seedMessage]);

  const hasSeed = Boolean(seedFromParams);

  useLayoutEffect(() => {
    if (!hasSeed) return;
    setMessages((prev) =>
      prev.length === 0
        ? [{ ...INITIAL_GREETING, createdAt: Date.now() }]
        : prev,
    );
  }, [hasSeed]);

  useEffect(() => {
    if (businessLoading) return;
    if (!business) {
      router.replace("/onboarding");
    }
  }, [businessLoading, business, router]);

  const loadSessions = useCallback(async () => {
    if (!business?.id) return;
    setSessionsLoading(true);
    try {
      const res = await fetchAdchatApi(
        `${API_BASE}/api/chat-sessions?business_id=${encodeURIComponent(business.id)}`,
      );
      if (res.status === 401) { router.replace("/auth"); return; }
      const json = (await res.json().catch(() => ({}))) as {
        sessions?: ChatSessionListItem[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || "טעינת שיחות נכשלה");
      }
      setSessions(Array.isArray(json.sessions) ? json.sessions : []);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    if (businessLoading || !business) return;
    if (hasSeed) {
      setChatReady(true);
      return;
    }
    if (initChatForBusinessRef.current === business.id) {
      setIsTyping(false);
      setChatReady(true);
      return;
    }
    initChatForBusinessRef.current = business.id;
    setSessionId(null);

    let cancelled = false;
    void (async () => {
      setIsTyping(true);
      try {
        const mem = await fetchClientMemory(business.id, 3000);
        if (cancelled) return;
        setClientMemory(mem);
        const agentMessage: ChatMessage = {
          id: `m-open-${Date.now()}`,
          role: "agent",
          text: isOnboardingMemoryComplete(mem)
            ? `שלום ${business.name}! במה אפשר לעזור היום?`
            : getOnboardingOpeningMessage(mem),
          createdAt: Date.now(),
          agent: "dana",
        };
        setActiveAgent("dana");
        messagesRef.current = [agentMessage];
        setMessages([agentMessage]);
        setIsTyping(false);
      } catch (e) {
        if (e instanceof ChatProxyError && e.code === "auth_expired") {
          router.replace("/auth");
          return;
        }
        if (!cancelled) {
          const fallback: ChatMessage = {
            id: `m-open-err-${Date.now()}`,
            role: "agent",
            text:
              e instanceof Error
                ? `לא הצלחתי לטעון את דנה. ${e.message}`
                : "לא הצלחתי לטעון את דנה.",
            createdAt: Date.now(),
            agent: "dana",
          };
          setActiveAgent("dana");
          messagesRef.current = [fallback];
          setMessages([fallback]);
          setIsTyping(false);
        }
      } finally {
        setIsTyping(false);
        if (!cancelled) {
          setChatReady(true);
          requestAnimationFrame(() =>
            listRef.current?.scrollToEnd({ animated: true }),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [businessLoading, business, hasSeed]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const sendThread = useCallback(
    async (
      thread: ChatMessage[],
      optimisticAgent: AgentKey,
      opts: { errorIdSuffix: string },
    ) => {
      if (!business) return;
      setOverloadRetry(null);
      setSuggestions([]);
      setIsTyping(true);
      setActiveAgent(optimisticAgent);
      try {
        // Debounced session save (3s) + save only on real change
        const fingerprint = (msgs: ChatMessage[]) =>
          JSON.stringify(
            msgs.map((m) => ({
              r: m.role,
              t: String(m.text || "").slice(0, 160),
              a: m.agent || null,
              i: Boolean(m.image_base64),
            })),
          );

        const scheduleSave = async (messagesToStore: ChatMessage[], agentToStore: AgentKey) => {
          const fp = fingerprint(messagesToStore);
          if (fp === lastSavedFingerprintRef.current) return;
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => {
            void (async () => {
              if (!sessionId) return;
              try {
                await fetchAdchatApi(`${API_BASE}/api/chat-sessions/${sessionId}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    messages: messagesToStore,
                    agent: agentToStore,
                  }),
                });
                lastSavedFingerprintRef.current = fp;
              } catch {
                // ignore
              }
            })();
          }, 3000);
        };

        const ensureSession = async (messagesToStore: ChatMessage[]) => {
          if (sessionId) {
            await scheduleSave(messagesToStore, optimisticAgent);
            return sessionId;
          }
          const { data } = await supabase.auth.getSession();
          const uid = data.session?.user?.id ?? null;
          const created = await fetchAdchatApi(`${API_BASE}/api/chat-sessions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              business_id: business.id,
              user_id: uid,
              messages: messagesToStore,
              agent: optimisticAgent,
            }),
          });
          if (created.status === 401) { router.replace("/auth"); return ""; }
          const j = (await created.json().catch(() => ({}))) as {
            session?: { id?: string };
            error?: string;
          };
          if (!created.ok || !j.session?.id) {
            throw new Error(j.error || "יצירת שיחה נכשלה");
          }
          setSessionId(String(j.session.id));
          lastSavedFingerprintRef.current = fingerprint(messagesToStore);
          return String(j.session.id);
        };

        // שמירה אחרי הודעת משתמש (מיד, לפני ה-LLM)
        await ensureSession(thread);

        let mem = clientMemory;
        if (!mem) {
          mem = await fetchClientMemory(business.id, CLIENT_MEMORY_FETCH_MS);
          setClientMemory(mem);
        }

        const lastUserMsg = [...thread].reverse().find((m) => m.role === "user");
        const urlGuess = lastUserMsg?.text
          ? looksLikeWebsiteUrlForScrape(lastUserMsg.text)
          : null;
        if (
          urlGuess &&
          memVal(mem, "business_profile", "scrape_confirmed") !== "true" &&
          !isOnboardingMemoryComplete(mem)
        ) {
          try {
            const sr = await fetchAdchatApi(`${API_BASE}/api/scrape-website`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                url: urlGuess,
                business_id: business.id,
              }),
            });
            if (sr.ok) {
              mem = await fetchClientMemory(business.id, CLIENT_MEMORY_FETCH_MS);
              setClientMemory(mem);
            }
          } catch {
            // ignore — ממשיכים לפרוקסי
          }
        }

        const reply = await callProxyChat({
          messages: thread,
          businessId: business.id,
          businessName: business.name,
          businessIndustry: business.industry,
          client_memory_empty: !isOnboardingMemoryComplete(mem),
          meta_connected: isMetaConnected(business),
        });
        await persistMemoryUpdates(business.id, reply.memory_updates);
        setClientMemory((prev) =>
          applyMemoryUpdatesLocal(prev, business.id, reply.memory_updates),
        );
        const resolved = resolveActiveAgent(reply);
        setActiveAgent(resolved);
        const agentMessage: ChatMessage = {
          id: `m-${Date.now()}-a`,
          role: "agent",
          text: reply.text,
          createdAt: Date.now(),
          agent: resolved,
          ...(reply.pending_actions?.length ? { pending_actions: reply.pending_actions } : {}),
          ...(reply.image_base64 && String(reply.image_base64).trim() !== ""
            ? {
                image_base64: reply.image_base64,
                mime_type: reply.mime_type?.trim() || "image/png",
              }
            : {}),
        };
        setMessages((prev) => {
          const next = [...prev, agentMessage];
          messagesRef.current = next;
          return next;
        });
        // שמירה אחרי הודעת סוכן
        try {
          const sid = sessionId || null;
          const idToUse = sid || (await ensureSession([...thread, agentMessage]));
          setSessionId(idToUse);
          await scheduleSave([...thread, agentMessage], resolved);
        } catch {
          // לא מפילים UX בגלל שמירה
        }
        setSuggestions(smartSuggestedRepliesFor(reply));
      } catch (e) {
        if (e instanceof ChatProxyError && e.code === "auth_expired") {
          router.replace("/auth");
          return;
        }
        if (e instanceof ChatProxyError && e.code === "overload") {
          setOverloadRetry({
            thread,
            optimisticAgent,
            opts,
          });
          setSuggestions([]);
        } else {
          const errorText =
            e instanceof Error ? e.message : "שגיאה לא צפויה בעת פנייה לשרת.";
          setSuggestions([]);
          setMessages((prev) => {
            const errMsg: ChatMessage = {
              id: `m-${Date.now()}${opts.errorIdSuffix}`,
              role: "agent",
              text: `לא הצלחתי להביא תשובה עכשיו. ${errorText}`,
              createdAt: Date.now(),
              agent: "dana",
            };
            const next = [...prev, errMsg];
            messagesRef.current = next;
            return next;
          });
        }
      } finally {
        setIsTyping(false);
        requestAnimationFrame(() =>
          listRef.current?.scrollToEnd({ animated: true }),
        );
      }
    },
    [business, clientMemory, sessionId],
  );

  useEffect(() => {
    const seed = seedFromParams;
    if (!seed) {
      seedProcessedRef.current = null;
      return;
    }
    if (businessLoading || !business || isTypingRef.current) return;
    if (seedProcessedRef.current === seed) return;
    seedProcessedRef.current = seed;

    const base: ChatMessage[] = [
      { ...INITIAL_GREETING, createdAt: Date.now() },
    ];
    const userMessage: ChatMessage = {
      id: `m-seed-${Date.now()}`,
      role: "user",
      text: seed,
      createdAt: Date.now(),
    };
    const thread = [...base, userMessage];
    messagesRef.current = thread;
    setMessages(thread);
    setInput("");
    requestAnimationFrame(() =>
      listRef.current?.scrollToEnd({ animated: true }),
    );

    const optimistic: AgentKey = resolveOptimisticAgent(seed, "dana");
    void sendThread(thread, optimistic, { errorIdSuffix: "-seed-err" });
  }, [seedFromParams, business, businessLoading, sendThread]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    const img = pendingImage;
    if ((!trimmed && !img) || isTyping || !business || !chatReady) return;

    setSuggestions([]);

    const userMessage: ChatMessage = {
      id: `m-${Date.now()}`,
      role: "user",
      text: trimmed,
      createdAt: Date.now(),
      ...(img ? { image_base64: img.base64, mime_type: img.mime_type } : {}),
    };

    const nextThread = [...messagesRef.current, userMessage];
    messagesRef.current = nextThread;
    setMessages(nextThread);
    setInput("");
    setPendingImage(null);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));

    if (Platform.OS !== "web") {
      void Haptics.selectionAsync();
    }

    const optimistic: AgentKey = resolveOptimisticAgent(trimmed, activeAgent);
    void sendThread(nextThread, optimistic, { errorIdSuffix: "-err" });
  };

  const toggleVoice = useCallback(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    if (isRecording && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.lang = "he-IL";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    let finalText = "";

    recognition.onresult = (e: any) => {
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalText += transcript;
        } else {
          interim += transcript;
        }
      }
      setInput((prev) => {
        const base = prev.trimEnd();
        const before = base && !finalText ? base + " " : "";
        return before + finalText + interim;
      });
    };

    recognition.onerror = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [isRecording]);

  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const SR =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      setSpeechSupported(Boolean(SR));
    }
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* */ }
      }
    };
  }, []);

  const loadSessionById = useCallback(
    async (id: string) => {
      setSessionsLoading(true);
      try {
        const res = await fetchAdchatApi(`${API_BASE}/api/chat-sessions/${id}`);
        if (res.status === 401) { router.replace("/auth"); return; }
        const json = (await res.json().catch(() => ({}))) as {
          session?: { id: string; messages?: unknown; agent?: unknown };
          error?: string;
        };
        if (!res.ok || !json.session) {
          throw new Error(json.error || "טעינת שיחה נכשלה");
        }
        const rawMsgs = json.session.messages;
        const arr = Array.isArray(rawMsgs) ? rawMsgs : [];
        const parsed: ChatMessage[] = arr
          .filter((m) => m && typeof m === "object")
          .map((m: any) => ({
            id: typeof m.id === "string" ? m.id : `m-${Date.now()}`,
            role: m.role === "user" ? "user" : "agent",
            text: typeof m.text === "string" ? m.text : "",
            createdAt:
              typeof m.createdAt === "number" && Number.isFinite(m.createdAt)
                ? m.createdAt
                : Date.now(),
            ...(typeof m.image_base64 === "string" && m.image_base64.trim()
              ? { image_base64: m.image_base64.trim() }
              : {}),
            ...(typeof m.mime_type === "string" && m.mime_type.trim()
              ? { mime_type: m.mime_type.trim() }
              : {}),
            ...(typeof m.agent === "string" &&
            (m.agent as AgentKey) &&
            AGENTS[m.agent as AgentKey]
              ? { agent: m.agent as AgentKey }
              : {}),
          }));
        setSessionId(json.session.id);
        messagesRef.current = parsed.length
          ? parsed
          : [{ ...INITIAL_GREETING, createdAt: Date.now() }];
        setMessages(messagesRef.current);
        const a =
          typeof json.session.agent === "string" &&
          AGENTS[json.session.agent as AgentKey]
            ? (json.session.agent as AgentKey)
            : "dana";
        setActiveAgent(a);
        setSessionsOpen(false);
        requestAnimationFrame(() =>
          listRef.current?.scrollToEnd({ animated: true }),
        );
      } finally {
        setSessionsLoading(false);
      }
    },
    [],
  );

  // On desktop, load sessions immediately since the panel is always visible
  useEffect(() => {
    if (isDesktop && business?.id) {
      void loadSessions();
    }
  }, [isDesktop, business?.id, loadSessions]);

  useEffect(() => {
    const raw = params.sessionId;
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id) return;
    if (!business?.id) return;
    void loadSessionById(id);
  }, [params.sessionId, business?.id, loadSessionById]);

  if (businessLoading || !business) {
    return (
      <SafeAreaView style={[styles.safeArea, styles.centerBoot, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={colors.statusBar as any} />
        <Text style={[styles.bootHint, { color: colors.textMuted }]}>טוען…</Text>
      </SafeAreaView>
    );
  }

  if (!chatReady && !hasSeed) {
    return (
      <SafeAreaView style={[styles.safeArea, styles.centerBoot, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={colors.statusBar as any} />
        <Text style={[styles.bootHint, { color: colors.textMuted }]}>מכינים את דנה…</Text>
      </SafeAreaView>
    );
  }

  const agent = AGENTS[activeAgent];

  const onNewChat = () => {
    if (!business) return;
    seedProcessedRef.current = null;
    setOverloadRetry(null);
    setSuggestions([]);
    setInput("");
    const opener: ChatMessage = {
      id: `m-open-${Date.now()}`,
      role: "agent",
      agent: "dana",
      text:
        clientMemory && isOnboardingMemoryComplete(clientMemory)
          ? `שלום ${business.name}! במה אפשר לעזור היום?`
          : clientMemory
            ? getOnboardingOpeningMessage(clientMemory)
            : INITIAL_GREETING.text,
      createdAt: Date.now(),
    };
    setActiveAgent("dana");
    setSessionId(null);
    messagesRef.current = [opener];
    setMessages([opener]);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  const openSessions = () => {
    setSessionsOpen(true);
    void loadSessions();
  };

  // --- Sessions list content (shared between desktop panel and mobile modal) ---
  const sessionsListContent = (
    <>
      {sessionsLoading ? (
        <Text style={[styles.modalHint, { color: colors.textMuted }]}>טוען…</Text>
      ) : sessions.length === 0 ? (
        <Text style={[styles.modalHint, { color: colors.textMuted }]}>אין שיחות שמורות עדיין.</Text>
      ) : (
        <ScrollView
          style={isDesktop ? styles.desktopSessionsList : styles.modalList}
          contentContainerStyle={{ paddingBottom: 6 }}
        >
          {sessions.slice(0, 10).map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[styles.sessionRow, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}
              onPress={() => void loadSessionById(s.id)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={s.title || "שיחה"}
            >
              <View style={styles.sessionRowTop}>
                <Text style={[styles.sessionTitle, { color: colors.text }]} numberOfLines={1}>
                  {s.title || "שיחה"}
                </Text>
                <Text style={[styles.sessionDate, { color: colors.textMuted }]}>
                  {formatIsoDateTime(s.updated_at)}
                </Text>
              </View>
              <Text style={[styles.sessionMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                {agentLabelFromAny(s.agent)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </>
  );

  // --- Main chat area (header + messages + composer) ---
  const chatArea = (
    <View style={[styles.container, isDesktop && styles.desktopCenterPanel]} accessibilityLanguage="he">
      <View style={[styles.header, { borderBottomColor: colors.separator, backgroundColor: colors.cardBg }]}>
        {!isDesktop ? (
          <TouchableOpacity
            onPress={openSessions}
            accessibilityRole="button"
            accessibilityLabel="שיחות קודמות"
            style={[styles.newChatBtn, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder }]}
            activeOpacity={0.85}
          >
            <Text style={[styles.newChatBtnText, { color: colors.text }]}>שיחות קודמות</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={onNewChat}
            accessibilityRole="button"
            accessibilityLabel="שיחה חדשה"
            style={[styles.newChatBtn, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder }]}
            activeOpacity={0.85}
          >
            <Text style={[styles.newChatBtnText, { color: colors.text }]}>+ שיחה חדשה</Text>
          </TouchableOpacity>
        )}

        <View style={styles.headerCenter}>
          <Image
            source={{ uri: agent.avatar }}
            style={[styles.headerAvatar, { borderColor: agent.color, borderWidth: 2 }]}
            accessibilityLabel={`סוכן פעיל: ${agent.name}`}
          />
          <View style={styles.headerTitleWrap}>
            <Text style={[styles.headerTitle, { color: colors.text }]} accessibilityRole="header">
              {agent.name}
            </Text>
            <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>{agent.role}</Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => router.push("/")}
          accessibilityRole="button"
          accessibilityLabel="חזרה לבית"
          style={[styles.backButton, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder }]}
          activeOpacity={0.8}
        >
          <Text style={[styles.backIcon, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
      </View>

      <View style={isDesktop ? styles.desktopMessagesWrap : styles.mobileMessagesWrap}>
        <FlatList
          ref={(r) => {
            listRef.current = r;
          }}
          data={isTyping ? [...messages, TYPING_PLACEHOLDER] : messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <ChatBubble
              role={item.role}
              text={item.text}
              createdAt={item.createdAt}
              agent={item.agent}
              isTyping={item.id === TYPING_PLACEHOLDER.id}
              typingAgent={activeAgent}
              router={router}
              image_base64={item.image_base64}
              mime_type={item.mime_type}
              colors={colors}
              pending_actions={item.pending_actions}
              businessId={business?.id || ""}
              onActionResult={(ok, msg) => {
                const resultMsg: ChatMessage = {
                  id: `m-${Date.now()}-action`,
                  role: "agent",
                  text: ok ? `✅ ${msg}` : `❌ ${msg}`,
                  createdAt: Date.now(),
                  agent: activeAgent,
                };
                setMessages((prev) => [...prev, resultMsg]);
              }}
            />
          )}
          contentContainerStyle={[styles.messagesContent, isDesktop && styles.desktopMessagesContent]}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: true })
          }
        />
      </View>

      <View style={[styles.composer, { backgroundColor: colors.bgSecondary, borderTopColor: colors.separator }, isDesktop && styles.desktopComposer]}>
        {overloadRetry ? (
          <View style={styles.overloadBanner}>
            <Text style={[styles.overloadBannerText, { color: colors.text }]}>
              השרת עמוס כרגע, נסה שוב עוד כמה שניות...
            </Text>
            <TouchableOpacity
              style={styles.overloadRetryBtn}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="נסה שוב"
              onPress={() => {
                const payload = overloadRetry;
                if (!payload) return;
                setOverloadRetry(null);
                void sendThread(
                  payload.thread,
                  payload.optimisticAgent,
                  payload.opts,
                );
              }}
            >
              <Text style={styles.overloadRetryBtnText}>נסה שוב</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {suggestions.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.suggestionScrollContent}
            style={styles.suggestionScroll}
          >
            {suggestions.map((label) => (
              <TouchableOpacity
                key={label}
                style={[styles.suggestionChip, { backgroundColor: colors.pillBg, borderColor: colors.pillBorder }]}
                activeOpacity={0.85}
                onPress={() => send(label)}
                accessibilityRole="button"
                accessibilityLabel={label}
              >
                <Text style={[styles.suggestionChipText, { color: colors.text }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {pendingImage ? (
          <View style={styles.previewRow}>
            <Image
              source={{
                uri: `data:${pendingImage.mime_type};base64,${pendingImage.base64}`,
              }}
              style={[styles.previewThumb, { borderColor: colors.cardBorder }]}
              resizeMode="cover"
            />
            <TouchableOpacity
              onPress={() => setPendingImage(null)}
              style={styles.previewRemove}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="הסר תמונה"
            >
              <Text style={styles.previewRemoveText}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.inputRow}>
          <TouchableOpacity
            style={[styles.sendCircle, isTyping && styles.sendCircleDisabled]}
            activeOpacity={0.9}
            onPress={() => send(input)}
            accessibilityRole="button"
            accessibilityLabel="שלח"
            disabled={isTyping}
          >
            <Text style={styles.sendArrow}>➤</Text>
          </TouchableOpacity>

          {speechSupported ? (
            <TouchableOpacity
              style={[styles.micBtn, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }, isRecording && styles.micBtnRecording]}
              activeOpacity={0.85}
              onPress={toggleVoice}
              accessibilityRole="button"
              accessibilityLabel={isRecording ? "עצור הקלטה" : "הקלט קול"}
            >
              <Text style={styles.micIcon}>{isRecording ? "⏹" : "🎤"}</Text>
            </TouchableOpacity>
          ) : null}

          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="כתוב הודעה..."
            placeholderTextColor={colors.textMuted}
            style={[styles.textInput, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
            textAlign="right"
            multiline
            accessibilityLabel="שורת כתיבה"
          />

          <TouchableOpacity
            style={[styles.attachBtn, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="צרף תמונה"
            onPress={() => {
              if (Platform.OS === "web" && fileInputRef.current) {
                fileInputRef.current.click();
              }
            }}
          >
            <Text style={styles.attachIcon}>📎</Text>
          </TouchableOpacity>

          {Platform.OS === "web" ? (
            (() => {
              const HiddenInput: any = "input";
              return (
                <HiddenInput
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{
                    position: "absolute",
                    width: 0,
                    height: 0,
                    opacity: 0,
                    pointerEvents: "none",
                  }}
                  onChange={(e: any) => {
                    const file = e.target?.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = reader.result as string;
                      const base64 = result.split(",")[1] || "";
                      const mime = file.type || "image/jpeg";
                      setPendingImage({ base64, mime_type: mime });
                    };
                    reader.readAsDataURL(file);
                    e.target.value = "";
                  }}
                />
              );
            })()
          ) : null}
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={colors.statusBar as any} />

      <LinearGradient colors={[colors.bg, colors.bgSecondary]} style={styles.gradient}>
        <KeyboardAvoidingView
          style={styles.kav}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
        >
          {isDesktop ? (
            <View style={styles.desktopLayout}>
              {/* Right panel - Sessions */}
              <View style={[styles.desktopRightPanel, { backgroundColor: colors.cardBg, borderLeftWidth: 1, borderLeftColor: colors.cardBorder }]}>
                <View style={[styles.desktopPanelHeader, { borderBottomColor: colors.separator }]}>
                  <Text style={[styles.desktopPanelTitle, { color: colors.text }]}>שיחות קודמות</Text>
                  <TouchableOpacity
                    onPress={onNewChat}
                    style={styles.modalPlus}
                    accessibilityRole="button"
                    accessibilityLabel="שיחה חדשה"
                    activeOpacity={0.85}
                  >
                    <Text style={styles.modalPlusText}>+</Text>
                  </TouchableOpacity>
                </View>
                {sessionsListContent}
              </View>

              {/* Center panel - Chat */}
              {chatArea}

              {/* Left panel - Agent info */}
              <View style={[styles.desktopLeftPanel, { backgroundColor: colors.cardBg, borderRightWidth: 1, borderRightColor: colors.cardBorder }]}>
                <View style={[styles.desktopPanelHeader, { borderBottomColor: colors.separator }]}>
                  <Text style={[styles.desktopPanelTitle, { color: colors.text }]}>צוות הסוכנים</Text>
                </View>

                {/* Current active agent highlight */}
                <View style={[styles.desktopActiveAgent, { borderColor: agent.color }]}>
                  <Image source={{ uri: agent.avatar }} style={[styles.desktopAgentAvatar, { borderColor: agent.color, borderWidth: 2 }]} />
                  <Text style={[styles.desktopAgentName, { color: colors.text }]}>{agent.name}</Text>
                  <Text style={[styles.desktopAgentRole, { color: colors.textMuted }]}>{agent.role}</Text>
                  <View style={[styles.desktopActiveIndicator, { backgroundColor: agent.color }]}>
                    <Text style={styles.desktopActiveIndicatorText}>פעיל/ה</Text>
                  </View>
                </View>

                <View style={[styles.desktopAgentDivider, { backgroundColor: colors.separator }]} />

                {/* All agents list */}
                <ScrollView style={styles.desktopAgentsList} contentContainerStyle={{ paddingBottom: 12 }}>
                  {(Object.keys(AGENTS) as AgentKey[]).map((key) => {
                    const ag = AGENTS[key];
                    const isActive = key === activeAgent;
                    return (
                      <View
                        key={key}
                        style={[
                          styles.desktopAgentItem,
                          { borderColor: isActive ? ag.color : colors.cardBorder },
                          isActive && { backgroundColor: `${ag.color}15` },
                        ]}
                      >
                        <Image source={{ uri: ag.avatar }} style={[styles.desktopAgentItemAvatar, { borderColor: ag.color, borderWidth: 1.5 }]} />
                        <View style={styles.desktopAgentItemText}>
                          <Text style={[styles.desktopAgentItemName, { color: colors.text }]}>{ag.name}</Text>
                          <Text style={[styles.desktopAgentItemRole, { color: colors.textMuted }]}>{ag.role}</Text>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          ) : (
            chatArea
          )}
        </KeyboardAvoidingView>
      </LinearGradient>

      {/* Sessions modal - mobile only */}
      {!isDesktop ? (
        <Modal
          visible={sessionsOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setSessionsOpen(false)}
        >
          <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
            <View style={[styles.modalCard, { backgroundColor: colors.bgSecondary, borderColor: colors.cardBorder }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>שיחות קודמות</Text>
                <TouchableOpacity
                  onPress={() => {
                    onNewChat();
                    setSessionsOpen(false);
                  }}
                  style={styles.modalPlus}
                  accessibilityRole="button"
                  accessibilityLabel="שיחה חדשה"
                  activeOpacity={0.85}
                >
                  <Text style={styles.modalPlusText}>+</Text>
                </TouchableOpacity>
              </View>

              {sessionsListContent}

              <TouchableOpacity
                onPress={() => setSessionsOpen(false)}
                style={[styles.modalClose, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder }]}
                accessibilityRole="button"
                accessibilityLabel="סגור"
                activeOpacity={0.85}
              >
                <Text style={[styles.modalCloseText, { color: colors.text }]}>סגור</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const SETTINGS_LINK_MARKER = "[[פתח_הגדרות]]";

function ActionCard({
  action, businessId, colors, onResult,
}: {
  action: PendingAction;
  businessId: string;
  colors: any;
  onResult: (ok: boolean, msg: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<null | "ok" | "cancel">(null);

  if (done === "ok") {
    return (
      <View style={[actionCardStyles.card, { backgroundColor: "rgba(34,197,94,0.08)", borderColor: "rgba(34,197,94,0.3)" }]}>
        <Text style={[actionCardStyles.doneText, { color: "#22C55E" }]}>✅ {action.label_he} — בוצע</Text>
      </View>
    );
  }
  if (done === "cancel") {
    return (
      <View style={[actionCardStyles.card, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder }]}>
        <Text style={[actionCardStyles.doneText, { color: colors.textMuted }]}>הפעולה בוטלה</Text>
      </View>
    );
  }

  return (
    <View style={[actionCardStyles.card, { backgroundColor: colors.cardBg, borderColor: "#4F6EF7", borderRightWidth: 3 }]}>
      <Text style={[actionCardStyles.title, { color: colors.text }]}>⚡ {action.label_he}</Text>
      {action.params?.campaign_name ? (
        <Text style={[actionCardStyles.detail, { color: colors.textMuted }]}>קמפיין: {action.params.campaign_name}</Text>
      ) : null}
      {action.params?.daily_budget_ils ? (
        <Text style={[actionCardStyles.detail, { color: colors.textMuted }]}>תקציב: ₪{action.params.daily_budget_ils}/יום</Text>
      ) : null}
      <View style={actionCardStyles.btns}>
        <TouchableOpacity
          style={actionCardStyles.confirmBtn}
          disabled={busy}
          activeOpacity={0.85}
          onPress={async () => {
            setBusy(true);
            try {
              const res = await fetchAdchatApi(`${API_BASE}/api/meta-execute-action`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ business_id: businessId, action }),
              });
              if (res.status === 401) { router.replace("/auth"); return; }
              const json = await res.json().catch(() => ({}));
              if (res.ok && json.ok) {
                setDone("ok");
                onResult(true, json.message || action.label_he);
              } else {
                setBusy(false);
                onResult(false, json.error || "הפעולה נכשלה");
              }
            } catch {
              setBusy(false);
              onResult(false, "שגיאת רשת");
            }
          }}
        >
          {busy ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={actionCardStyles.confirmText}>✅ אשר ובצע</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          style={[actionCardStyles.cancelBtn, { borderColor: colors.cardBorder }]}
          disabled={busy}
          activeOpacity={0.85}
          onPress={() => setDone("cancel")}
        >
          <Text style={[actionCardStyles.cancelText, { color: colors.textMuted }]}>❌ ביטול</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const actionCardStyles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 8 },
  title: { fontSize: 14, fontWeight: "800", writingDirection: "rtl", textAlign: "right" },
  detail: { fontSize: 12, fontWeight: "600", writingDirection: "rtl", textAlign: "right", marginTop: 4 },
  doneText: { fontSize: 13, fontWeight: "700", writingDirection: "rtl", textAlign: "center" },
  btns: { flexDirection: "row-reverse", gap: 8, marginTop: 10 },
  confirmBtn: { flex: 1, height: 36, borderRadius: 10, backgroundColor: "#4F6EF7", alignItems: "center", justifyContent: "center" },
  confirmText: { color: "#FFF", fontSize: 13, fontWeight: "800" },
  cancelBtn: { flex: 1, height: 36, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 13, fontWeight: "700" },
});

function ChatBubble({
  role,
  text,
  createdAt,
  isTyping,
  typingAgent,
  router,
  image_base64,
  mime_type,
  agent,
  colors,
  pending_actions,
  businessId,
  onActionResult,
}: {
  role: ChatRole;
  text: string;
  createdAt: number;
  isTyping?: boolean;
  typingAgent: AgentKey;
  router: ReturnType<typeof useRouter>;
  image_base64?: string;
  mime_type?: string;
  agent?: AgentKey;
  colors: ReturnType<typeof useTheme>["colors"];
  pending_actions?: PendingAction[];
  businessId?: string;
  onActionResult?: (ok: boolean, msg: string) => void;
}) {
  const isAgentMsg = role === "agent";
  const aKey: AgentKey = agent && AGENTS[agent] ? agent : "dana";
  const a = AGENTS[aKey];
  const hasImage =
    typeof image_base64 === "string" && image_base64.trim().length > 0;
  const resolvedMime = (mime_type || "image/png").trim() || "image/png";
  const dataUri = hasImage
    ? `data:${resolvedMime};base64,${image_base64!.trim()}`
    : null;
  const selectedImage = hasImage
    ? { mime_type: resolvedMime, image_base64: image_base64!.trim() }
    : null;

  const [imageOpen, setImageOpen] = useState(false);
  const imgScale = useRef(new Animated.Value(1)).current;

  const timeText = formatTime(createdAt);
  return (
    <View
      style={[
        styles.bubbleRow,
        isAgentMsg ? styles.bubbleRowAgent : styles.bubbleRowUser,
      ]}
    >
      {isAgentMsg ? (
        <View style={styles.agentRowLeft}>
          <View style={[styles.msgAvatar, { borderColor: a.color, borderWidth: 2 }]}>
            <Image source={{ uri: a.avatar || AGENT_AVATARS[aKey] || AGENT_AVATARS.dana }} style={styles.msgAvatarImg} />
          </View>
          <View style={styles.msgCol}>
            <View style={[styles.bubble, styles.bubbleAgent, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
              {isTyping ? (
                <TypingIndicator agentKey={typingAgent} colors={colors} />
              ) : (
                <View style={styles.agentBubbleContent}>
                  {String(text || "").trim().length > 0 ? (
                    <AgentBubbleText text={text} router={router} colors={colors} />
                  ) : null}
                  {Array.isArray(pending_actions) && pending_actions.length > 0 && businessId ? (
                    <View style={{ gap: 6 }}>
                      {pending_actions.map((pa, idx) => (
                        <ActionCard
                          key={`${pa.type}-${idx}`}
                          action={pa}
                          businessId={businessId}
                          colors={colors}
                          onResult={onActionResult || (() => {})}
                        />
                      ))}
                    </View>
                  ) : null}
                  {dataUri && hasImage ? (
                    <>
                      <Pressable
                        onPress={() => setImageOpen(true)}
                        onPressIn={() => {
                          Animated.spring(imgScale, {
                            toValue: 0.98,
                            useNativeDriver: true,
                            speed: 30,
                            bounciness: 0,
                          }).start();
                        }}
                        onPressOut={() => {
                          Animated.spring(imgScale, {
                            toValue: 1,
                            useNativeDriver: true,
                            speed: 30,
                            bounciness: 0,
                          }).start();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="פתח תמונה"
                        style={{ marginTop: 8 }}
                      >
                        <Animated.View style={{ transform: [{ scale: imgScale }] }}>
                          <Image
                            source={{ uri: dataUri }}
                            style={{ width: 240, height: 240, borderRadius: 12, marginTop: 8 }}
                            resizeMode="cover"
                            accessibilityLabel="תמונה מהסוכן"
                          />
                        </Animated.View>
                      </Pressable>

                      <Modal
                        visible={imageOpen}
                        transparent
                        animationType="fade"
                        onRequestClose={() => setImageOpen(false)}
                      >
                        <View style={styles.imageModalBackdrop}>
                          <TouchableOpacity
                            onPress={() => setImageOpen(false)}
                            style={[styles.imageModalClose, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder }]}
                            accessibilityRole="button"
                            accessibilityLabel="סגור"
                            activeOpacity={0.85}
                          >
                            <Text style={[styles.imageModalCloseText, { color: colors.text }]}>✕</Text>
                          </TouchableOpacity>

                          <View style={styles.imageModalCenter}>
                            {Platform.OS === "web" ? (
                              // react-native-web: data URI גדולים נטענים יותר יציב עם img
                              (() => {
                                const WebImg: any = "img";
                                return (
                                  <WebImg
                                    src={`data:${selectedImage?.mime_type || "image/png"};base64,${selectedImage?.image_base64 || ""}`}
                                    style={{
                                      maxWidth: "90%",
                                      maxHeight: "80%",
                                      objectFit: "contain",
                                      borderRadius: 12,
                                    }}
                                  />
                                );
                              })()
                            ) : (
                              <Image
                                source={{
                                  uri: `data:${selectedImage?.mime_type || "image/png"};base64,${selectedImage?.image_base64 || ""}`,
                                }}
                                style={{ width: "90%", height: "80%" }}
                                resizeMode="contain"
                                accessibilityLabel="תמונה במסך מלא"
                              />
                            )}
                          </View>

                          <View style={styles.imageModalBottom}>
                            <SaveImageButton
                              image_base64={selectedImage?.image_base64 || ""}
                              mime_type={selectedImage?.mime_type || "image/png"}
                              label="⬇️ הורד"
                            />
                          </View>
                        </View>
                      </Modal>
                    </>
                  ) : null}
                </View>
              )}
            </View>
            {!isTyping ? <Text style={[styles.timeTextLeft, { color: colors.textMuted }]}>{timeText}</Text> : null}
          </View>
        </View>
      ) : (
        <View style={styles.msgCol}>
          <View style={[styles.bubble, styles.bubbleUser]}>
            {hasImage && dataUri ? (
              <Image
                source={{ uri: dataUri }}
                style={styles.userBubbleImage}
                resizeMode="cover"
                accessibilityLabel="תמונה שנשלחה"
              />
            ) : null}
            {String(text || "").trim() ? (
              <Text style={styles.bubbleTextUser}>{text}</Text>
            ) : null}
          </View>
          <Text style={[styles.timeTextRight, { color: colors.textMuted }]}>{timeText}</Text>
        </View>
      )}
    </View>
  );
}

function AgentBubbleText({
  text,
  router,
  colors,
}: {
  text: string;
  router: ReturnType<typeof useRouter>;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const idx = text.indexOf(SETTINGS_LINK_MARKER);
  if (idx === -1) {
    return <Text style={[styles.bubbleText, { color: colors.text }]}>{text}</Text>;
  }
  const before = text.slice(0, idx).trimEnd();
  const after = text.slice(idx + SETTINGS_LINK_MARKER.length).trimStart();
  return (
    <Text style={[styles.bubbleText, { color: colors.text }]}>
      {before ? `${before}\n\n` : ""}
      <Text
        style={styles.inlineSettingsLink}
        onPress={() => router.push("/(tabs)/settings")}
        accessibilityRole="link"
        accessibilityLabel="פתיחת הגדרות לחיבור חשבון פרסום"
      >
        פתח את מסך ההגדרות לחיבור חשבון
      </Text>
      {after ? `\n\n${after}` : ""}
    </Text>
  );
}

function TypingIndicator({ agentKey, colors }: { agentKey: AgentKey; colors: ReturnType<typeof useTheme>["colors"] }) {
  const agent = AGENTS[agentKey] || AGENTS.dana;
  const [active, setActive] = useState(0);
  const op1 = useRef(new Animated.Value(0.35)).current;
  const op2 = useRef(new Animated.Value(0.35)).current;
  const op3 = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const ops = [op1, op2, op3];
    const set = (idx: number) => {
      ops.forEach((v, i) => {
        Animated.timing(v, {
          toValue: i === idx ? 1 : 0.35,
          duration: 220,
          useNativeDriver: true,
        }).start();
      });
    };
    set(active);
  }, [active, op1, op2, op3]);

  useEffect(() => {
    const t = setInterval(() => {
      setActive((x) => (x + 1) % 3);
    }, 320);
    return () => clearInterval(t);
  }, []);

  return (
    <View style={styles.typingWrap} accessibilityLabel={`${agent.name} מקלידה`}>
      <Text style={[styles.typingLabel, { color: colors.textSecondary }]}>
        {agentKey === "maya"
          ? "🎨 מאיה מציירת..."
          : agentKey === "yoni"
            ? "✍️ יוני כותב..."
            : agentKey === "ron"
              ? "📊 רון מנתח..."
              : agentKey === "noa"
                ? "📱 נועה בונה לוח..."
                : "דנה עובדת..."}
      </Text>
      <View style={styles.typingDotsRow}>
        <Animated.Text style={[styles.dot, { color: agent.color, opacity: op1 }]}>
          •
        </Animated.Text>
        <Animated.Text style={[styles.dot, { color: agent.color, opacity: op2 }]}>
          •
        </Animated.Text>
        <Animated.Text style={[styles.dot, { color: agent.color, opacity: op3 }]}>
          •
        </Animated.Text>
      </View>
    </View>
  );
}

function isLikelyMayaImageRequest(message: string): boolean {
  // backward-compat: used in a few places; now based on intent router
  return detectIntent(message) === "maya";
}

function SaveImageButton({
  image_base64,
  mime_type,
  label,
}: {
  image_base64: string;
  mime_type: string;
  label?: string;
}) {
  const mime = mime_type || "image/png";
  const dataUri = `data:${mime};base64,${image_base64}`;
  const ext =
    mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
  const fileName = `adchat-${Date.now()}.${ext}`;
  const btnLabel = (label && String(label).trim()) || "💾 שמור תמונה";

  const [webDownloadHref, setWebDownloadHref] = useState<string | null>(null);
  const webBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(dataUri);
        const blob = await res.blob();
        const u = URL.createObjectURL(blob);
        webBlobUrlRef.current = u;
        if (!cancelled) setWebDownloadHref(u);
      } catch {
        if (!cancelled) setWebDownloadHref(dataUri);
      }
    })();
    return () => {
      cancelled = true;
      if (webBlobUrlRef.current) {
        URL.revokeObjectURL(webBlobUrlRef.current);
        webBlobUrlRef.current = null;
      }
    };
  }, [dataUri]);

  const saveNative = () => {
    void (async () => {
      try {
        if (Platform.OS === "ios") {
          await Share.share({ url: dataUri });
        } else {
          await Share.share({ message: dataUri, title: fileName });
        }
      } catch {
        Alert.alert("שמירת תמונה", "לא ניתן לפתוח את תפריט השיתוף.");
      }
    })();
  };

  if (Platform.OS === "web" && webDownloadHref) {
    return (
      <View style={styles.saveImageRow}>
        <Text
          accessibilityRole="link"
          accessibilityLabel="שמור תמונה"
          // react-native-web: קישור הורדה אמיתי
          {...({
            href: webDownloadHref,
            download: fileName,
            rel: "noopener noreferrer",
          } as Record<string, string>)}
          style={styles.saveImageLink}
        >
          {btnLabel}
        </Text>
      </View>
    );
  }

  if (Platform.OS === "web") {
    return (
      <View style={styles.saveImageRow}>
        <Text style={styles.saveImageLinkMuted}>מכין קישור להורדה…</Text>
      </View>
    );
  }

  return (
    <View style={styles.saveImageRow}>
      <TouchableOpacity
        onPress={saveNative}
        style={styles.saveImageBtnTouchable}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="שמור תמונה"
      >
        <Text style={styles.saveImageBtnText}>{btnLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const CLIENT_MEMORY_FETCH_MS = 3000;

function memVal(
  mem: ClientMemoryPayload | null | undefined,
  category: string,
  key: string,
): string {
  const v = mem?.by_category?.[category]?.[key];
  return typeof v === "string" ? v.trim() : "";
}

function isOnboardingMemoryComplete(mem: ClientMemoryPayload | null): boolean {
  if (!mem?.by_category) return false;
  if (memVal(mem, "business_profile", "scrape_confirmed") === "true") return true;
  if (memVal(mem, "business_profile", "manual_onboarding_done") === "true") return true;
  return [
    memVal(mem, "business_profile", "business_overview"),
    memVal(mem, "audience", "ideal_customer"),
    memVal(mem, "brand", "competitive_advantage"),
    memVal(mem, "goals", "primary_ad_goal"),
    memVal(mem, "goals", "monthly_budget"),
    memVal(mem, "insights", "active_campaigns"),
  ].every(Boolean);
}

function looksLikeWebsiteUrlForScrape(text: string): string | null {
  const t = String(text || "").trim();
  if (!t || /^אין$/i.test(t)) return null;
  const m = t.match(/https?:\/\/[^\s]+|www\.[^\s]+|[\w.-]+\.\w{2,}(?:\/[^\s]*)?/i);
  if (!m) return null;
  let candidate = m[0].replace(/[),.;]+$/, "");
  try {
    const u = candidate.includes("://") ? candidate : `https://${candidate}`;
    new URL(u);
    return u;
  } catch {
    return null;
  }
}

const ONBOARDING_Q1_TEXT =
  "שלום! אני דנה, מנהל הלקוח שלך 👋\n" +
  "כדי שאוכל לנהל את הפרסום שלך בצורה הטובה ביותר,\n" +
  "בוא נכיר קצת. מה שם העסק שלך ומה אתם עושים?";

/** פתיחה מקומית לפי מה שכבר נשמר בזיכרון (ללא קריאת LLM). */
function getOnboardingOpeningMessage(mem: ClientMemoryPayload): string {
  if (
    memVal(mem, "business_profile", "onboarding_source") === "website_scrape" &&
    memVal(mem, "business_profile", "scrape_confirmed") !== "true"
  ) {
    return (
      "סיכמנו נתונים מהאתר שלך. זה נכון? יש משהו לתקן?\n" +
      '(אפשר לכתוב "כן" / "מאשר" או לתאר תיקון.)'
    );
  }
  if (
    !memVal(mem, "business_profile", "business_overview") &&
    memVal(mem, "business_profile", "onboarding_source") !== "website_scrape"
  ) {
    return "מה כתובת האתר שלך? (אם אין — כתוב 'אין')";
  }
  if (!memVal(mem, "business_profile", "business_overview")) {
    return ONBOARDING_Q1_TEXT;
  }
  if (!memVal(mem, "audience", "ideal_customer")) {
    return "מי הלקוח האידיאלי שלכם? (גיל, מין, תחומי עניין)";
  }
  if (!memVal(mem, "brand", "competitive_advantage")) {
    return "מה היתרון התחרותי שלכם — למה לקוח יבחר בכם ולא במתחרה?";
  }
  if (!memVal(mem, "goals", "primary_ad_goal")) {
    return "מה המטרה העיקרית מהפרסום? (לידים/מכירות/מודעות/תנועה)";
  }
  if (!memVal(mem, "goals", "monthly_budget")) {
    return "מה התקציב החודשי לפרסום?";
  }
  if (!memVal(mem, "insights", "active_campaigns")) {
    return "האם יש קמפיינים פעילים כרגע?";
  }
  return ONBOARDING_Q1_TEXT;
}

async function fetchClientMemory(
  businessId: string,
  timeoutMs: number = CLIENT_MEMORY_FETCH_MS,
): Promise<ClientMemoryPayload> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchAdchatApi(
      `${API_BASE}/api/client-memory?business_id=${encodeURIComponent(businessId)}`,
      { signal: ctrl.signal },
    );
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(
        "פג הזמן לטעינת זיכרון הלקוח (מעל 3 שניות). נסה שוב.",
      );
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
  if (res.status === 401) {
    throw new ChatProxyError("פג תוקף ההתחברות", "auth_expired", 401);
  }
  const raw = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`זיכרון לקוח: ${res.status} ${raw}`.trim());
  }
  const data = JSON.parse(raw) as ClientMemoryPayload;
  return {
    business_id: data.business_id || businessId,
    by_category: data.by_category || {},
  };
}

async function persistMemoryUpdates(
  businessId: string,
  updates: MemoryUpdate[],
) {
  if (!updates?.length) return;
  for (const u of updates) {
    if (!u?.category || !u?.key || !u?.value) continue;
    const res = await fetchAdchatApi(`${API_BASE}/api/client-memory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        business_id: businessId,
        category: u.category,
        key: u.key,
        value: u.value,
        source: "chat",
      }),
    });
    if (res.status === 401) {
      throw new ChatProxyError("פג תוקף ההתחברות", "auth_expired", 401);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn("[client-memory] save failed", res.status, t);
    }
  }
}

function applyMemoryUpdatesLocal(
  prev: ClientMemoryPayload | null,
  businessId: string,
  updates: MemoryUpdate[],
): ClientMemoryPayload | null {
  if (!prev) return prev;
  if (!updates?.length) return prev;
  const next: ClientMemoryPayload = {
    business_id: prev.business_id || businessId,
    by_category: { ...(prev.by_category || {}) },
  };
  for (const u of updates) {
    if (!u?.category || !u?.key) continue;
    const c = String(u.category);
    const k = String(u.key);
    const v = String(u.value ?? "");
    const cat = { ...(next.by_category[c] || {}) };
    cat[k] = v;
    next.by_category[c] = cat;
  }
  return next;
}

function isMetaConnected(business: {
  meta_user_id?: string | null;
  selected_ad_account_id?: string | null;
  meta_account_id?: string | null;
}): boolean {
  return Boolean(
    business.meta_user_id ||
      business.selected_ad_account_id ||
      business.meta_account_id,
  );
}

async function callProxyChat({
  messages,
  businessId,
  businessName,
  businessIndustry,
  client_memory_empty,
  meta_connected,
}: {
  messages: ChatMessage[];
  businessId: string;
  businessName: string;
  businessIndustry: string | null;
  client_memory_empty?: boolean;
  meta_connected?: boolean;
}): Promise<ProxyReply> {
  const res = await fetchAdchatApi(PROXY_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        createdAt: m.createdAt,
        ...(m.image_base64 ? { image_base64: m.image_base64 } : {}),
        ...(m.mime_type ? { mime_type: m.mime_type } : {}),
      })),
      business_id: businessId,
      business_name: businessName,
      business_industry: businessIndustry ?? "",
      client_memory_empty: Boolean(client_memory_empty),
      ...(meta_connected !== undefined
        ? { meta_connected: Boolean(meta_connected) }
        : {}),
    }),
  });

  const raw = await res.text().catch(() => "");
  if (res.status === 401) {
    throw new ChatProxyError("פג תוקף ההתחברות", "auth_expired", 401);
  }
  if (!res.ok) {
    let errCode: string | undefined;
    try {
      const j = JSON.parse(raw) as { error_code?: string };
      errCode =
        typeof j.error_code === "string" ? j.error_code : undefined;
    } catch {
      // ignore
    }
    const overload =
      res.status === 429 ||
      res.status === 529 ||
      errCode === "anthropic_overload";
    if (overload) {
      throw new ChatProxyError(
        "השרת עמוס כרגע, נסה שוב עוד כמה שניות...",
        "overload",
        res.status,
      );
    }
    throw new Error(`Proxy החזיר ${res.status}. ${raw}`.trim());
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Proxy החזיר תשובה לא-JSON.");
  }

  const text =
    typeof (data as { text?: unknown }).text === "string"
      ? ((data as { text: string }).text || "").trim()
      : "";

  const imgRaw = (data as { image_base64?: unknown }).image_base64;
  const image_base64 =
    typeof imgRaw === "string" && imgRaw.trim() !== "" ? imgRaw.trim() : undefined;
  const mtRaw = (data as { mime_type?: unknown }).mime_type;
  const mime_type =
    typeof mtRaw === "string" && mtRaw.trim() !== "" ? mtRaw.trim() : undefined;

  if (!text && !image_base64) {
    throw new Error("לא התקבלה תשובה מהשרת.");
  }

  const memRaw = (data as { memory_updates?: unknown }).memory_updates;
  const memory_updates: MemoryUpdate[] = Array.isArray(memRaw)
    ? memRaw.filter(
        (x): x is MemoryUpdate =>
          x != null &&
          typeof (x as MemoryUpdate).category === "string" &&
          typeof (x as MemoryUpdate).key === "string" &&
          typeof (x as MemoryUpdate).value === "string",
      )
    : [];

  const srRaw = (data as { suggested_replies?: unknown }).suggested_replies;
  const suggested_replies = Array.isArray(srRaw)
    ? srRaw
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];

  const agentRaw = (data as { agent?: unknown }).agent;
  const delegatedRaw = (data as { delegated_to?: unknown }).delegated_to;
  const agent =
    typeof agentRaw === "string" && (agentRaw as AgentKey) && AGENTS[agentRaw as AgentKey]
      ? (agentRaw as AgentKey)
      : undefined;
  const delegated_to =
    typeof delegatedRaw === "string" && AGENTS[delegatedRaw as AgentKey]
      ? (delegatedRaw as AgentKey)
      : delegatedRaw == null
        ? null
        : undefined;

  return {
    text,
    memory_updates,
    suggested_replies,
    ...(image_base64
      ? {
          image_base64,
          mime_type: mime_type || "image/png",
        }
      : {}),
    ...(agent ? { agent } : {}),
    ...(delegated_to !== undefined ? { delegated_to } : {}),
  };
}

function formatTime(ts: number): string {
  if (!ts || ts <= 0) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function formatIsoDateTime(iso: string): string {
  const s = String(iso || "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 16);
  return d.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function agentLabelFromAny(agent: unknown): string {
  const a = typeof agent === "string" ? agent.trim().toLowerCase() : "";
  if (a === "yoni") return "יוני";
  if (a === "ron") return "רון";
  if (a === "maya") return "מאיה";
  if (a === "noa") return "נועה";
  return "דנה";
}

const styles = StyleSheet.create({
  centerBoot: {
    alignItems: "center",
    justifyContent: "center",
  },
  bootHint: {
    color: "rgba(243, 246, 255, 0.65)",
    fontSize: 15,
    writingDirection: "rtl",
  },
  safeArea: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },
  gradient: {
    flex: 1,
  },
  kav: {
    flex: 1,
    backgroundColor: "transparent",
  },
  container: {
    flex: 1,
    backgroundColor: "transparent",
  },
  header: {
    height: 56,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.06)",
    backgroundColor: "rgba(255, 255, 255, 0.02)",
  },
  headerCenter: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    flex: 1,
    justifyContent: "center",
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  headerAvatarEmoji: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  headerTitleWrap: {
    alignItems: "flex-end",
  },
  headerSubtitle: {
    marginTop: 2,
    color: "rgba(243, 246, 255, 0.65)",
    fontSize: 12,
    fontWeight: "700",
    writingDirection: "rtl",
  },
  newChatBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  newChatBtnText: {
    color: "#F3F6FF",
    fontSize: 13,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 18,
    backgroundColor: "#131A23",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    padding: 14,
  },
  modalHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  modalTitle: {
    color: "#F3F6FF",
    fontSize: 16,
    fontWeight: "900",
    writingDirection: "rtl",
  },
  modalPlus: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#4F6EF7",
    alignItems: "center",
    justifyContent: "center",
  },
  modalPlusText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 20,
  },
  modalHint: {
    color: "rgba(243, 246, 255, 0.65)",
    fontSize: 14,
    writingDirection: "rtl",
    textAlign: "right",
    paddingVertical: 10,
  },
  modalList: {
    maxHeight: 380,
  },
  sessionRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
    marginBottom: 10,
  },
  sessionRowTop: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sessionTitle: {
    flex: 1,
    color: "#F3F6FF",
    fontSize: 14,
    fontWeight: "800",
    writingDirection: "rtl",
    textAlign: "right",
  },
  sessionDate: {
    color: "rgba(243,246,255,0.55)",
    fontSize: 12,
    fontWeight: "700",
  },
  sessionMeta: {
    marginTop: 6,
    color: "rgba(243,246,255,0.70)",
    fontSize: 12,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
  },
  modalClose: {
    marginTop: 6,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  modalCloseText: {
    color: "#F3F6FF",
    fontSize: 14,
    fontWeight: "900",
    writingDirection: "rtl",
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  backIcon: {
    color: "#F3F6FF",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 18,
  },
  headerTitle: {
    color: "#F3F6FF",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
    writingDirection: "rtl",
  },
  messagesContent: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 10,
  },
  bubbleRow: {
    flexDirection: "row",
  },
  bubbleRowAgent: {
    justifyContent: "flex-start",
  },
  bubbleRowUser: {
    justifyContent: "flex-end",
  },
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
  },
  bubbleAgent: {
    backgroundColor: "#1E2530",
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  bubbleUser: {
    backgroundColor: "#4F6EF7",
    borderColor: "rgba(37, 99, 235, 0.55)",
  },
  bubbleText: {
    color: "#F3F6FF",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "right",
    writingDirection: "rtl",
  },
  bubbleTextUser: {
    color: "#FFFFFF",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "right",
    writingDirection: "rtl",
    fontWeight: "700",
  },
  agentBubbleContent: {
    alignSelf: "stretch",
    width: "100%",
    maxWidth: "100%",
  },
  agentRowLeft: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    maxWidth: "100%",
  },
  msgCol: {
    maxWidth: "86%",
  },
  msgAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: "hidden",
  },
  msgAvatarImg: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  msgAvatarEmoji: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  bubbleImage: {
    width: "100%",
    maxHeight: 400,
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.2)",
    alignSelf: "stretch",
  },
  saveImageRow: {
    marginTop: 8,
    alignSelf: "stretch",
    alignItems: "flex-end",
    width: "100%",
  },
  saveImageLink: {
    color: "rgba(91, 140, 255, 0.95)",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
    textDecorationLine: "underline",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(47, 107, 255, 0.18)",
    overflow: "hidden",
  },
  saveImageLinkMuted: {
    color: "rgba(243, 246, 255, 0.5)",
    fontSize: 13,
    textAlign: "right",
    writingDirection: "rtl",
  },
  saveImageBtnTouchable: {
    alignSelf: "flex-end",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(47, 107, 255, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(91, 140, 255, 0.35)",
  },
  imageModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  imageModalClose: {
    position: "absolute",
    top: 18,
    left: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  imageModalCloseText: {
    color: "#F3F6FF",
    fontSize: 18,
    fontWeight: "900",
  },
  imageModalCenter: {
    width: "100%",
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  imageModalImage: {
    width: "100%",
    height: "70%",
    maxWidth: 720,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  imageModalBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 22,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  saveImageBtnText: {
    color: "rgba(91, 140, 255, 0.98)",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  inlineSettingsLink: {
    color: "#5B8CFF",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    textDecorationLine: "underline",
    textAlign: "right",
    writingDirection: "rtl",
  },
  timeTextLeft: {
    marginTop: 6,
    color: "rgba(243, 246, 255, 0.45)",
    fontSize: 11,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "left",
  },
  timeTextRight: {
    marginTop: 6,
    color: "rgba(243, 246, 255, 0.45)",
    fontSize: 11,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
    alignSelf: "flex-end",
  },
  typingWrap: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
  },
  typingLabel: {
    color: "rgba(243, 246, 255, 0.8)",
    fontSize: 12,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  typingDotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 18,
  },
  composer: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
    backgroundColor: "#131A23",
  },
  overloadBanner: {
    marginBottom: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.35)",
    gap: 10,
  },
  overloadBannerText: {
    color: "rgba(243, 246, 255, 0.92)",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
    writingDirection: "rtl",
    lineHeight: 20,
  },
  overloadRetryBtn: {
    alignSelf: "stretch",
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(59, 130, 246, 0.22)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.45)",
  },
  overloadRetryBtnText: {
    color: "#93C5FD",
    fontSize: 15,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  suggestionScroll: {
    maxHeight: 48,
    marginBottom: 10,
  },
  suggestionScrollContent: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  suggestionChip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(91, 140, 255, 0.35)",
  },
  suggestionChipText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
  },
  inputRow: {
    flexDirection: "row-reverse",
    alignItems: "flex-end",
    gap: 10,
  },
  textInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    color: "#F3F6FF",
    fontSize: 14,
    writingDirection: "rtl",
  },
  sendCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#4F6EF7",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.55)",
  },
  sendCircleDisabled: {
    opacity: 0.7,
  },
  sendArrow: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 18,
    transform: [{ rotate: "180deg" }], // RTL: חץ שמאלה־לימין נראה הפוך
  },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  micBtnRecording: {
    backgroundColor: "rgba(239,68,68,0.25)",
    borderColor: "rgba(239,68,68,0.55)",
  },
  micIcon: {
    fontSize: 18,
  },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  attachIcon: {
    fontSize: 18,
  },
  previewRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  previewThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  previewRemove: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239,68,68,0.25)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.45)",
  },
  previewRemoveText: {
    color: "#EF4444",
    fontSize: 12,
    fontWeight: "900",
  },
  userBubbleImage: {
    width: 200,
    height: 200,
    borderRadius: 10,
    marginBottom: 6,
  },
  // --- Desktop layout styles ---
  desktopLayout: {
    flex: 1,
    flexDirection: "row-reverse",
  },
  desktopRightPanel: {
    width: 260,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  desktopLeftPanel: {
    width: 240,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  desktopCenterPanel: {
    flex: 1,
  },
  desktopPanelHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  desktopPanelTitle: {
    fontSize: 15,
    fontWeight: "900",
    writingDirection: "rtl",
    textAlign: "right",
  },
  desktopSessionsList: {
    flex: 1,
  },
  desktopMessagesWrap: {
    flex: 1,
  },
  mobileMessagesWrap: {
    flex: 1,
  },
  desktopMessagesContent: {},
  desktopComposer: {},
  desktopActiveAgent: {
    alignItems: "center",
    paddingVertical: 16,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  desktopAgentAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginBottom: 8,
  },
  desktopAgentAvatarEmoji: {
    fontSize: 22,
    color: "#FFFFFF",
    fontWeight: "900",
  },
  desktopAgentName: {
    fontSize: 16,
    fontWeight: "900",
    writingDirection: "rtl",
    textAlign: "center",
  },
  desktopAgentRole: {
    fontSize: 12,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "center",
    marginTop: 2,
  },
  desktopActiveIndicator: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  desktopActiveIndicatorText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  desktopAgentDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginVertical: 8,
  },
  desktopAgentsList: {
    flex: 1,
  },
  desktopAgentItem: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 6,
  },
  desktopAgentItemAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  desktopAgentItemEmoji: {
    fontSize: 15,
    color: "#FFFFFF",
    fontWeight: "900",
  },
  desktopAgentItemText: {
    flex: 1,
    alignItems: "flex-end",
  },
  desktopAgentItemName: {
    fontSize: 13,
    fontWeight: "800",
    writingDirection: "rtl",
    textAlign: "right",
  },
  desktopAgentItemRole: {
    fontSize: 11,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
    marginTop: 1,
  },
});
