import { useEffect, useMemo, useState } from 'react';
import { PanelShell, Section, Tabs } from './PanelShell';
import { BrookAvatar } from '../common/CrewAvatar';
import { ConfirmButton, Dialog, Field, Segmented } from '../common/ui';
import { useDeck } from '../../state/deck';
import { useStore } from '../../state/store';
import { cloud, ApiError } from '../../data/cloud';
import { ago } from '../FeedsSettings';
import {
  ACTION_LABELS, BUTTON_COLORS, MAX_BUTTONS, MAX_COLUMNS, MAX_LABEL, MIN_COLUMNS, blankAction, buttonProblem, deckMood, describeAction,
  MAX_SCRIPT_BYTES, MAX_SOUND_BYTES, PICTURE_SIZE, coverCrop, fileKindOf, layoutKey, newPictureName, offeredFiles, pictureUrl, moveItem,
  newButton, starterButtons, type ChromeProfile, type DeckActionType, type DeckButton, type DeckFileKind, type DeckOverview,
} from '../../domain/deck';

type Tab = 'buttons' | 'files' | 'connect';
const MAX_TOKENS = 3;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'Cannot reach the LifeOS server.');

function subtitle(o: DeckOverview | null): string {
  if (!o) return 'Loading…';
  switch (deckMood(o)) {
    case 'unplugged': return 'No deck connected yet';
    case 'outdated': return `Deck synced ${ago(o.deck.syncedAt)} · click ⟳ on the deck to get your changes`;
    case 'ready': return `Deck up to date · synced ${ago(o.deck.syncedAt)}`;
  }
}

/** Brook Bot's panel: the buttons of the stream deck on your PC, and how to connect it. */
export function DeckPanel() {
  const overview = useDeck((s) => s.overview);
  const [tab, setTab] = useState<Tab>('buttons');
  useEffect(() => {
    void useDeck.getState().sync();
    const id = setInterval(() => void useDeck.getState().sync(), 30_000); // to see the deck pick up a change while the panel is open
    return () => clearInterval(id);
  }, []);
  useEffect(() => { if (overview && !overview.deck.syncedAt && !overview.tokens.length && !overview.buttons.length) setTab('buttons'); }, [overview]);
  return (
    <PanelShell title="Brook Bot" icon={<BrookAvatar />} subtitle={subtitle(overview)}>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'buttons', label: 'Buttons', count: overview?.buttons.length },
        { id: 'files', label: 'Files', count: overview?.files?.length },
        { id: 'connect', label: deckMood(overview) === 'unplugged' ? 'Connect ⚠' : 'Connect' },
      ]} />
      {!overview ? <p className="text-sm text-ink-500">Loading…</p> : tab === 'buttons' ? <ButtonsTab overview={overview} /> : tab === 'files' ? <FilesTab overview={overview} /> : <ConnectTab overview={overview} />}
    </PanelShell>
  );
}

/* ── the buttons ── */

function Key({ b, selected, onClick }: { b: DeckButton; selected: boolean; onClick: () => void }) {
  const bad = !!buttonProblem(b);
  return (
    <button
      type="button" onClick={onClick} aria-pressed={selected} title={`${b.label} · ${describeAction(b.action)}`}
      className={`relative flex aspect-square min-w-0 flex-col items-center gap-0.5 overflow-hidden rounded-xl p-1 text-white shadow-sm transition
        ${b.picture ? 'justify-end bg-cover bg-center' : 'justify-center'}
        ${selected ? 'ring-2 ring-offset-2 ring-offset-cream-50 ring-moss-600' : 'hover:brightness-110'}`}
      style={b.picture ? { backgroundImage: `url(${pictureUrl(b.picture)})`, backgroundColor: b.color } : { background: b.color }}
    >
      {b.picture && <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/75 to-transparent" />}
      {!b.picture && <span aria-hidden className="text-xl leading-none">{b.icon || b.label.slice(0, 1).toUpperCase()}</span>}
      <span className="relative w-full truncate text-center text-[10px] font-medium leading-tight [text-shadow:0_1px_2px_rgba(0,0,0,.7)]">{b.label || '…'}</span>
      {bad && <span className="absolute right-1 top-0.5 text-[10px]" aria-label="needs fixing">⚠</span>}
    </button>
  );
}

function ButtonsTab({ overview }: { overview: DeckOverview }) {
  const toast = useStore.getState().toast;
  const save = useDeck((s) => s.save);
  const [columns, setColumns] = useState(overview.columns);
  const [buttons, setButtons] = useState<DeckButton[]>(overview.buttons);
  const [sel, setSel] = useState<string | null>(overview.buttons[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // a save elsewhere (another tab) replaces the draft only while nothing is being edited here
  const savedKey = layoutKey(overview.columns, overview.buttons);
  const dirty = layoutKey(columns, buttons) !== savedKey;
  useEffect(() => {
    if (dirty) return;
    setColumns(overview.columns); setButtons(overview.buttons);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const index = buttons.findIndex((b) => b.id === sel);
  const current = index >= 0 ? buttons[index] : null;
  const problems = useMemo(() => buttons.map(buttonProblem).filter(Boolean).length, [buttons]);
  const edit = (patch: Partial<DeckButton>) => setButtons((list) => list.map((b) => (b.id === sel ? { ...b, ...patch } : b)));
  const add = () => { const b = newButton(uid()); setButtons((l) => [...l, b]); setSel(b.id); };

  const onSave = async () => {
    setBusy(true); setErr('');
    const e = await save(columns, buttons);
    setBusy(false);
    if (e) return setErr(e);
    // take back what the server stored: it tidies labels and colours and drops faces from older versions
    const saved = useDeck.getState().overview;
    if (saved) { setColumns(saved.columns); setButtons(saved.buttons); }
    toast('Saved. Click ⟳ on the deck to load the buttons.');
  };

  return (
    <div className="space-y-4">
      <Section title="Your deck" right={
        <label className="flex items-center gap-1.5 text-xs text-ink-500">
          Columns
          <select className="input w-auto py-0.5 text-xs" value={columns} onChange={(e) => setColumns(Number(e.target.value))}>
            {Array.from({ length: MAX_COLUMNS - MIN_COLUMNS + 1 }, (_, i) => MIN_COLUMNS + i).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      }>
        {buttons.length === 0 ? (
          <div className="card space-y-2 text-center text-sm">
            <p className="text-ink-500">No buttons yet. Start from the three examples (screen capture, LifeOS in Chrome, applause) or add your own.</p>
            <div className="flex justify-center gap-2">
              <button className="btn btn-primary" onClick={() => { const s = starterButtons(window.location.origin, uid); setButtons(s); setSel(s[0].id); }}>Use the examples</button>
              <button className="btn" onClick={add}>＋ Add a button</button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-[#14161f] p-2.5" style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: '0.5rem' }}>
            {buttons.map((b) => <Key key={b.id} b={b} selected={b.id === sel} onClick={() => setSel(b.id)} />)}
            {buttons.length < MAX_BUTTONS && (
              <button type="button" onClick={add} title="Add a button"
                className="flex aspect-square items-center justify-center rounded-xl border-2 border-dashed border-white/25 text-2xl text-white/50 hover:border-white/50 hover:text-white/80">＋</button>
            )}
          </div>
        )}
      </Section>

      {current && (
        <Section title={`Button ${index + 1}`} right={
          <div className="flex gap-1">
            <button className="btn btn-ghost px-2 text-xs" disabled={index === 0} onClick={() => setButtons((l) => moveItem(l, index, -1))} title="Move earlier">◀</button>
            <button className="btn btn-ghost px-2 text-xs" disabled={index === buttons.length - 1} onClick={() => setButtons((l) => moveItem(l, index, 1))} title="Move later">▶</button>
            <ConfirmButton className="btn btn-ghost px-2 text-xs text-clay-600" confirmLabel="Remove?" onConfirm={() => {
              setButtons((l) => l.filter((b) => b.id !== current.id)); setSel(buttons[index + 1]?.id ?? buttons[index - 1]?.id ?? null);
            }}>Remove</ConfirmButton>
          </div>
        }>
          <ButtonEditor b={current} overview={overview} onChange={edit} />
        </Section>
      )}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-cream-300 bg-cream-50/95 px-4 py-2">
        <button className="btn btn-primary" disabled={!dirty || busy || problems > 0} onClick={() => void onSave()}>{busy ? 'Saving…' : 'Save'}</button>
        {dirty && <button className="btn btn-ghost" onClick={() => { setColumns(overview.columns); setButtons(overview.buttons); setErr(''); }}>Discard changes</button>}
        <span className="text-xs text-ink-500">
          {problems > 0 ? `${problems} button${problems === 1 ? '' : 's'} to fix (⚠)` : dirty ? 'Unsaved changes' : overview.updatedAt ? `Saved ${ago(overview.updatedAt)}` : ''}
        </span>
        {err && <p role="alert" className="w-full text-xs text-clay-600">{err}</p>}
      </div>
    </div>
  );
}

function ButtonEditor({ b, overview, onChange }: { b: DeckButton; overview: DeckOverview; onChange: (patch: Partial<DeckButton>) => void }) {
  const a = b.action;
  const problem = buttonProblem(b);
  const setType = (t: DeckActionType) => { if (t !== a.type) onChange({ action: blankAction(t) }); };
  const [picking, setPicking] = useState(false);
  return (
    <div className="card space-y-3 text-sm">
      <div>
        <span className="label">Face</span>
        <Segmented label="Button face" value={b.picture ? 'picture' : 'emoji'} onChange={(v) => (v === 'emoji' ? onChange({ picture: undefined }) : setPicking(true))}
          options={[{ value: 'emoji', label: 'Emoji' }, { value: 'picture', label: 'Picture' }]} />
      </div>
      <div className="flex gap-2">
        {b.picture ? (
          <button type="button" onClick={() => setPicking(true)} title="Change the picture"
            className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-cream-300 bg-cover bg-center"
            style={{ backgroundImage: `url(${pictureUrl(b.picture)})`, backgroundColor: b.color }} aria-label="Change the picture" />
        ) : (
          <Field label="Icon" className="w-20">
            <input className="input text-center text-lg" value={b.icon} maxLength={8} onChange={(e) => onChange({ icon: e.target.value })} aria-describedby="deck-icon-hint" />
          </Field>
        )}
        <Field label="Label" className="flex-1">
          <input className="input" value={b.label} maxLength={MAX_LABEL} onChange={(e) => onChange({ label: e.target.value })} />
        </Field>
      </div>
      <p id="deck-icon-hint" className="-mt-2 text-xs text-ink-500">
        {b.picture ? <>The picture fills the button, with the label over it. <button type="button" className="underline" onClick={() => setPicking(true)}>Change picture</button></> : 'Icon: one emoji (Windows key + . opens the emoji picker).'}
      </p>
      {picking && <PicturePicker overview={overview} current={b.picture ?? null} onClose={() => setPicking(false)} onPick={(picture) => { onChange({ picture }); setPicking(false); }} />}
      <div>
        <span className="label">Colour</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {BUTTON_COLORS.map((c) => (
            <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={b.color === c} onClick={() => onChange({ color: c })}
              className={`h-6 w-6 rounded-full border-2 ${b.color === c ? 'border-ink-900' : 'border-transparent'}`} style={{ background: c }} />
          ))}
          <input type="color" aria-label="Other colour" className="h-6 w-8 cursor-pointer rounded border border-cream-300" value={b.color} onChange={(e) => onChange({ color: e.target.value })} />
        </div>
      </div>
      <Field label="When clicked">
        <select className="input" value={a.type} onChange={(e) => setType(e.target.value as DeckActionType)}>
          {(Object.keys(ACTION_LABELS) as DeckActionType[]).map((t) => <option key={t} value={t}>{ACTION_LABELS[t]}</option>)}
        </select>
      </Field>

      {a.type === 'website' && (
        <>
          <Field label="Address"><input className="input" type="url" value={a.url} placeholder="https://…" onChange={(e) => onChange({ action: { ...a, url: e.target.value.trim() } })} /></Field>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <span className="label">Open in</span>
              <Segmented label="Browser" value={a.browser} onChange={(v) => onChange({ action: { ...a, browser: v } })}
                options={[{ value: 'default', label: 'Default browser' }, { value: 'chrome', label: 'Chrome' }]} />
            </div>
            {a.browser === 'chrome' && (
              <Field label="Chrome profile" className="min-w-[8rem] flex-1">
                <ChromeProfilePicker value={a.profile} profiles={overview.deck.chromeProfiles ?? []} onChange={(profile) => onChange({ action: { ...a, profile } })} />
              </Field>
            )}
          </div>
          {a.browser === 'chrome' && (overview.deck.chromeProfiles?.length
            ? <p className="text-xs text-ink-500">The profiles of Chrome on your PC, as the deck last saw them. If that profile already has a window open, the page opens as a new tab in it.</p>
            : <p className="text-xs text-ink-500">Connect the deck to pick from your Chrome profiles. Meanwhile: the last folder of “Profile Path” in <code>chrome://version</code> (<code>Default</code>, <code>Profile 1</code>, <code>Profile 2</code>…).</p>)}
        </>
      )}

      {a.type === 'app' && (
        <>
          <Field label="Program, shortcut or Windows link">
            <input className="input font-mono text-xs" value={a.target} list="deck-app-links" placeholder="C:\Program Files\…\app.exe" onChange={(e) => onChange({ action: { ...a, target: e.target.value.trim() } })} />
          </Field>
          <datalist id="deck-app-links">
            <option value="ms-screenclip:">Screen capture</option>
            <option value="ms-settings:">Windows settings</option>
            <option value="calculator:">Calculator</option>
          </datalist>
          <p className="text-xs text-ink-500">Right-click a program or shortcut › “Copy as path”, then paste it here (without the quotes). <code>ms-screenclip:</code> opens the screen capture.</p>
        </>
      )}

      {a.type === 'script' && (
        <>
          <Field label="Script">
            <FilePicker value={a.file} files={offeredFiles(overview, 'script')} placeholder="backup.ps1" onChange={(file) => onChange({ action: { ...a, file } })} />
          </Field>
          <p className="text-xs text-ink-500">Only files in the deck’s <code>Documents\LifeOS Deck\scripts</code> folder on your PC can run. Send one from the <b>Files</b> tab, or drop it in that folder. The deck shows you a new or changed script and asks before running it.</p>
        </>
      )}

      {a.type === 'sound' && (
        <>
          <Field label="Sound">
            <FilePicker value={a.file} files={offeredFiles(overview, 'sound')} placeholder="applause.wav" onChange={(file) => onChange({ action: { ...a, file } })} />
          </Field>
          <Field label={`Volume · ${a.volume}%`}>
            <input type="range" min={0} max={100} step={5} className="w-full accent-moss-600" value={a.volume} onChange={(e) => onChange({ action: { ...a, volume: Number(e.target.value) } })} />
          </Field>
          <p className="text-xs text-ink-500">Sounds play on your PC only (your speakers or headset), never into a call. Send your own .wav, .mp3 or .ogg from the <b>Files</b> tab.</p>
        </>
      )}

      {problem ? <p role="alert" className="text-xs text-clay-600">⚠ {problem}</p> : <p className="text-xs text-ink-500">{describeAction(a)}</p>}
    </div>
  );
}

/** A file name from the deck's folder: a list of what the PC reported, or free text before the deck has connected. */
function FilePicker({ value, files, placeholder, onChange }: { value: string; files: string[]; placeholder: string; onChange: (v: string) => void }) {
  if (!files.length) {
    return <input className="input font-mono text-xs" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value.trim())} />;
  }
  const known = files.includes(value);
  return (
    <select className="input" value={known ? value : ''} onChange={(e) => onChange(e.target.value)}>
      {!known && <option value="">{value ? `${value} (not on the PC)` : 'Pick a file…'}</option>}
      {files.map((f) => <option key={f} value={f}>{f}</option>)}
    </select>
  );
}

/* ── pictures ── */

function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}

/**
 * Turns any picture the browser can open (photo, logo, screenshot, GIF's first frame…) into a small square for a button: the
 * centred square, at most 256 px, as WebP (PNG where the browser cannot write WebP). Transparency is kept, so a logo sits on
 * the button's colour.
 */
async function preparePicture(file: Blob): Promise<{ name: string; data: string }> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('This is not a picture the browser can open (try PNG, JPEG or WebP).'); }
  const { sx, sy, side } = coverCrop(bmp.width, bmp.height);
  const size = Math.max(1, Math.min(PICTURE_SIZE, side));
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const g = canvas.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
  bmp.close();
  const toBlob = (type: string, q?: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
  const webp = await toBlob('image/webp', 0.9);
  const out = webp?.type === 'image/webp' ? webp : await toBlob('image/png');
  if (!out) throw new Error('Could not prepare the picture.');
  return { name: newPictureName(out.type === 'image/webp' ? 'webp' : 'png', uid), data: await readBase64(out) };
}

/** Picks a picture for a button: one already sent, or a new one from the PC (cropped to a square and shrunk first). */
function PicturePicker({ overview, current, onPick, onClose }: { overview: DeckOverview; current: string | null; onPick: (name: string) => void; onClose: () => void }) {
  const upload = useDeck((s) => s.upload);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pictures = (overview.files ?? []).filter((f) => f.kind === 'picture').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const add = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const p = await preparePicture(file);
      const e = await upload('picture', p.name, p.data);
      if (e) setErr(e); else onPick(p.name);
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Picture for the button" onClose={onClose} wide>
      <label className={`mb-3 flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-cream-300 p-4 text-center text-sm hover:border-moss-600 ${busy ? 'opacity-60' : ''}`}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void add(e.dataTransfer.files[0]); }}>
        <span className="text-2xl" aria-hidden>🖼️</span>
        <span className="font-medium">{busy ? 'Preparing…' : 'Drop a picture here, or click to choose one'}</span>
        <span className="text-xs text-ink-500">Any photo, logo or screenshot. It is cropped to its centre square and shrunk to {PICTURE_SIZE} px.</span>
        <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => { void add(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {err && <p role="alert" className="mb-2 text-xs text-clay-600">{err}</p>}
      {pictures.length > 0 && (
        <>
          <p className="mb-2 text-xs text-ink-500">Or reuse one you sent before:</p>
          <div className="grid max-h-[45vh] grid-cols-5 gap-2 overflow-y-auto sm:grid-cols-7">
            {pictures.map((p) => (
              <button key={p.name} type="button" onClick={() => onPick(p.name)} title={p.name}
                className={`aspect-square overflow-hidden rounded-lg border-2 ${current === p.name ? 'border-moss-600' : 'border-transparent hover:border-cream-300'}`}>
                <img src={pictureUrl(p.name)} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}

/* ── files sent to the deck ── */

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function FilesTab({ overview }: { overview: DeckOverview }) {
  const toast = useStore.getState().toast;
  const upload = useDeck((s) => s.upload);
  const removeFile = useDeck((s) => s.removeFile);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const files = overview.files ?? [];

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true); setErr('');
    for (const f of [...list]) {
      const kind = fileKindOf(f.name);
      if (!kind) { setErr(`${f.name}: only pictures, .wav, .mp3, .ogg sounds and .ps1, .bat, .cmd scripts with a plain name (letters, digits, spaces, . _ - ( )).`); continue; }
      try {
        if (kind === 'picture') {
          const p = await preparePicture(f);
          const e = await upload('picture', p.name, p.data);
          if (e) setErr(`${f.name}: ${e}`); else toast(`${f.name} added. Pick it as a button's picture.`);
          continue;
        }
        const max = kind === 'sound' ? MAX_SOUND_BYTES : MAX_SCRIPT_BYTES;
        if (f.size > max) { setErr(`${f.name} is too big (${kb(f.size)}, at most ${kb(max)}).`); continue; }
        const e = await upload(kind, f.name, await readBase64(f));
        if (e) setErr(`${f.name}: ${e}`); else toast(`${f.name} sent. Click ⟳ on the deck to get it.`);
      } catch (x) { setErr(`${f.name}: ${x instanceof Error ? x.message : String(x)}`); }
    }
    setBusy(false);
  };

  const group = (kind: DeckFileKind, title: string) => {
    const mine = files.filter((f) => f.kind === kind);
    return (
      <Section title={title}>
        {mine.length === 0 ? <p className="text-xs text-ink-500">None sent from LifeOS yet.</p> : (
          <ul className="space-y-1.5">
            {mine.map((f) => (
              <li key={f.name} className="flex items-center gap-2 rounded-lg bg-cream-100 px-2 py-1.5 text-sm">
                {kind === 'picture'
                  ? <img src={pictureUrl(f.name)} alt="" className="h-7 w-7 rounded object-cover" />
                  : <span aria-hidden>{kind === 'sound' ? '🔊' : '📜'}</span>}
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.name}</span>
                <span className="text-xs text-ink-500">{kb(f.size)} · {ago(f.updatedAt)}</span>
                <ConfirmButton className="btn btn-ghost px-2 text-xs text-clay-600" confirmLabel="Delete?" onConfirm={async () => {
                  const e = await removeFile(kind, f.name); if (e) toast(e, 'error'); else toast(`Deleted ${f.name}`);
                }}>Delete</ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </Section>
    );
  };

  return (
    <div className="space-y-4 text-sm">
      <label className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-cream-300 p-4 text-center hover:border-moss-600 ${busy ? 'opacity-60' : ''}`}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files); }}>
        <span className="text-2xl" aria-hidden>📤</span>
        <span className="font-medium">{busy ? 'Sending…' : 'Drop sounds, scripts or pictures here, or click to choose'}</span>
        <span className="text-xs text-ink-500">Sounds .wav .mp3 .ogg up to 3 MB · scripts .ps1 .bat .cmd up to 64 KB · any picture (made square, {PICTURE_SIZE} px)</span>
        <input type="file" multiple className="sr-only" accept=".wav,.mp3,.ogg,.ps1,.bat,.cmd,image/*" disabled={busy} onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
      </label>
      {err && <p role="alert" className="text-xs text-clay-600">{err}</p>}
      {group('picture', 'Pictures')}
      {group('sound', 'Sounds')}
      {group('script', 'Scripts')}
      <p className="text-xs text-ink-500">
        The deck copies these into <code>Documents\LifeOS Deck</code> when it syncs (⟳), and removes them there when you delete them here.
        A file of the same name that you put in that folder yourself is never overwritten. Before running a script it has not run in
        this exact version, the deck shows you its first lines and asks. Keep passwords out of scripts sent here.
      </p>
    </div>
  );
}

/** Chrome's profiles by name and account, as the deck reported them; free text until the deck has connected. */
function ChromeProfilePicker({ value, profiles, onChange }: { value: string; profiles: ChromeProfile[]; onChange: (v: string) => void }) {
  if (!profiles.length) {
    return <input className="input" value={value} placeholder="Default" onChange={(e) => onChange(e.target.value)} />;
  }
  const known = profiles.some((p) => p.dir === value);
  return (
    <select className="input" value={known ? value : ''} onChange={(e) => onChange(e.target.value)}>
      {!known && <option value="">{value ? `${value} (not on the PC)` : 'Pick a profile…'}</option>}
      {profiles.map((p) => <option key={p.dir} value={p.dir}>{p.name}{p.account ? ` · ${p.account}` : ''} ({p.dir})</option>)}
    </select>
  );
}

/* ── connecting the deck ── */

function ConnectTab({ overview }: { overview: DeckOverview }) {
  const toast = useStore.getState().toast;
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const d = overview.deck;
  const mood = deckMood(overview);
  const reload = () => useDeck.getState().sync();

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr('Give the token a name, e.g. “Office PC”.');
    setBusy(true); setErr('');
    try { const t = await cloud.createDeckToken(name.trim()); setName(''); setFresh(t.token); await reload(); }
    catch (x) { setErr(messageOf(x)); } finally { setBusy(false); }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Couldn’t copy. Select it and copy it by hand.', 'error'); }
  };

  return (
    <div className="space-y-4 text-sm">
      <Section title="The deck on your PC">
        <div className="card space-y-1">
          {mood === 'unplugged' ? (
            <p className="text-ink-500">No deck has connected yet. Create a token below, then start the deck app on your PC.</p>
          ) : (
            <>
              <p><b>{mood === 'ready' ? '✓ Up to date' : '⟳ Not up to date'}</b> · last synced {ago(d.syncedAt)}{d.version && <span className="text-ink-500"> · deck {d.version}</span>}</p>
              {mood === 'outdated' && <p className="text-xs text-ink-500">You saved changes after that. Click ⟳ on the deck (or restart it) to load them.</p>}
              <p className="text-xs text-ink-500">On the PC: {d.scripts.length} script{d.scripts.length === 1 ? '' : 's'}, {d.sounds.length} sound{d.sounds.length === 1 ? '' : 's'}.</p>
            </>
          )}
          <p className="pt-1 text-xs text-ink-500">The deck only fetches its buttons when it starts and when you click ⟳, so it never keeps LifeOS awake.</p>
        </div>
      </Section>

      <Section title="Tokens">
        <div className="card space-y-3">
          {overview.tokens.length === 0 ? <p className="text-ink-500">No token yet.</p> : (
            <ul className="space-y-2" aria-label="Deck tokens">
              {overview.tokens.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-lg bg-cream-100 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.name} <span className="font-mono text-xs text-ink-400">…{t.hint}</span></div>
                    <div className="truncate text-xs text-ink-500">created {ago(t.createdAt)} · {t.lastUsedAt ? `last used ${ago(t.lastUsedAt)}` : 'never used'}</div>
                  </div>
                  <ConfirmButton className="btn btn-ghost text-xs text-clay-600" confirmLabel="Revoke?" onConfirm={async () => {
                    try { await cloud.revokeDeckToken(t.id); await reload(); toast(`Revoked “${t.name}”`); } catch (x) { toast(messageOf(x), 'error'); }
                  }}>Revoke</ConfirmButton>
                </li>
              ))}
            </ul>
          )}
          {fresh && (
            <div role="alert" className="space-y-2 rounded-lg border border-moss-600/40 bg-moss-600/10 p-3">
              <p className="font-medium">Copy this token now: it won’t be shown again.</p>
              <div className="flex gap-2">
                <input className="input font-mono text-xs" readOnly value={fresh} aria-label="New deck token" onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn" onClick={() => void copy(fresh)}>Copy</button>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => setFresh(null)}>I’ve saved it</button>
            </div>
          )}
          {overview.tokens.length < MAX_TOKENS ? (
            <form className="flex flex-wrap items-end gap-2" onSubmit={create}>
              <Field label="New token" className="min-w-[10rem] flex-1">
                <input className="input" value={name} maxLength={40} placeholder="Office PC" onChange={(e) => { setName(e.target.value); setErr(''); }} />
              </Field>
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : '＋ Create token'}</button>
            </form>
          ) : <p className="text-xs text-ink-500">You have {MAX_TOKENS} deck tokens, the most allowed. Revoke one to make another.</p>}
          {err && <p role="alert" className="text-xs text-clay-600">{err}</p>}
          <p className="text-xs text-ink-500">A deck token only fetches the buttons. It opens nothing else in LifeOS.</p>
        </div>
      </Section>

      <Section title="Set up">
        <ol className="card list-decimal space-y-1.5 pl-8 text-ink-700">
          <li>Install the deck: run <code>LifeOS-Deck-Setup.exe</code> (built in <code>lifeos-agent\deck</code> with <code>npm run dist</code>, in <code>release\</code>). It starts with Windows from then on.</li>
          <li>On first start the deck asks for the server <button type="button" className="font-mono text-xs underline" onClick={() => void copy(window.location.origin)}>{window.location.origin}</button> and a token from above.</li>
          <li>Send sounds and scripts from the <b>Files</b> tab (or drop them into <code>Documents\LifeOS Deck\scripts</code> and <code>…\sounds</code>), then click ⟳ on the deck.</li>
        </ol>
      </Section>
    </div>
  );
}
