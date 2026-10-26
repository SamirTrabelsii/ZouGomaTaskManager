export type ID = string;
export type Priority = 'low' | 'medium' | 'high';
export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'onhold' | 'done';
/** T-shirt size of a task; each size is worth a fixed number of story points (see SIZE_POINTS). */
export type TaskSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';
export type ProjectStatus = 'active' | 'paused' | 'done';
/** How big a goal's Berries reward is; chosen when the goal is created, then locked (see GOAL_TIERS). */
export type GoalTier = 'S' | 'M' | 'L' | 'XL';
/** Where a certification stands. "Expired" is not stored: it follows from the expiry date (see certState). */
export type CertStatus = 'planned' | 'studying' | 'earned';
/** How advanced a certification is; sets its Berries reward (see CERT_REWARD). */
export type CertLevel = 'badge' | 'foundational' | 'associate' | 'professional' | 'expert';
export type NoteKind = 'note' | 'idea' | 'journal' | 'reflection' | 'review' | 'lesson';
export type SceneObjectId = 'desk' | 'bookshelf' | 'plants' | 'calendar' | 'notebook' | 'chest';
export type ViewId = 'home' | 'tasks' | 'calendar' | 'insights';

export interface Task {
  id: ID;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: Priority;
  /** Effort estimate; null = not sized yet (worth 0 points). */
  size: TaskSize | null;
  dueDate: string | null; // YYYY-MM-DD
  projectId: ID | null;
  milestoneId: ID | null;
  goalId: ID | null;
  /** The scope (a named group / tag) this task belongs to, if any. */
  scopeId: ID | null;
  /** Why/what a Blocked task is waiting on. Only kept while the status is blocked. */
  blockedBy: string;
  /** When an On hold task should come back (YYYY-MM-DD). Only kept while the status is onhold. */
  resumeOn: string | null;
  createdAt: string; // ISO
  completedAt: string | null; // ISO
}

/** A lightweight wrapper that groups tasks. It is not a task itself – just a named, coloured label. */
export interface Scope {
  id: ID;
  title: string;
  icon: string; // an emoji
  color: string; // #rrggbb
  createdAt: string;
}

export interface Project {
  id: ID;
  title: string;
  description: string;
  status: ProjectStatus;
  deadline: string | null;
  createdAt: string;
}

export interface Milestone {
  id: ID;
  projectId: ID;
  title: string;
  dueDate: string | null;
  done: boolean;
  completedAt: string | null;
}

export interface Goal {
  id: ID;
  title: string;
  description: string;
  unit: string; // e.g. "books", "hours", "%"
  target: number;
  current: number;
  deadline: string | null;
  createdAt: string;
  /** Reward tier; null for goals made before rewards existed (they may pick one, once). */
  reward: GoalTier | null;
  /** When the tier was picked (ISO). Bigger tiers only pay in full once the goal is old enough. */
  rewardSetAt: string | null;
}

/** A professional certification: something you work toward, then a credential you keep current. */
export interface Certification {
  id: ID;
  title: string;
  issuer: string;
  level: CertLevel;
  status: CertStatus;
  examDate: string | null; // YYYY-MM-DD
  earnedOn: string | null; // YYYY-MM-DD
  /** null = never expires. */
  expiresOn: string | null; // YYYY-MM-DD
  credentialId: string;
  /** Verification link; only http(s) is kept. */
  credentialUrl: string;
  notes: string;
  /** Days before expiry to remind about renewal; null = no reminder. */
  remindBefore: number | null;
  createdAt: string; // ISO
}

export interface Habit {
  id: ID;
  title: string;
  frequency: 'daily' | 'weekly';
  /** Times per week when weekly. Ignored for daily. */
  target: number;
  archived: boolean;
  createdAt: string;
  origin: string | null; // template starter key, used to avoid duplicates
}

export interface HabitLog {
  id: ID;
  habitId: ID;
  date: string; // YYYY-MM-DD, at most one per habit/day
}

export interface CalEvent {
  id: ID;
  title: string;
  kind: 'event' | 'deadline';
  date: string;
  time: string | null; // HH:mm
  endTime: string | null;
  notes: string;
  remindBefore: number | null; // minutes
}

export interface Reminder {
  id: ID;
  title: string;
  at: string; // local 'YYYY-MM-DDTHH:mm'
  link: { type: 'event' | 'task' | 'cert'; id: ID } | null;
  /** Set once delivered by any channel — guarantees we never deliver twice. */
  deliveredAt: string | null;
  deliveredVia: 'browser' | 'in-app' | null;
  /** Acknowledged by the user in the in-app inbox. */
  ackedAt: string | null;
}

export interface Note {
  id: ID;
  title: string;
  body: string;
  kind: NoteKind;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type Quality = 'auto' | 'high' | 'balanced' | 'low';

export interface Prefs {
  notifications: { enabled: boolean };
  templates: Record<string, { enabled: boolean; version: number }>;
  scene: {
    layoutVersion: number;
    theme: 'day' | 'evening' | 'auto';
    weather: 'clear' | 'rain';
    quality: Quality;
    reduceMotion: boolean;
    /** Sound effects when opening card packs. */
    sound: boolean;
    /** The card framed on the room's wall; null shows your most valuable card. */
    showcase: string | null;
    mode: 'auto' | '3d' | '2d';
    camera: { position: [number, number, number]; target: [number, number, number] } | null;
  };
}

/** A read-only iCal subscription. Lives on the server, never in {@link AppData}. */
export interface CalendarFeed {
  id: string;
  name: string;
  color: string; // #rrggbb
  host: string;
  lastSyncAt: string | null;
  lastError: string | null;
  warnings: string[];
  eventCount: number;
  /** Minutes before a timed meeting to push a reminder; null = no reminders. */
  remindBefore: number | null;
}

/**
 * A meeting imported from a feed, as the server sends it. `start`/`end` are either a date ("2026-06-10", end exclusive),
 * an instant ("…Z", shown in this device's time zone), or a floating wall-clock time ("2026-06-10T09:30:00").
 */
export interface ExternalEvent {
  id: string;
  feedId: string;
  title: string;
  location: string;
  description: string;
  allDay: boolean;
  start: string;
  end: string;
}

/**
 * One movement of Berries (฿), the app's reward currency. The ledger is append-only: the balance is the sum of all
 * amounts, and `key` names the source ("welcome", "week:2026-10-19") so a reward can never be paid twice.
 */
export interface LedgerEntry {
  id: ID;
  key: string;
  kind: 'welcome' | 'weekly' | 'project' | 'milestone' | 'goal' | 'cert' | 'purchase' | 'sale' | 'collection';
  /** Positive = earned, negative = spent. May be 0 (a week closed below the minimum is still recorded). */
  amount: number;
  label: string;
  at: string; // ISO
  /** Weekly bounties only: what the payout was computed from, frozen at claim time. */
  week?: { start: string; points: number; streak: number; multiplier: number; bonus: number; habits?: number };
}

/** A booster bought but not opened yet. Its cards are rolled at purchase, so reloading the app can't reroll them. */
export interface SealedPack {
  id: ID;
  setId: string;
  boughtAt: string; // ISO
  /** Card print ids, in reveal order (best last). */
  cards: string[];
  /** Set on every pack of a box bought whole, so the box can be opened as one. */
  boxId?: ID;
}

export interface CardCollection {
  sealed: SealedPack[];
  /** Copies owned per card print id. */
  owned: Record<string, number>;
  /** The big pulls (Super Rare and up), newest first, kept for the history in Insights. */
  pulls?: Pull[];
}

/** A big card you got, when, and how: from a pack (or box) or bought on the market. */
export interface Pull {
  id: string;
  at: string; // ISO
  via: 'pack' | 'market';
}

/**
 * 2: tasks gained scopes + sizes. 3: the Berries ledger. 4: certifications.
 * Older app copies refuse newer data instead of silently stripping the new fields on their next save.
 */
export const DATA_VERSION = 4;

export interface AppData {
  version: number;
  tasks: Task[];
  scopes: Scope[];
  projects: Project[];
  milestones: Milestone[];
  goals: Goal[];
  certifications: Certification[];
  habits: Habit[];
  habitLogs: HabitLog[];
  events: CalEvent[];
  reminders: Reminder[];
  notes: Note[];
  ledger: LedgerEntry[];
  cards: CardCollection;
  prefs: Prefs;
}
