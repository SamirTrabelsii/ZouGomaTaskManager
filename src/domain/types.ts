export type ID = string;
export type Priority = 'low' | 'medium' | 'high';
export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'onhold' | 'done';
export type ProjectStatus = 'active' | 'paused' | 'done';
export type NoteKind = 'note' | 'idea' | 'journal' | 'reflection' | 'review' | 'lesson';
export type SceneObjectId = 'desk' | 'bookshelf' | 'plants' | 'calendar' | 'notebook';
export type ViewId = 'home' | 'tasks' | 'calendar' | 'insights';

export interface Task {
  id: ID;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null; // YYYY-MM-DD
  projectId: ID | null;
  milestoneId: ID | null;
  goalId: ID | null;
  /** Set on a subtask: the id of its parent task. Only one level deep – a parent is never itself a subtask. */
  parentId: ID | null;
  createdAt: string; // ISO
  completedAt: string | null; // ISO
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
  link: { type: 'event' | 'task'; id: ID } | null;
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

export const DATA_VERSION = 1;

export interface AppData {
  version: number;
  tasks: Task[];
  projects: Project[];
  milestones: Milestone[];
  goals: Goal[];
  habits: Habit[];
  habitLogs: HabitLog[];
  events: CalEvent[];
  reminders: Reminder[];
  notes: Note[];
  prefs: Prefs;
}
