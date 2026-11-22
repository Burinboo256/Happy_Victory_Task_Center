'use client';
import { useCallback, useEffect, useState, useRef, type FormEvent } from 'react';
import Link from 'next/link';
import { Brand } from './brand';
import styles from './space-hub.module.css';
import { spacePath, registrationPath } from '@/domain/space-link';

type Space = {
  id: string;
  name: string;
  slug?: string;
  active: boolean;
  approved: boolean;
  role: string | null;
  baseId?: string;
  isDefault: boolean;
};
type State = { enabled: boolean; owner: boolean; csrfToken: string; items: Space[] };
type Member = {
  name: string;
  email: string;
  role: string;
  active: boolean;
  globallyActive: boolean;
  systemOwner?: boolean;
};
const fields = [
  ['AIRTABLE_BASE_ID', 'Base ID'],
  ['AIRTABLE_USERS_TABLE', 'Users Table ID'],
  ['AIRTABLE_TASKS_TABLE', 'Tasks Table ID'],
  ['AIRTABLE_UPDATES_TABLE', 'Task Updates Table ID'],
  ['AIRTABLE_FOLLOWUPS_TABLE', 'Follow-ups Table ID'],
  ['AIRTABLE_NOTIFICATIONS_TABLE', 'Notifications Table ID'],
  ['AIRTABLE_TOKEN', 'PAT ของ Base นี้ (records read/write)'],
] as const;
export function SpaceHub({ target, next = '/' }: { target?: string; next?: string }) {
  const creationId = useRef('');
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Space | null>(null),
    [members, setMembers] = useState<Member[]>([]);
  const [editing, setEditing] = useState<Member | null>(null);
  const load = useCallback(async () => {
    const response = await fetch('/api/spaces', { cache: 'no-store' });
    if (response.status === 401) {
      const returnTo = target
        ? '/spaces/open?' + new URLSearchParams({ space: target, next })
        : '/spaces';
      window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo));
      return;
    }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || 'โหลด Space ไม่สำเร็จ');
    setState(body);
  }, [target, next]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  async function act(action: string, id?: string, data?: unknown) {
    if (!state || busy) return false;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrfToken },
        body: JSON.stringify({ action, id, data }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || 'บันทึกไม่สำเร็จ');
      if (action === 'select') {
        window.location.assign(
          spacePath(state.items.find((s) => s.id === id)?.slug, target === id ? next : '/'),
        );
        return true;
      }
      setMessage('บันทึกเรียบร้อย');
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เชื่อมต่อไม่สำเร็จ');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function roster(space: Space) {
    setEditing(null);
    setSelected(space);
    setMembers([]);
    setError('');
    try {
      const response = await fetch('/api/spaces?members=' + space.id, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || 'โหลดสมาชิกไม่สำเร็จ');
      setMembers(body.members);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดสมาชิกไม่สำเร็จ');
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    const credentials = Object.fromEntries(
      fields.map(([key]) => [key, String(data.get(key) || '').trim()]),
    );
    creationId.current ||= crypto.randomUUID();
    const ok = await act('create', undefined, {
      requestId: creationId.current,
      name: data.get('name'),
      ...(data.get('slug') ? { slug: data.get('slug') } : {}),
      adminEmail: data.get('adminEmail'),
      schemaToken: String(data.get('schemaToken') || '').trim(),
      credentials,
    });
    // Secrets are never persisted in browser storage, URLs, or the returned API response.
    (form.elements.namedItem('AIRTABLE_TOKEN') as HTMLInputElement).value = '';
    (form.elements.namedItem('schemaToken') as HTMLInputElement).value = '';
    if (ok) {
      form.reset();
      creationId.current = '';
    }
  }
  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget,
      data = new FormData(form);
    if (
      await act('member', selected.id, {
        email: data.get('email'),
        name: data.get('name'),
        role: data.get('role'),
        active: data.get('active') === 'on',
      })
    ) {
      form.reset();
      await roster(selected);
    }
  }
  return (
    <main className={styles.hub}>
      <header>
        <Brand />
        <Link href="/">กลับหน้าทำงาน</Link>
      </header>
      <h1>{target ? 'เลือก Space ก่อนเปิดลิงก์' : 'Space ของคุณ'}</h1>
      <p>แต่ละ Space มีสมาชิก งาน และเอกสารของตนเอง การเลือกที่นี่ไม่เปลี่ยน Space สำหรับ LINE AI</p>
      {state?.owner && (
        <p>เจ้าของระบบเข้าได้ทุก Space ที่เปิดใช้งาน และจัดการ Admin กับสมาชิกของแต่ละ Space ได้</p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!state && !error && <p role="status">กำลังโหลด Space…</p>}
      {state && !state.enabled && <p>ระบบยังไม่เปิดใช้งานหลาย Space</p>}
      {state?.enabled && (
        <>
          {state.items.length === 0 && <p>ยังไม่มี Space ที่ได้รับเชิญ กรุณาขอลิงก์ลงทะเบียนจาก Admin ของทีม</p>}
          {target && !state.items.some((s) => s.id === target) && (
            <p role="alert">คุณไม่มีสิทธิ์เปิด Space ของลิงก์นี้</p>
          )}
          <div className={styles.grid}>
            {state.items
              .filter((s) => !target || s.id === target)
              .map((space) => (
                <section key={space.id} className={styles.card}>
                  <h2>{space.name}</h2>
                  {space.slug && (
                    <p>
                      <Link href={'/' + space.slug}>/{space.slug}</Link>{' '}
                      <button
                        type="button"
                        className="btn secondary small"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              window.location.origin + '/' + space.slug,
                            );
                            setMessage('คัดลอกลิงก์ Space แล้ว');
                          } catch {
                            setError('คัดลอกไม่สำเร็จ กรุณาคัดลอกจากลิงก์ชื่อ Space');
                          }
                        }}
                      >
                        คัดลอกลิงก์
                      </button>
                    </p>
                  )}
                  <p>
                    {state.owner ? 'เจ้าของระบบ' : space.role || 'สมาชิก'} ·{' '}
                    {!space.active
                      ? 'พักใช้งาน'
                      : state.owner || space.approved
                        ? 'พร้อมใช้งาน'
                        : 'รออนุมัติ'}
                  </p>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy || !space.active || (!state.owner && !space.approved)}
                    onClick={() => void act('select', space.id)}
                  >
                    เข้า Space
                  </button>
                  {(state.owner || (space.role === 'Admin' && space.approved && space.active)) && (
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={busy}
                      onClick={() => void roster(space)}
                    >
                      {state.owner ? 'จัดการ Admin / สมาชิก' : 'จัดการสมาชิก'}
                    </button>
                  )}
                  {state.owner && (
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={busy}
                      onClick={() => void act('status', space.id, { active: !space.active })}
                    >
                      {space.active ? 'พัก Space' : 'เปิด Space'}
                    </button>
                  )}
                  {(state.owner || space.role === 'Admin') && (
                    <p>
                      <Link href={registrationPath(space.slug, space.id)}>
                        ลิงก์ลงทะเบียนของ Space นี้
                      </Link>
                    </p>
                  )}
                </section>
              ))}
          </div>
          {selected && (
            <section className={styles.card}>
              <h2>สมาชิก: {selected.name}</h2>
              <p>บทบาทและการอนุมัติมีผลเฉพาะ Space นี้ บัญชีที่ถูกปิดทั้งระบบต้องให้เจ้าของระบบตรวจสอบ</p>
              <div className={styles.table}>
                <table>
                  <thead>
                    <tr>
                      <th>สมาชิก</th>
                      <th>บทบาท</th>
                      <th>สถานะ</th>
                      <th>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.email}>
                        <td>
                          {m.name}
                          <br />
                          {m.email}
                        </td>
                        <td>{m.systemOwner ? 'เจ้าของระบบ' : m.role}</td>
                        <td>{!m.globallyActive ? 'ปิดทั้งระบบ' : m.active ? 'ใช้งาน' : 'รออนุมัติ/ปิด'}</td>
                        <td>
                          <button
                            type="button"
                            className="btn secondary small"
                            disabled={busy || !m.globallyActive || m.systemOwner}
                            onClick={async () => {
                              if (
                                await act('member', selected.id, {
                                  email: m.email,
                                  role: m.role,
                                  active: !m.active,
                                })
                              )
                                await roster(selected);
                            }}
                          >
                            {m.active ? 'ปิดสมาชิก' : 'อนุมัติ'}
                          </button>
                          <button
                            type="button"
                            className="btn secondary small"
                            disabled={busy || !m.globallyActive || m.systemOwner}
                            onClick={() => setEditing(m)}
                          >
                            แก้ไขบทบาท
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <form
                key={selected.id + ':' + (editing?.email || 'new')}
                onSubmit={saveMember}
                className={styles.form}
              >
                <h3>{editing ? 'แก้ไขบทบาทสมาชิก' : 'เพิ่มสมาชิกหรือเปลี่ยนบทบาท'}</h3>
                <p>
                  เลือก Admin เพื่อให้จัดการ Space นี้ได้ ต้องมี Admin ที่ใช้งานได้อย่างน้อยหนึ่งคนก่อนถอน Admin เดิม
                </p>
                <label>
                  อีเมล Google
                  <input
                    type="email"
                    name="email"
                    required
                    defaultValue={editing?.email || ''}
                    readOnly={!!editing}
                  />
                </label>
                <label>
                  ชื่อ (สำหรับผู้ใช้ใหม่)
                  <input name="name" maxLength={120} />
                </label>
                <label>
                  บทบาท
                  <select name="role" defaultValue={editing?.role || 'Agent'}>
                    <option>Agent</option>
                    <option>Secretary</option>
                    <option>Admin</option>
                  </select>
                </label>
                <label>
                  <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} />{' '}
                  อนุมัติให้ใช้งาน Space นี้
                </label>
                <button type="submit" className="btn primary" disabled={busy}>
                  บันทึกสมาชิก
                </button>
                {editing && (
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => setEditing(null)}
                  >
                    ยกเลิกแก้ไข
                  </button>
                )}
              </form>
            </section>
          )}
          {state.owner && !target && (
            <section className={styles.card}>
              <h2>สร้าง Space ใหม่</h2>
              <p>
                เตรียม Airtable Base ว่างตาม schema ก่อน ระบบจะตรวจตารางและตั้ง Admin ให้ ส่วน PAT
                จะเก็บเข้ารหัสบนเซิร์ฟเวอร์
              </p>
              <form onSubmit={create} className={styles.form} autoComplete="off">
                <label>
                  ชื่อ Space
                  <input name="name" required maxLength={80} />
                </label>
                <label>
                  ชื่อสำหรับ URL (อังกฤษ เช่น rinlyn-team)
                  <input
                    name="slug"
                    maxLength={48}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    placeholder="เว้นว่างเพื่อสร้างจากชื่อ Space"
                  />
                  <small>ชื่อซ้ำจะเติมเลขท้าย ลิงก์คงเดิมเมื่อเปลี่ยนชื่อ Space</small>
                </label>
                <label>
                  อีเมล Google ของ Admin
                  <input name="adminEmail" type="email" required />
                </label>
                {fields.map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      name={key}
                      type={key === 'AIRTABLE_TOKEN' ? 'password' : 'text'}
                      required
                      autoComplete="off"
                    />
                  </label>
                ))}
                <label>
                  PAT ตรวจ schema (schema.bases:read ใช้ครั้งนี้ ไม่บันทึก)
                  <input name="schemaToken" type="password" required autoComplete="off" />
                </label>
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'กำลังดำเนินการ…' : 'ตรวจ Base และสร้าง Space'}
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </main>
  );
}
