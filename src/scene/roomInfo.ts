import { useMemo } from 'react';
import { useStore } from '../state/store';
import { useToday } from '../state/hooks';
import { dailyProgress, habitCompletionToday, nextEvent } from '../domain/services';
import { relativeDay } from '../domain/dates';
import type { SceneObjectId } from '../domain/types';

export const PIN_ICON: Record<SceneObjectId, string> = {
  desk: '✓', bookshelf: '📖', plants: '🌿', calendar: '📅', notebook: '✎',
};

/** True when the user has no data at all — the room then guides them with prompts. */
export function useFirstRun(): boolean {
  return useStore((s) => {
    const d = s.data;
    return !(d.tasks.length || d.projects.length || d.goals.length || d.habits.length || d.events.length || d.reminders.length || d.notes.length);
  });
}

/** Short, glanceable text shown on a hotspot's hover card. Derived from real data only. */
export function useRoomInfo(id: SceneObjectId): { summary: string; prompt: string | null } {
  const data = useStore((s) => s.data);
  const today = useToday();
  return useMemo(() => {
    switch (id) {
      case 'desk': {
        const p = dailyProgress(data.tasks, today);
        return {
          summary: p.total ? `${p.remaining} left today · ${p.done} done` : data.tasks.length ? 'A clear day' : 'No tasks yet',
          prompt: data.tasks.length ? null : 'Add your first task',
        };
      }
      case 'bookshelf': {
        const active = data.projects.filter((p) => p.status === 'active').length;
        return {
          summary: `${active} active project${active === 1 ? '' : 's'} · ${data.goals.length} goal${data.goals.length === 1 ? '' : 's'}`,
          prompt: data.projects.length + data.goals.length ? null : 'Start a project or goal',
        };
      }
      case 'plants': {
        const h = habitCompletionToday(data.habits, data.habitLogs, today);
        return { summary: h.total ? `${h.done}/${h.total} habits today` : 'No habits yet', prompt: h.total ? null : 'Plant your first habit' };
      }
      case 'calendar': {
        const n = nextEvent(data.events);
        return {
          summary: n ? `Next: ${n.title} · ${relativeDay(n.date, today)}` : 'Nothing scheduled',
          prompt: data.events.length + data.reminders.length ? null : 'Add an event or reminder',
        };
      }
      case 'notebook':
        return { summary: `${data.notes.length} note${data.notes.length === 1 ? '' : 's'}`, prompt: data.notes.length ? null : 'Write your first note' };
    }
  }, [id, data, today]);
}
