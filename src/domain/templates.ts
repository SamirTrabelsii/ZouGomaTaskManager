import type { NoteKind } from './types';

/**
 * Templates configure the single shared productivity engine. They never create rooms or
 * copy data: they only tune which note kinds are offered, which tab the bookshelf opens on,
 * and which starter suggestions appear. Disabling one never deletes anything.
 */
export interface TemplateDef {
  id: string;
  version: number;
  name: string;
  description: string;
  noteKinds: NoteKind[];
  bookshelfTab: 'projects' | 'goals';
  starterHabits: { key: string; title: string; frequency: 'daily' | 'weekly'; target: number }[];
  taskFields: ('project' | 'milestone' | 'goal')[];
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'personal',
    version: 1,
    name: 'Personal Life',
    description: 'Everyday tasks, journaling, reflections and a few gentle routines.',
    noteKinds: ['note', 'idea', 'journal', 'reflection'],
    bookshelfTab: 'goals',
    starterHabits: [
      { key: 'water', title: 'Drink enough water', frequency: 'daily', target: 1 },
      { key: 'walk', title: 'Go for a walk', frequency: 'weekly', target: 3 },
    ],
    taskFields: ['goal'],
  },
  {
    id: 'work',
    version: 1,
    name: 'Work & Projects',
    description: 'Projects with milestones, linked tasks, ideas and weekly reviews.',
    noteKinds: ['note', 'idea', 'review', 'lesson'],
    bookshelfTab: 'projects',
    starterHabits: [{ key: 'plan', title: 'Plan the day', frequency: 'daily', target: 1 }],
    taskFields: ['project', 'milestone', 'goal'],
  },
  {
    id: 'study',
    version: 1,
    name: 'Study & Learning',
    description: 'Learning goals, lessons learned, and a steady study rhythm.',
    noteKinds: ['note', 'lesson', 'idea', 'reflection'],
    bookshelfTab: 'goals',
    starterHabits: [
      { key: 'study', title: 'Study session', frequency: 'weekly', target: 4 },
      { key: 'read', title: 'Read for 15 minutes', frequency: 'daily', target: 1 },
    ],
    taskFields: ['goal', 'project'],
  },
  {
    id: 'habits',
    version: 1,
    name: 'Habits & Routines',
    description: 'Daily and weekly routines that grow the plants in your room.',
    noteKinds: ['note', 'reflection', 'journal'],
    bookshelfTab: 'goals',
    starterHabits: [
      { key: 'stretch', title: 'Morning stretch', frequency: 'daily', target: 1 },
      { key: 'journal', title: 'Evening journal', frequency: 'daily', target: 1 },
      { key: 'exercise', title: 'Exercise', frequency: 'weekly', target: 3 },
    ],
    taskFields: [],
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);

export interface ActiveTemplateConfig {
  noteKinds: NoteKind[];
  bookshelfTab: 'projects' | 'goals';
  taskFields: Set<'project' | 'milestone' | 'goal'>;
}

export function resolveTemplates(enabled: Record<string, { enabled: boolean }>): ActiveTemplateConfig {
  const active = TEMPLATES.filter((t) => enabled[t.id]?.enabled);
  const list = active.length ? active : [TEMPLATES[0]];
  const kinds = new Set<NoteKind>();
  const fields = new Set<'project' | 'milestone' | 'goal'>();
  list.forEach((t) => {
    t.noteKinds.forEach((k) => kinds.add(k));
    t.taskFields.forEach((f) => fields.add(f));
  });
  // Projects are the backbone for milestones; keep linking available whenever any template wants it.
  return { noteKinds: [...kinds], bookshelfTab: list[0].bookshelfTab, taskFields: fields };
}
