import { describe, expect, it } from 'vitest';
import { agentConfigured, agentSummary, alertCounts, criticalIds, newlyCritical, relativeTime } from './agent';
import type { AgentOverview, AlertSeverity, AlertStatus } from './types';

const overview = (o: Partial<AgentOverview> = {}): AgentOverview => ({ online: true, lastSeenAt: '2026-11-01T10:00:00Z', version: '1', state: 'idle', tokens: [], ...o });
const alert = (id: string, severity: AlertSeverity = 'high', status: AlertStatus = 'open') => ({ id, severity, status });

describe('agent console', () => {
  it('only appears once a token exists or the agent has checked in', () => {
    expect(agentConfigured(null)).toBe(false);
    expect(agentConfigured(overview({ lastSeenAt: null }))).toBe(false);
    expect(agentConfigured(overview({ lastSeenAt: null, tokens: [{ id: '1', name: 'x', hint: 'abcd', createdAt: '', lastUsedAt: null }] }))).toBe(true);
    expect(agentConfigured(overview())).toBe(true);
  });

  it('counts open and critical alerts, ignoring resolved and ignored ones', () => {
    const list = [alert('1', 'critical'), alert('2', 'critical', 'resolved'), alert('3', 'low', 'ignored'), alert('4', 'high', 'investigating')];
    expect(alertCounts(list)).toEqual({ open: 2, critical: 1 });
  });

  it('nudges for a new critical alert, never on the first look', () => {
    const list = [alert('1', 'critical'), alert('2', 'high')];
    expect(newlyCritical(null, list)).toEqual([]);
    expect(newlyCritical(criticalIds(list), list)).toEqual([]);
    expect(newlyCritical(new Set(), list)).toEqual(['1']);
    expect(newlyCritical(new Set(['1']), [...list, alert('9', 'critical')])).toEqual(['9']);
    expect(newlyCritical(new Set(), [alert('5', 'critical', 'resolved')])).toEqual([]); // a closed alert is not news
    expect(newlyCritical(new Set(), [alert('6', 'high')])).toEqual([]); // only critical ones
  });

  it('describes the console on its hover card', () => {
    expect(agentSummary(null, []).summary).toBe('Checking the agent…');
    expect(agentSummary(overview({ lastSeenAt: null }), [])).toEqual({ summary: 'Waiting for the agent to connect', prompt: 'Connect your agent in Settings' });
    expect(agentSummary(overview(), [])).toEqual({ summary: 'All quiet', prompt: null });
    expect(agentSummary(overview(), [alert('1', 'critical'), alert('2')]).summary).toBe('2 open alerts · 1 critical');
    expect(agentSummary(overview(), [alert('1')]).summary).toBe('1 open alert');
    expect(agentSummary(overview({ online: false }), [alert('1')]).summary).toBe('Agent offline · 1 open alert');
    expect(agentSummary(overview({ state: 'paused' }), []).summary).toBe('Agent paused · All quiet');
  });

  it('says how long ago in plain words', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    expect(relativeTime(null, now)).toBe('never');
    expect(relativeTime('2026-11-01T11:59:50Z', now)).toBe('just now');
    expect(relativeTime('2026-11-01T11:30:00Z', now)).toBe('30 min ago');
    expect(relativeTime('2026-11-01T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-10-29T12:00:00Z', now)).toBe('3 d ago');
  });
});
