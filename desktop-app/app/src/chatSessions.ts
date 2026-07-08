import type { ChatMessage } from "./types";

const CHAT_SESSIONS_KEY = "econometrics-agent.chat-sessions";
const ACTIVE_CHAT_KEY = "econometrics-agent.active-chat";
const EMPTY_CHAT_TITLE = "新会话";

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export interface ChatState {
  sessions: ChatSession[];
  activeId: string;
}

function nextChatId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function titleFromText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return EMPTY_CHAT_TITLE;
  return text.length > 22 ? `${text.slice(0, 22)}...` : text;
}

function titleFromMessages(messages: ChatMessage[]): string {
  return titleFromText(messages.find((item) => item.role === "user")?.content ?? "");
}

export function createChatSession(): ChatSession {
  return {
    id: nextChatId(),
    title: EMPTY_CHAT_TITLE,
    messages: [],
    updatedAt: Date.now()
  };
}

function normalizeChatMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ChatMessage>;
  if ((item.role === "user" || item.role === "assistant") && typeof item.content === "string") {
    return { role: item.role, content: item.content };
  }
  return null;
}

function normalizeChatSession(value: unknown): ChatSession | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ChatSession>;
  const messages = Array.isArray(item.messages)
    ? item.messages.map(normalizeChatMessage).filter((message): message is ChatMessage => Boolean(message))
    : [];

  return {
    id: typeof item.id === "string" && item.id.trim() ? item.id : nextChatId(),
    title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : titleFromMessages(messages),
    messages,
    updatedAt: typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now()
  };
}

export function loadChatState(): ChatState {
  try {
    const raw = localStorage.getItem(CHAT_SESSIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const sessions = Array.isArray(parsed)
      ? parsed.map(normalizeChatSession).filter((session): session is ChatSession => Boolean(session))
      : [];

    if (sessions.length === 0) {
      const session = createChatSession();
      return { sessions: [session], activeId: session.id };
    }

    const savedActiveId = localStorage.getItem(ACTIVE_CHAT_KEY);
    return {
      sessions,
      activeId: sessions.some((session) => session.id === savedActiveId) ? savedActiveId! : sessions[0].id
    };
  } catch {
    const session = createChatSession();
    return { sessions: [session], activeId: session.id };
  }
}

export function saveChatState(state: ChatState): void {
  try {
    localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(state.sessions));
    localStorage.setItem(ACTIVE_CHAT_KEY, state.activeId);
  } catch {
  }
}

export function updateChatMessages(state: ChatState, sessionId: string, messages: ChatMessage[]): ChatState {
  return {
    ...state,
    sessions: state.sessions.map((session) => {
      if (session.id !== sessionId) return session;
      return {
        ...session,
        title: session.title === EMPTY_CHAT_TITLE ? titleFromMessages(messages) : session.title,
        messages,
        updatedAt: Date.now()
      };
    })
  };
}

export function chatPreview(session: ChatSession): string {
  const lastMessage = session.messages[session.messages.length - 1];
  const last = lastMessage?.content.replace(/\s+/g, " ").trim();
  if (!last) return "还没有消息";
  return last.length > 32 ? `${last.slice(0, 32)}...` : last;
}

export function formatChatTime(value: number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}
