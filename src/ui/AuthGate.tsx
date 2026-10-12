import { useState, type FormEvent } from 'react';
import { useStore } from '../state/store';

/** Shown when a LifeOS server is present and nobody is signed in. */
export function AuthGate() {
  const cloud = useStore((s) => s.cloud);
  const signIn = useStore((s) => s.signIn);
  // First run on a fresh server creates the one account; afterwards it is sign-in only.
  const canRegister = !cloud.hasUser || cloud.registrationOpen;
  const [mode, setMode] = useState<'login' | 'register'>(cloud.hasUser ? 'login' : 'register');
  const [email, setEmail] = useState(cloud.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const creating = mode === 'register';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const err = await signIn(email.trim(), password, mode);
    if (err) { setError(err); setBusy(false); setPassword(''); }
  };

  return (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(ellipse_at_50%_35%,#1d2a63,#080b1a_75%)] p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6" aria-labelledby="auth-title">
        <div className="text-center">
          <div aria-hidden className="text-3xl">🪴</div>
          <h1 id="auth-title" className="font-serif text-2xl font-semibold">LifeOS</h1>
          <p className="mt-1 text-sm text-ink-500">
            {creating ? 'Create your private account. Your studio is saved to it and available on any device you sign in from.' : 'Sign in to open your studio.'}
          </p>
        </div>
        <label className="block text-sm">
          <span className="label">Email</span>
          <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="block text-sm">
          <span className="label">Password</span>
          <input className="input" type="password" required minLength={creating ? 10 : 1} autoComplete={creating ? 'new-password' : 'current-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={creating ? 'pw-hint' : undefined} />
          {creating && <span id="pw-hint" className="mt-1 block text-xs text-ink-500">At least 10 characters. A few random words works well.</span>}
        </label>
        {error && <p role="alert" className="rounded-lg bg-clay-500/15 px-3 py-2 text-sm text-clay-500">{error}</p>}
        <button className="btn btn-primary w-full justify-center" disabled={busy}>{busy ? 'One moment…' : creating ? 'Create account' : 'Sign in'}</button>
        {cloud.hasUser && canRegister && (
          <button type="button" className="w-full text-center text-sm text-sky-500 underline" onClick={() => { setMode(creating ? 'login' : 'register'); setError(null); }}>
            {creating ? 'I already have an account' : 'Create another account'}
          </button>
        )}
        {creating && <p className="text-xs text-ink-500">If this browser already holds LifeOS data, it will be moved into your new account the first time you sign in.</p>}
      </form>
    </div>
  );
}
