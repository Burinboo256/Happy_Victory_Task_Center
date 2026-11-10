'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Brand } from './brand';
import { CategoryBadge, PriorityBadge, categoryClass } from './task-appearance';
import { OnboardingPanel, OnboardingSettings } from './onboarding';
import { CaseWorkflowPanel } from './case-workflow';
import { LineSettings } from './line-settings';
import {
  isManager,
  isOpen,
  statusNames,
  priorityNames,
  statuses,
  priorities,
  type Bootstrap,
  type Detail,
  type Task,
  type TaskSummary,
} from '@/domain/model';

export type Page =
  | 'dashboard'
  | 'tasks'
  | 'inbox'
  | 'followups'
  | 'calendar'
  | 'reports'
  | 'team'
  | 'history'
  | 'notifications'
  | 'new'
  | 'detail';
const names: Record<Page, string> = {
  dashboard: 'ภาพรวมงาน',
  tasks: 'รายการงาน',
  inbox: 'งานเข้าใหม่',
  followups: 'งานที่ต้องติดตาม',
  calendar: 'ปฏิทินงาน',
  reports: 'รายงาน',
  team: 'ทีมของเรา',
  history: 'ประวัติงาน',
  notifications: 'แจ้งเตือน LINE',
  new: 'ส่งงานใหม่',
  detail: 'รายละเอียดงาน',
};
const nav: { page: Page; href: string; symbol: string; manager?: boolean; agent?: boolean }[] = [
  { page: 'dashboard', href: '/', symbol: '◫' },
  { page: 'tasks', href: '/tasks', symbol: '▤' },
  { page: 'inbox', href: '/inbox', symbol: '↙', manager: true },
  { page: 'followups', href: '/followups', symbol: '◷' },
  { page: 'calendar', href: '/calendar', symbol: '▦' },
  { page: 'reports', href: '/reports', symbol: '▥', manager: true },
  { page: 'team', href: '/team', symbol: '♧', manager: true },
  { page: 'history', href: '/history', symbol: '✓', agent: true },
  { page: 'notifications', href: '/notifications', symbol: '♧' },
];
const fmtDate = (value: string, full = false) =>
  value
    ? new Intl.DateTimeFormat('th-TH', {
        day: 'numeric',
        month: full ? 'long' : 'short',
        ...(full ? { year: 'numeric' } : {}),
        timeZone: 'Asia/Bangkok',
      }).format(new Date(value.length === 10 ? value + 'T12:00:00+07:00' : value))
    : 'ยังไม่กำหนด';
const fmtDateTime = (value: string) =>
  !value || value.length === 10
    ? fmtDate(value, true)
    : fmtDate(value, true) +
      ' · ' +
      new Intl.DateTimeFormat('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: 'Asia/Bangkok',
      }).format(new Date(value)) +
      ' น.';
const safeHref = (value: string) => {
  try {
    return new URL(value).protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
};
function Badge({ status }: { status: Task['status'] }) {
  return (
    <span className={'badge status-' + status.replaceAll(' ', '-').toLowerCase()}>
      {statusNames[status]}
    </span>
  );
}
function Empty({
  title = 'ยังไม่มีรายการงาน',
  message = 'เริ่มส่งงานใหม่ แล้วติดตามความคืบหน้าได้ที่นี่',
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="empty">
      <span aria-hidden="true">▤</span>
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

export function Workspace({
  page,
  taskId,
  initialStatus = 'all',
}: {
  page: Page;
  taskId?: string;
  initialStatus?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<Bootstrap | null>(null),
    [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState('all'),
    [status, setStatus] = useState(initialStatus),
    [agent, setAgent] = useState('all'),
    [priority, setPriority] = useState('all');
  const [month, setMonth] = useState('');
  const [pageIndex, setPageIndex] = useState(0),
    [viewMode, setViewMode] = useState<'list' | 'cards'>('list');
  const [mobile, setMobile] = useState(false);
  const hasWorkspace = data !== null;
  const loadSequence = useRef(0);
  const sidebarRef = useRef<HTMLDivElement>(null),
    menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => {
      setMobile(media.matches);
      if (!media.matches) setMenu(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobile || !menu || !hasWorkspace) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const focusable = () =>
      Array.from(sidebar.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)')).filter(
        (element) => element.getClientRects().length > 0,
      );
    focusable()[0]?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenu(false);
      }
      if (event.key !== 'Tab') return;
      const elements = focusable(),
        first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      } else if (!sidebar.contains(document.activeElement)) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      requestAnimationFrame(() => menuButtonRef.current?.focus());
    };
  }, [mobile, menu, hasWorkspace]);
  const menuAccessibility = mobile
    ? {
        role: 'dialog' as const,
        'aria-label': 'เมนูพื้นที่ทำงาน',
        'aria-modal': menu ? true : undefined,
      }
    : { role: 'complementary' as const, 'aria-label': 'เมนูพื้นที่ทำงาน' };
  const destination =
    page === 'detail'
      ? '/tasks/' + taskId
      : page === 'new'
        ? '/tasks/new'
        : nav.find((n) => n.page === page)?.href || '/';
  const request = useCallback(
    async (url: string, options?: RequestInit) => {
      let response: Response;
      try {
        response = await fetch(url, {
          ...options,
          cache: 'no-store',
          credentials: 'same-origin',
        });
      } catch (error) {
        if (options?.signal?.aborted) throw error;
        throw new Error('เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง');
      }
      if (response.status === 401) {
        setData(null);
        setDetail(null);
        router.replace('/login?returnTo=' + encodeURIComponent(destination));
        throw new Error('กรุณาเข้าสู่ระบบอีกครั้ง');
      }
      const body = await response.json().catch(() => {
        throw new Error('ระบบตอบกลับไม่สมบูรณ์ กรุณาลองอีกครั้ง');
      });
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new Error('ระบบตอบกลับไม่สมบูรณ์ กรุณาลองอีกครั้ง');
      if (response.status === 403 && body.error?.code === 'FORBIDDEN') {
        setData(null);
        setDetail(null);
      }
      if (!response.ok) throw new Error(body.error?.message || 'เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง');
      return body;
    },
    [router, destination],
  );
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const sequence = ++loadSequence.current;
      try {
        const value: Bootstrap = await request(
          ['new', 'detail', 'notifications'].includes(page)
            ? '/api/bootstrap?scope=context'
            : '/api/bootstrap',
          { signal },
        );
        const nextDetail = taskId ? await request('/api/tasks/' + taskId, { signal }) : null;
        if (signal?.aborted || sequence !== loadSequence.current) return;
        setData(value);
        setDetail(nextDetail);
        setError('');
        setMonth((current) => current || value.today.slice(0, 7));
      } catch (e) {
        if (!signal?.aborted && sequence === loadSequence.current) {
          setData(null);
          setDetail(null);
          setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
        }
      }
    },
    [request, taskId, page],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function submit(
    event: FormEvent<HTMLFormElement>,
    endpoint: string,
    fixed: Record<string, unknown> = {},
  ) {
    event.preventDefault();
    if (!data || busy) return;
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    const payload = { ...fields, ...fixed };
    if ('internal' in payload) {
      payload.visible = payload.internal !== 'on';
      delete payload.internal;
    }
    const body = JSON.stringify(payload);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const fingerprint = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
      const storageKey = 'hvr-request:' + data.user.id + ':' + endpoint + ':' + fingerprint;
      const previous = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      const key = previous?.fingerprint === fingerprint ? previous.key : crypto.randomUUID();
      sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint, key }));
      const deadline = Date.now() + 35000;
      while (true) {
        const result = await request(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': data.csrfToken,
            'Idempotency-Key': key,
          },
          body,
        });
        if (result.state === 'completed') {
          sessionStorage.removeItem(storageKey);
          form.reset();
          setMessage(endpoint === '/api/tasks' ? 'ส่งงานเรียบร้อยแล้ว' : 'บันทึกเรียบร้อยแล้ว');
          if (endpoint === '/api/tasks') {
            router.push('/tasks/' + result.id);
            return;
          }
          await load();
          return;
        }
        if (result.state === 'review')
          throw new Error(
            'คำขอ ' + result.operationId + ' รอผู้ดูแลตรวจสอบผลบันทึก กรุณาอย่าส่งเป็นคำขอใหม่',
          );
        if (Date.now() > deadline)
          throw new Error('ระบบยังบันทึกไม่ครบ คุณลองกดบันทึกข้อมูลเดิมอีกครั้งได้โดยไม่สร้างคำขอใหม่');
        setMessage('กำลังบันทึกและตรวจสอบข้อมูล กรุณารอสักครู่…');
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
      setMessage('');
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await request('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': data?.csrfToken || '' },
      });
      router.replace('/login');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ออกจากระบบไม่สำเร็จ');
    }
  }
  if (!data)
    return (
      <main className="loading-page">
        <Brand />
        <h1>{error ? 'ไม่สามารถโหลดข้อมูลได้' : 'พื้นที่ทำงานของคุณ'}</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="btn" type="button" onClick={() => void load()}>
              ลองอีกครั้ง
            </button>
            <Link href="/login">กลับไปเข้าสู่ระบบ</Link>
          </>
        ) : (
          <p role="status">กำลังเตรียมพื้นที่ทำงานของคุณ…</p>
        )}
      </main>
    );
  const manager = isManager(data.user),
    userName = (id: string) => data.users.find((u) => u.id === id)?.name || 'Agent';
  const late = (task: TaskSummary) => isOpen(task) && !!task.dueDate && task.dueDate < data.today;
  const following = (task: TaskSummary) =>
    (isOpen(task) || task.continuingFollowup) &&
    !!task.followupDate &&
    task.followupDate <= data.today;
  const openTasks = data.tasks.filter(isOpen),
    newTasks = data.tasks.filter((t) => t.status === 'New'),
    pendingTasks = openTasks.filter((t) => t.status !== 'New'),
    followups = data.tasks.filter(following),
    completed = data.tasks.filter((t) => t.status === 'Completed');
  const matchesStatus = (task: TaskSummary, filter: string) =>
    filter === 'all' ||
    (filter === 'open'
      ? isOpen(task) && task.status !== 'New'
      : filter === 'late'
        ? late(task)
        : filter === 'follow'
          ? following(task)
          : task.status === filter);
  const scopedTasks = data.tasks.filter(
    (t) =>
      (page === 'inbox'
        ? t.status === 'New'
        : page === 'followups'
          ? (isOpen(t) || t.continuingFollowup) && !!t.followupDate
          : page === 'history'
            ? !isOpen(t)
            : true) &&
      (agent === 'all' || t.agentId === agent) &&
      (priority === 'all' || t.priority === priority) &&
      (category === 'all' || t.category === category) &&
      `${t.code} ${t.title} ${t.description} ${userName(t.agentId)}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const rows = scopedTasks
    .filter((t) => matchesStatus(t, status))
    .sort((a, b) =>
      page === 'followups'
        ? a.followupDate.localeCompare(b.followupDate) ||
          priorities.indexOf(b.priority) - priorities.indexOf(a.priority)
        : Number(isOpen(b) && b.priority === 'Urgent') -
            Number(isOpen(a) && a.priority === 'Urgent') ||
          Number(late(b)) - Number(late(a)) ||
          (a.dueDate || '9999').localeCompare(b.dueDate || '9999'),
    );
  const pageCount = Math.max(1, Math.ceil(rows.length / 7)),
    currentPage = Math.min(pageIndex, pageCount - 1);
  const visibleRows = rows.slice(currentPage * 7, (currentPage + 1) * 7);
  const categoryLegend = (
    <div className="category-controls">
      <p>
        สีตามประเภทงาน · กดสีเพื่อกรองงาน <span className="priority priority-urgent">! ด่วนมาก</span> =
        ควรทำก่อน
      </p>
      <fieldset className="category-legend" aria-label="กรองประเภทงานตามสี">
        <button
          type="button"
          className="category-key category-general"
          aria-pressed={category === 'all'}
          onClick={() => {
            setCategory('all');
            setPageIndex(0);
          }}
        >
          ทุกประเภท
        </button>
        {data.categories.map((name) => (
          <button
            key={name}
            type="button"
            className={'category-key ' + categoryClass(name)}
            aria-pressed={category === name}
            onClick={() => {
              setCategory(name);
              setPageIndex(0);
            }}
          >
            {name}
          </button>
        ))}
      </fieldset>
    </div>
  );
  const list = (
    <section className="panel">
      <div className="panel-title">
        <div>
          <h2>
            {page === 'followups' ? 'รายการนัดติดตาม' : manager ? 'รายการงานทั้งหมด' : 'รายการงานของฉัน'}
          </h2>
          <small>{rows.length} รายการ · ดูแลทุกงานให้เป็นไปตามแผน</small>
        </div>
        <fieldset className="view-switch" aria-label="รูปแบบรายการ">
          <button
            type="button"
            aria-label="แสดงรายการ"
            aria-pressed={viewMode === 'list'}
            onClick={() => setViewMode('list')}
          >
            ▤
          </button>
          <button
            type="button"
            aria-label="แสดงการ์ด"
            aria-pressed={viewMode === 'cards'}
            onClick={() => setViewMode('cards')}
          >
            ◫
          </button>
        </fieldset>
      </div>
      <div className="tabbar">
        {[
          ['all', 'ทั้งหมด'],
          ['New', 'งานเข้าใหม่'],
          ['open', 'คงค้าง'],
          ['Completed', 'เสร็จสิ้น'],
          ['Cancelled', 'ยกเลิก'],
          ...(['In Progress', 'Waiting', 'On Hold'].includes(status)
            ? [[status, statusNames[status as Task['status']]]]
            : []),
          ...(['late', 'follow'].includes(status)
            ? [[status, status === 'late' ? 'เกินกำหนด' : 'ต้องติดตามวันนี้']]
            : []),
        ].map(([key, label]) => (
          <button
            key={key}
            className={status === key ? 'active' : ''}
            aria-pressed={status === key}
            type="button"
            onClick={() => {
              setStatus(key);
              setPageIndex(0);
            }}
          >
            {label}{' '}
            <span className="tab-count">
              {scopedTasks.filter((t) => matchesStatus(t, key)).length}
            </span>
          </button>
        ))}
      </div>
      {categoryLegend}
      <div className="filters">
        <input
          aria-label="ค้นหางาน"
          type="search"
          placeholder="ค้นหาชื่องาน รหัสงาน หรือ Agent…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPageIndex(0);
          }}
        />
        {manager && (
          <select
            aria-label="กรอง Agent"
            value={agent}
            onChange={(e) => {
              setAgent(e.target.value);
              setPageIndex(0);
            }}
          >
            <option value="all">Agent ทั้งหมด</option>
            {data.users
              .filter((u) => u.role === 'Agent')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        )}
        <select
          aria-label="กรองความเร่งด่วน"
          value={priority}
          onChange={(e) => {
            setPriority(e.target.value);
            setPageIndex(0);
          }}
        >
          <option value="all">ทุกความเร่งด่วน</option>
          {priorities.map((p) => (
            <option key={p} value={p}>
              {priorityNames[p]}
            </option>
          ))}
        </select>
      </div>
      {rows.length ? (
        <div className={'task-list ' + viewMode}>
          {visibleRows.map((t) => (
            <Link
              className={
                'task-row ' +
                categoryClass(t.category) +
                (isOpen(t) && t.priority === 'Urgent' ? ' urgency-urgent' : '')
              }
              key={t.id}
              href={'/tasks/' + t.id}
            >
              <span className="task-title">
                <strong>{t.title}</strong>
                {t.workflowSummary && <small>{t.workflowSummary}</small>}
                <small>{t.code}</small>
                <CategoryBadge category={t.category} />
              </span>
              {manager && <span className="task-agent">{userName(t.agentId)}</span>}
              <Badge status={t.status} />
              <PriorityBadge priority={t.priority} />
              <span className={late(t) ? 'late' : 'task-date'}>
                {fmtDate(page === 'followups' ? t.followupDate : t.dueDate)}
              </span>
              <span aria-hidden="true">›</span>
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="ไม่พบงานในรายการนี้" message="ลองเปลี่ยนคำค้นหาหรือตัวกรอง หรือส่งงานใหม่ได้เลย" />
      )}
      <div className="pagination">
        <span>
          {rows.length ? currentPage * 7 + 1 : 0}–{Math.min((currentPage + 1) * 7, rows.length)} จาก{' '}
          {rows.length} รายการ
        </span>
        <div>
          <button
            className="icon-btn"
            type="button"
            aria-label="หน้าก่อนหน้า"
            disabled={currentPage === 0}
            onClick={() => setPageIndex(currentPage - 1)}
          >
            ‹
          </button>
          <span>
            {currentPage + 1} / {pageCount}
          </span>
          <button
            className="icon-btn"
            type="button"
            aria-label="หน้าถัดไป"
            disabled={currentPage + 1 === pageCount}
            onClick={() => setPageIndex(currentPage + 1)}
          >
            ›
          </button>
        </div>
      </div>
    </section>
  );
  const stats = (
    <div className="stats">
      {[
        { label: 'งานเข้าใหม่', count: newTasks.length, symbol: '↙', filter: 'New' },
        { label: 'งานคงค้าง', count: pendingTasks.length, symbol: '▤', filter: 'open' },
        { label: 'ต้องติดตามวันนี้', count: followups.length, symbol: '◷', filter: 'follow' },
        {
          label: 'งานเกินกำหนด',
          count: data.tasks.filter(late).length,
          symbol: '△',
          filter: 'late',
        },
        { label: 'งานเสร็จสิ้น', count: completed.length, symbol: '✓', filter: 'Completed' },
      ].map((stat) => (
        <Link className="stat" key={stat.label} href={'/tasks?status=' + stat.filter}>
          <span>{stat.label}</span>
          <span className="stat-icon" aria-hidden="true">
            {stat.symbol}
          </span>
          <strong>{String(stat.count).padStart(2, '0')}</strong>
          <small>{stat.label === 'งานเสร็จสิ้น' ? 'ปิดงานเรียบร้อยแล้ว' : 'ดูแลทุกความคืบหน้าไปด้วยกัน'}</small>
        </Link>
      ))}
    </div>
  );
  const content = () => {
    if (page === 'notifications')
      return (
        <div className="panel line-settings-panel">
          <LineSettings data={data} request={request} />
        </div>
      );
    if (page === 'new')
      return (
        <section className="panel form-panel">
          <div className="panel-title">
            <div>
              <h2>รายละเอียดงานใหม่</h2>
              <small>NEW TASK · เริ่มต้นความคืบหน้าใหม่</small>
            </div>
          </div>
          <form className="task-form" onSubmit={(e) => void submit(e, '/api/tasks')}>
            <fieldset disabled={busy || !data.writesEnabled}>
              <label>
                ชื่องาน *
                <input
                  name="title"
                  required
                  maxLength={180}
                  placeholder="เช่น ติดตามเอกสารกรมธรรม์ลูกค้า"
                />
              </label>
              <label>
                รายละเอียดงาน *
                <textarea
                  name="description"
                  required
                  maxLength={5000}
                  rows={5}
                  placeholder="รายละเอียดที่ต้องการให้เลขาฯ ช่วยดำเนินการ"
                />
              </label>
              {manager && (
                <label>
                  Agent เจ้าของงาน *
                  <select name="agentId" required defaultValue="">
                    <option value="">เลือก Agent</option>
                    {data.users
                      .filter((u) => u.role === 'Agent' && u.active)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <div className="form-row">
                <label>
                  ประเภทงาน
                  <select name="category">
                    {data.categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  ความเร่งด่วน
                  <select name="priority" defaultValue="Normal">
                    {priorities.map((p) => (
                      <option key={p} value={p}>
                        {priorityNames[p]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                กำหนดส่ง *<input type="date" name="dueDate" defaultValue={data.today} required />
              </label>
              <label>
                ลิงก์เอกสารอ้างอิง
                <input
                  type="url"
                  name="referenceUrl"
                  pattern="https://.*"
                  maxLength={2000}
                  placeholder="https://…"
                />
                <small>ใส่ลิงก์เอกสารที่ทีมมีสิทธิ์เข้าถึง · ไฟล์แนบจัดการผ่าน Airtable</small>
              </label>
              <div className="form-actions">
                <Link className="btn" href="/tasks">
                  ยกเลิก
                </Link>
                <button className="btn primary" type="submit">
                  {busy ? 'กำลังส่งงาน…' : '+ ส่งงานให้เลขาฯ'}
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      );
    if (page === 'detail') {
      if (!detail) return <Empty title="กำลังโหลดรายละเอียด…" message="" />;
      const task = detail.task;
      return (
        <section className="panel form-panel">
          <div className="panel-title">
            <div>
              <small>{task.code}</small>
              <h2>{task.title}</h2>
            </div>
            <Badge status={task.status} />
          </div>
          <div className="detail-body">
            <p className="detail-description">{task.description}</p>
            <dl className="detail-grid">
              <div>
                <dt>Agent เจ้าของงาน</dt>
                <dd>{userName(task.agentId)}</dd>
              </div>
              <div>
                <dt>ความเร่งด่วน</dt>
                <dd>
                  <PriorityBadge priority={task.priority} />
                </dd>
              </div>
              <div>
                <dt>กำหนดส่ง</dt>
                <dd className={late(task) ? 'late' : ''}>{fmtDate(task.dueDate, true)}</dd>
              </div>
              <div>
                <dt>นัดติดตามถัดไป</dt>
                <dd>{fmtDate(task.followupDate, true)}</dd>
              </div>
              <div>
                <dt>ประเภทงาน</dt>
                <dd>
                  <CategoryBadge category={task.category} />
                </dd>
              </div>
              <div>
                <dt>วันที่ส่งงาน</dt>
                <dd>{fmtDate(task.createdAt, true)}</dd>
              </div>
            </dl>
            {safeHref(task.referenceUrl) && (
              <a
                className="attachment"
                href={safeHref(task.referenceUrl)}
                target="_blank"
                rel="noopener noreferrer"
              >
                ↗ เปิดเอกสารอ้างอิง
              </a>
            )}
            {task.attachments
              .filter((a) => safeHref(a.url))
              .map((a) => (
                <a
                  key={a.url}
                  className="attachment"
                  href={safeHref(a.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ↗ {a.name}
                </a>
              ))}
            {detail.caseWorkflow && (
              <CaseWorkflowPanel
                key={`${task.id}:case:${detail.caseWorkflow.version}`}
                view={detail.caseWorkflow}
                taskId={task.id}
                editable={manager && task.status !== 'Cancelled' && data.writesEnabled}
                closed={task.status === 'Completed'}
                busy={busy}
                submit={submit}
              />
            )}
            {detail.workflow && (
              <details open={!detail.caseWorkflow || undefined}>
                <summary>ประวัติ Workflow ตัวแทนใหม่เดิม</summary>
                <OnboardingPanel
                  key={`${task.id}:${detail.workflow.version}:${detail.workflow.templateVersion}`}
                  view={detail.workflow}
                  taskId={task.id}
                  editable={!detail.caseWorkflow && manager && isOpen(task) && data.writesEnabled}
                  busy={busy}
                  submit={submit}
                />
              </details>
            )}
            {manager && (
              <>
                <h3>อัปเดตสถานะงาน</h3>
                <form
                  className="task-form compact"
                  onSubmit={(e) =>
                    void submit(e, `/api/tasks/${task.id}/status`, { version: task.version })
                  }
                >
                  <fieldset disabled={busy || !data.writesEnabled}>
                    <label>
                      สถานะ
                      <select name="status" defaultValue={task.status} key={task.version}>
                        {statuses.map((s) => (
                          <option
                            key={s}
                            value={s}
                            disabled={
                              s === 'Completed' &&
                              (detail.caseWorkflow
                                ? !detail.caseWorkflow.summary.complete
                                : !!detail.workflow && !detail.workflow.summary.complete)
                            }
                          >
                            {statusNames[s]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      สรุปความคืบหน้า<small>Agent มองเห็น</small>
                      <textarea name="message" maxLength={2000} rows={3} />
                    </label>
                    <div className="form-actions">
                      <button className="btn primary small" type="submit">
                        บันทึกสถานะ
                      </button>
                    </div>
                  </fieldset>
                </form>
                <h3>
                  นัดติดตาม <small>บันทึกภายในทีมเลขาฯ</small>
                </h3>
                {detail.followups.map((f) => (
                  <div className="followup-detail" key={f.id}>
                    <strong>
                      {fmtDate(f.date)} ·{' '}
                      {f.status === 'Pending'
                        ? 'รอติดตาม'
                        : f.status === 'Done'
                          ? 'ติดตามแล้ว'
                          : 'ข้ามนัด'}
                    </strong>
                    <p>{f.notes}</p>
                    {f.status === 'Pending' && (
                      <form
                        className="task-form compact"
                        onSubmit={(e) =>
                          void submit(e, `/api/tasks/${task.id}/followups/${f.id}/resolve`)
                        }
                      >
                        <fieldset disabled={busy || !data.writesEnabled}>
                          <label>
                            ผลการติดตาม / เหตุผล *<input name="notes" required maxLength={2000} />
                          </label>
                          <div className="form-row">
                            <select name="status" aria-label="ผลการดำเนินการ">
                              <option value="Done">ติดตามแล้ว</option>
                              <option value="Skipped">ข้ามนัดนี้</option>
                            </select>
                            <button className="btn small" type="submit">
                              บันทึกผล
                            </button>
                          </div>
                        </fieldset>
                      </form>
                    )}
                  </div>
                ))}
                {isOpen(task) && (
                  <form
                    className="task-form compact"
                    onSubmit={(e) => void submit(e, `/api/tasks/${task.id}/followups`)}
                  >
                    <fieldset disabled={busy || !data.writesEnabled}>
                      <div className="form-row">
                        <label>
                          วันนัดติดตามใหม่ *
                          <input type="date" name="date" defaultValue={data.today} required />
                        </label>
                        <label>
                          เรื่องที่ต้องติดตาม
                          <input name="notes" maxLength={2000} />
                        </label>
                      </div>
                      <div className="form-actions">
                        <button className="btn small" type="submit">
                          + เพิ่มนัดติดตาม
                        </button>
                      </div>
                    </fieldset>
                  </form>
                )}
              </>
            )}
            <h3>
              ความคืบหน้าและการสนทนา <small>{detail.updates.length} รายการ</small>
            </h3>
            <div className="timeline">
              {detail.updates.length ? (
                detail.updates.map((u) => (
                  <article key={u.id}>
                    <small>
                      {fmtDateTime(u.createdAt)}
                      {!u.visible && ' · บันทึกภายใน'}
                    </small>
                    <strong>{u.actor}</strong>
                    <p>{u.message}</p>
                  </article>
                ))
              ) : (
                <p className="muted">ยังไม่มีความคืบหน้า</p>
              )}
            </div>
            <form
              className="task-form compact"
              onSubmit={(e) => void submit(e, `/api/tasks/${task.id}/comments`)}
            >
              <fieldset disabled={busy || !data.writesEnabled}>
                <label>
                  เพิ่มข้อความหรือข้อมูลประกอบ
                  <textarea
                    name="message"
                    required
                    maxLength={3000}
                    rows={3}
                    placeholder="เขียนข้อความถึงทีม…"
                  />
                </label>
                {manager && (
                  <label className="check-label">
                    <input type="checkbox" name="internal" />
                    บันทึกภายใน · Agent มองไม่เห็น
                  </label>
                )}
                <div className="form-actions">
                  <button className="btn primary small" type="submit">
                    ส่งข้อความ
                  </button>
                </div>
              </fieldset>
            </form>
          </div>
        </section>
      );
    }
    if (page === 'reports' || page === 'team') {
      if (!manager)
        return <Empty title="เฉพาะเลขาฯ และผู้ดูแลระบบ" message="เลือกเมนูงานของฉันเพื่อดูรายการที่คุณมีสิทธิ์" />;
      return page === 'team' ? (
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>สมาชิกในพื้นที่ทำงาน</h2>
              <small>ผู้ดูแลจัดการบัญชีและสิทธิ์จากตาราง Users ใน Airtable</small>
            </div>
          </div>
          <div className="team-grid">
            {data.users.map((u) => (
              <article className="team-person" key={u.id}>
                <span className="avatar">{u.name.slice(0, 2)}</span>
                <div>
                  <strong>{u.name}</strong>
                  <small>
                    {u.role} · {u.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                  </small>
                </div>
              </article>
            ))}
          </div>
          {data.user.role === 'Admin' && (
            <details>
              <summary>ตั้งค่า Workflow รุ่นเดิม (เก็บไว้สำหรับประวัติ)</summary>
              <p>งานใหม่ใช้ขั้นตอนตาม 6 ประเภทงาน การตั้งค่าด้านล่างใช้กับประวัติ Workflow เดิมเท่านั้น</p>
              <OnboardingSettings
                key={data.syncedAt}
                request={request}
                submit={submit}
                disabled={busy || !data.writesEnabled}
              />
            </details>
          )}
          <LineSettings data={data} request={request} />
        </section>
      ) : (
        <>
          {stats}
          <section className="panel">
            <div className="panel-title">
              <h2>งานคงค้างแยกตาม Agent</h2>
            </div>
            <div className="report-content">
              {data.users
                .filter((u) => u.role === 'Agent')
                .map((u) => {
                  const n = pendingTasks.filter((t) => t.agentId === u.id).length;
                  return (
                    <div className="report-row" key={u.id}>
                      <span>{u.name}</span>
                      <progress
                        aria-label={'งานคงค้างของ ' + u.name}
                        value={n}
                        max={Math.max(pendingTasks.length, 1)}
                      />
                      <strong>{n} งาน</strong>
                    </div>
                  );
                })}
            </div>
          </section>
          <section className="panel">
            <div className="panel-title">
              <h2>สัดส่วนสถานะงาน</h2>
            </div>
            <div className="report-content">
              {statuses.map((s) => (
                <div className="report-row" key={s}>
                  <span>{statusNames[s]}</span>
                  <progress
                    aria-label={'จำนวนงานสถานะ' + statusNames[s]}
                    value={data.tasks.filter((t) => t.status === s).length}
                    max={Math.max(1, data.tasks.length)}
                  />
                  <strong>{data.tasks.filter((t) => t.status === s).length} งาน</strong>
                </div>
              ))}
            </div>
          </section>
        </>
      );
    }
    if (page === 'calendar') {
      if (!month) return null;
      const [year, m] = month.split('-').map(Number),
        days = new Date(Date.UTC(year, m, 0)).getUTCDate(),
        blanks = new Date(Date.UTC(year, m - 1, 1)).getUTCDay();
      return (
        <section className="panel">
          <div className="calendar-head">
            <button
              className="btn small"
              type="button"
              aria-label="เดือนก่อนหน้า"
              onClick={() => setMonth(new Date(Date.UTC(year, m - 2, 1)).toISOString().slice(0, 7))}
            >
              ‹
            </button>
            <h2>
              {new Intl.DateTimeFormat('th-TH', {
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              }).format(new Date(month + '-01T00:00:00Z'))}
            </h2>
            <button
              className="btn small"
              type="button"
              aria-label="เดือนถัดไป"
              onClick={() => setMonth(new Date(Date.UTC(year, m, 1)).toISOString().slice(0, 7))}
            >
              ›
            </button>
          </div>
          {categoryLegend}
          <div className="calendar-priority-filter">
            <label>
              ความเร่งด่วนในปฏิทิน
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="all">ทุกความเร่งด่วน</option>
                {priorities.map((p) => (
                  <option key={p} value={p}>
                    {priorityNames[p]}
                  </option>
                ))}
              </select>
            </label>
            <p>แถบสีและชื่อบอกประเภทงาน · ป้ายแดงและกรอบแดงบอกงานด่วนมาก · เลื่อนปฏิทินซ้าย–ขวาได้</p>
          </div>
          <section className="calendar-scroll" aria-label="ปฏิทินงานรายเดือน เลื่อนซ้ายขวา">
            <div className="calendar-grid">
              {['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'].map((day) => (
                <div className="calendar-label" key={day}>
                  {day}
                </div>
              ))}
              {Array.from({ length: blanks }, (_, i) =>
                new Date(Date.UTC(year, m - 1, i - blanks + 1)).toISOString(),
              ).map((date) => (
                <div className="calendar-day blank" key={date} />
              ))}
              {Array.from({ length: days }, (_, i) => {
                const date = month + '-' + String(i + 1).padStart(2, '0');
                return (
                  <div
                    className={'calendar-day' + (date === data.today ? ' today' : '')}
                    key={date}
                  >
                    <strong>{i + 1}</strong>
                    {openTasks
                      .filter(
                        (t) =>
                          (t.dueDate === date || t.followupDate === date) &&
                          (category === 'all' || t.category === category) &&
                          (priority === 'all' || t.priority === priority),
                      )
                      .sort(
                        (a, b) =>
                          priorities.indexOf(b.priority) - priorities.indexOf(a.priority) ||
                          a.title.localeCompare(b.title),
                      )
                      .map((t) => (
                        <Link
                          className={
                            'calendar-event ' +
                            categoryClass(t.category) +
                            (t.priority === 'Urgent' ? ' urgency-urgent' : '')
                          }
                          href={'/tasks/' + t.id}
                          key={t.id}
                        >
                          <span className="calendar-event-category">
                            {t.category || 'ไม่ระบุประเภท'}
                          </span>
                          <strong>{t.title}</strong>
                          <PriorityBadge priority={t.priority} />
                          <span className="calendar-event-date-kind">
                            {t.dueDate === date ? 'กำหนดส่ง' : ''}
                            {t.dueDate === date && t.followupDate === date ? ' · ' : ''}
                            {t.followupDate === date ? 'นัดติดตาม' : ''}
                          </span>
                        </Link>
                      ))}
                  </div>
                );
              })}
            </div>
          </section>
        </section>
      );
    }
    return page === 'dashboard' ? (
      <>
        {stats}
        <div className="dashboard-grid">
          <div>{list}</div>
          <aside aria-label="สรุปนัดและความคืบหน้า">
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h2>
                    ต้องติดตามวันนี้ <span className="count">{followups.length}</span>
                  </h2>
                  <small>เรื่องสำคัญที่รอการดูแลจากคุณ</small>
                </div>
                <span aria-hidden="true">◷</span>
              </div>
              {followups.length ? (
                followups.slice(0, 4).map((t) => (
                  <Link
                    className={
                      'followup-item ' +
                      categoryClass(t.category) +
                      (t.priority === 'Urgent' ? ' urgency-urgent' : '')
                    }
                    key={t.id}
                    href={'/tasks/' + t.id}
                  >
                    <strong>{t.title}</strong>
                    <CategoryBadge category={t.category} /> <PriorityBadge priority={t.priority} />
                    <small>
                      {t.code} · {fmtDate(t.followupDate)}
                    </small>
                  </Link>
                ))
              ) : (
                <Empty title="ไม่มีนัดค้างวันนี้" message="ทุกนัดติดตามได้รับการดูแลแล้ว" />
              )}
              <Link className="panel-bottom" href="/followups">
                ดูนัดติดตามทั้งหมด →
              </Link>
            </section>
            <section className="panel progress-panel">
              <h2>ค่อย ๆ ไป ให้ถึงเป้าหมาย ✦</h2>
              <p>ความคืบหน้าของงานทั้งหมด</p>
              <strong>
                {Math.round(
                  (completed.length /
                    Math.max(1, data.tasks.filter((t) => t.status !== 'Cancelled').length)) *
                    100,
                )}
                <small>%</small>
              </strong>
              <progress
                aria-label="ความคืบหน้าของงานทั้งหมด"
                value={completed.length}
                max={Math.max(1, data.tasks.filter((t) => t.status !== 'Cancelled').length)}
              />
              <small>
                {completed.length} / {data.tasks.length} งานเสร็จสิ้น
              </small>
            </section>
          </aside>
        </div>
      </>
    ) : (
      list
    );
  };
  return (
    <div className="workspace-app">
      <a className="skip-link" href="#page-content" hidden={mobile && menu}>
        ข้ามไปเนื้อหา
      </a>
      <div
        ref={sidebarRef}
        id="workspace-menu"
        className={'sidebar' + (menu ? ' open' : '')}
        inert={mobile && !menu}
        {...menuAccessibility}
      >
        <button
          className="icon-btn sidebar-close"
          type="button"
          aria-label="ปิดเมนู"
          onClick={() => setMenu(false)}
        >
          ×
        </button>
        <Brand />
        <div className="workspace-label">
          <span aria-hidden="true">▦</span>
          <div>
            <strong>Happy Victory Team</strong>
            <small>พื้นที่ทำงานร่วมกัน</small>
          </div>
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="เมนูหลัก">
          {nav
            .filter((n) => (!n.manager || manager) && (!n.agent || !manager))
            .map((n) => (
              <Link
                className={page === n.page ? 'active' : ''}
                aria-current={page === n.page ? 'page' : undefined}
                href={n.href}
                onClick={() => setMenu(false)}
                key={n.page}
              >
                <span aria-hidden="true">{n.symbol}</span>
                {n.page === 'tasks' && !manager ? 'งานของฉัน' : names[n.page]}
                {n.page === 'inbox' && data.tasksIncluded && (
                  <small>{data.tasks.filter((t) => t.status === 'New').length}</small>
                )}
              </Link>
            ))}
        </nav>
        <div className="sidebar-note">
          <span>✦ A little progress, every day.</span>
          <strong>ทุกงานสำคัญ ทุกความคืบหน้ามีค่า</strong>
          <p>
            เริ่มจากงานเล็ก ๆ แล้วเราจะเดินหน้า
            <br />
            ไปถึงเป้าหมายด้วยกัน
          </p>
        </div>
        <div className="profile">
          <span className="avatar">{data.user.name.slice(0, 2)}</span>
          <div>
            <strong>{data.user.name}</strong>
            <small>
              {data.user.role === 'Admin'
                ? 'ผู้ดูแลระบบ'
                : manager
                  ? 'เลขาฯ · ดูแลงานทั้งหมด'
                  : 'Agent · งานของฉัน'}
            </small>
          </div>
          <button
            className="icon-btn"
            type="button"
            onClick={() => void logout()}
            aria-label="ออกจากระบบ"
          >
            ↪
          </button>
        </div>
      </div>
      <main className="main" inert={mobile && menu}>
        <header className="topbar">
          <div>
            <button
              className="icon-btn mobile-menu"
              type="button"
              aria-label="เปิดเมนู"
              aria-expanded={menu}
              aria-controls="workspace-menu"
              ref={menuButtonRef}
              onClick={() => setMenu(!menu)}
            >
              ☰
            </button>
            <span className="muted">Workspace</span>
            <span className="breadcrumb-arrow">›</span>
            <span>{names[page]}</span>
          </div>
          <div className="top-actions">
            <span className="date-label">{fmtDate(data.today)}</span>
            <button
              className="icon-btn"
              type="button"
              onClick={() => void load()}
              aria-label="โหลดข้อมูลล่าสุด"
            >
              ↻
            </button>
            <span className="avatar">{data.user.name.slice(0, 2)}</span>
          </div>
        </header>
        <div className="content" id="page-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === 'dashboard' ? 'YOUR DAY, AT A GLANCE' : 'HAPPY VICTORY RINLYN'}
              </span>
              <h1>
                {page === 'dashboard'
                  ? 'สวัสดี, ' + data.user.name.split(' ')[0] + ' ☀'
                  : names[page]}
              </h1>
              <p>
                {page === 'new'
                  ? 'บอกสิ่งที่ต้องการให้ช่วย แล้วเราจะเดินหน้าไปด้วยกัน'
                  : 'ทุกความคืบหน้า อยู่ในพื้นที่เดียวกัน'}
              </p>
            </div>
            {page !== 'new' && (
              <Link className="btn primary" href="/tasks/new">
                + ส่งงานใหม่
              </Link>
            )}
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {message && (
            <div className="success-message" role="status">
              {message}
            </div>
          )}
          {!data.writesEnabled && (
            <div className="maintenance-notice" role="status">
              ขณะนี้เปิดให้ดูข้อมูล การส่งงานและบันทึกจะเปิดให้ใช้งานเมื่อผู้ดูแลพร้อม
            </div>
          )}
          {content()}
          <footer className="footer">
            <span>
              <strong>Happy Victory Rinlyn</strong> Task Center
            </span>
            <span>
              <i />
              อัปเดต{' '}
              {new Intl.DateTimeFormat('th-TH', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Bangkok',
              }).format(new Date(data.syncedAt))}{' '}
              น.
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
