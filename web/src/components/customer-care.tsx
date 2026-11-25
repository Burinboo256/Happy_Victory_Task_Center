'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { carePaths, spacePath } from '@/domain/space-link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  alertLevel,
  careLabels,
  dashboardFromRoster,
  eventKinds,
  insurance,
  outcomes,
  frequencies,
  paymentLabels,
  premiumAmountPattern,
  policyKinds,
  type CareEvent,
  type CareCounts,
  type CareDashboard,
  type CareRoster,
  type CarePolicy,
  type EventKind,
  type Outcome,
} from '@/domain/customer-care';
import { isManager, type Bootstrap } from '@/domain/model';
import { TaskForm, type TaskDraft, type TaskFormProps } from './task-form';
import { CustomerCareAlertGuide } from './customer-care-alert-guide';
import styles from './customer-care.module.css';

const thaiDate = new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Bangkok',
});
const thaiMonth = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' });
const dateLabel = (value: string) => thaiDate.format(new Date(value + 'T12:00:00+07:00'));
const endpoint = '/api/customer-care';
const requiredMark = (
  <span className="case-required-marker" aria-hidden="true">
    {' '}
    *
  </span>
);
const monthName = (month: number) => thaiMonth.format(new Date(Date.UTC(2000, month - 1, 1)));
function CareScheduleFields() {
  const [month, setMonth] = useState(''),
    [day, setDay] = useState(''),
    [frequency, setFrequency] = useState('');
  const days = month ? new Date(Date.UTC(2000, Number(month), 0)).getUTCDate() : 31;
  return (
    <>
      <fieldset className={styles.group}>
        <legend>
          ทบทวนความคุ้มครองประจำปี <small lang="en">Coverage Review</small>
        </legend>
        <label>
          วันทบทวนครั้งแรก
          <input type="date" name="reviewDate" />
          <small>เว้นว่างเพื่อใช้วันครบรอบกรมธรรม์</small>
        </label>
      </fieldset>
      <fieldset className={styles.group}>
        <legend>
          วันเกิดลูกค้า <small lang="en">Birthday</small>
        </legend>
        <div className={styles.birthdayPair}>
          <label>
            เดือนเกิด
            <select
              value={month}
              onChange={(e) => {
                const m = e.target.value;
                setMonth(m);
                if (!m || Number(day) > new Date(Date.UTC(2000, Number(m), 0)).getUTCDate())
                  setDay('');
              }}
            >
              <option value="">ยังไม่ระบุ</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={String(m).padStart(2, '0')}>
                  {monthName(m)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>วันที่เกิด{month && requiredMark}</span>
            <select
              disabled={!month}
              required={!!month}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            >
              <option value="">เลือกวัน</option>
              {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
                <option key={d} value={String(d).padStart(2, '0')}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input type="hidden" name="birthday" value={month && day ? month + '-' + day : ''} />
      </fieldset>
      <fieldset className={styles.group}>
        <legend>
          รอบชำระเบี้ย <small lang="en">Policy Status</small>
        </legend>
        <div className={styles.pair}>
          <label>
            ประเภทการชำระเงิน
            <select
              name="frequency"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
            >
              <option value="">ยังไม่ระบุ</option>
              {frequencies.map((f) => (
                <option key={f} value={f}>
                  {paymentLabels[f]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>วันชำระเบี้ยครั้งถัดไปตามเอกสาร{frequency && requiredMark}</span>
            <input type="date" name="premium" required={!!frequency} />
          </label>
          <label>
            ยอดเบี้ยที่ต้องชำระต่อรอบ (บาท)
            <input
              name="premiumAmount"
              inputMode="decimal"
              pattern={premiumAmountPattern.source}
              maxLength={13}
              placeholder="เช่น 12500.50"
              title="กรอกตัวเลขโดยไม่ใส่จุลภาค และระบุสตางค์ได้ไม่เกิน 2 ตำแหน่ง"
            />
          </label>
        </div>
      </fieldset>
    </>
  );
}
const emptyPolicies: CarePolicy[] = [];
const refreshInterval = 300000;
type Props = {
  spaceSlug: string;
  data: Bootstrap;
  request: <T>(url: string, options?: RequestInit) => Promise<T>;
  submittingTask: boolean;
  onSubmitTask: TaskFormProps['onSubmit'];
};
export function CustomerCare({ data, request, submittingTask, onSubmitTask, spaceSlug }: Props) {
  const [snapshot, setSnapshot] = useState<CareRoster | CareDashboard | null>(null),
    [selected, setSelected] = useState('');
  const feed = snapshot && 'policies' in snapshot ? snapshot : null;
  const tab = usePathname().split('/').at(-1);
  const scope = tab === 'register' ? null : tab === 'dashboard' ? 'dashboard' : 'roster';
  const params = useSearchParams();
  const group = eventKinds.find((kind) => kind === params.get('group'));
  function navigate(view: keyof typeof carePaths, kind?: EventKind) {
    const path = spacePath(spaceSlug, carePaths[view]) + (kind ? `?group=${kind}` : '');
    if (window.location.pathname + window.location.search !== path)
      window.history.pushState(null, '', path);
  }
  const [search, setSearch] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const [target, setTarget] = useState(''),
    [outcome, setOutcome] = useState<Outcome>('done');
  const [grouped, setGrouped] = useState(false);
  const [includeFuture, setIncludeFuture] = useState(false);
  const [ownerId, setOwnerId] = useState('');
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  useEffect(() => {
    const resetDetail = () => {
      setSelected('');
      setTarget('');
      setTaskDraft(null);
      setNotice('');
      setError('');
    };
    window.addEventListener('popstate', resetDetail);
    return () => window.removeEventListener('popstate', resetDetail);
  }, []);
  const pending = useRef<{ key: string; operation: string } | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const cached = useRef<{ scope: 'dashboard' | 'roster'; at: number; revision: number } | null>(
    null,
  );
  const [revision, setRevision] = useState(0);
  const reload = useCallback(
    async (force = true) => {
      if ((!scope && !force) || inFlight.current) return;
      const last = cached.current;
      if (
        !force &&
        last?.revision === revision &&
        (last.scope === scope || last.scope === 'roster') &&
        Date.now() - last.at < refreshInterval
      )
        return;
      const controller = new AbortController();
      inFlight.current = controller;
      try {
        if (!scope) {
          // Recheck access on focus or the refresh timer without downloading the roster for the form.
          await request(endpoint + '?scope=access', { signal: controller.signal });
          if (!controller.signal.aborted) {
            cached.current = null;
            setSnapshot(null);
            setError('');
          }
          return;
        }
        const result = await request<CareRoster | CareDashboard>(
          scope === 'dashboard' ? endpoint + '?scope=dashboard' : endpoint,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setSnapshot(result);
          cached.current = {
            scope: 'policies' in result ? 'roster' : 'dashboard',
            at: Date.now(),
            revision,
          };
          setError('');
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          cached.current = null;
          setSnapshot(null);
          setError(e instanceof Error ? e.message : 'โหลดรายการไม่สำเร็จ');
        }
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
      }
    },
    [request, scope, revision],
  );
  useEffect(() => {
    void reload(false);
    const refresh = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    const timer = window.setInterval(refresh, refreshInterval);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      inFlight.current?.abort();
      inFlight.current = null;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [reload]);
  const readonly = busy || !data.writesEnabled;
  const policy = feed?.policies.find((p) => p.id === selected);
  const ownerNames = useMemo(() => new Map(data.users.map((u) => [u.id, u.name])), [data.users]);
  const agentName = (id: string) => ownerNames.get(id) || 'ตัวแทนเจ้าของกรมธรรม์';
  const show = (id: string, event = '') => {
    setSelected(id);
    setTarget(event);
    setOutcome('done');
    navigate('policies');
    setError('');
    setNotice('');
  };
  async function save(values: Record<string, unknown>, after: (id: string) => void) {
    if (readonly) return;
    const key = JSON.stringify(values);
    if (pending.current?.key !== key) pending.current = { key, operation: crypto.randomUUID() };
    const operation = pending.current.operation;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': data.csrfToken },
        body: JSON.stringify({ ...values, operation }),
      });
      pending.current = null;
      inFlight.current?.abort();
      cached.current = null;
      setSnapshot(null);
      setRevision((value) => value + 1);
      after(operation);
      setNotice('บันทึกเรียบร้อยแล้ว');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  function form(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
  }
  const policies = feed?.policies ?? emptyPolicies;
  const ownerPolicies = useMemo(
    () => (ownerId ? policies.filter((p) => p.agentId === ownerId) : policies),
    [ownerId, policies],
  );
  const query = search.trim().toLowerCase();
  const matchingPolicies =
    tab === 'policies' && !policy
      ? ownerPolicies.filter((p) => `${p.customer} ${p.reference}`.toLowerCase().includes(query))
      : emptyPolicies;
  const today = snapshot?.today ?? data.today;
  const dashboard = useMemo(() => {
    if (tab !== 'dashboard' || !snapshot) return null;
    return 'owners' in snapshot ? snapshot : dashboardFromRoster(snapshot);
  }, [tab, snapshot]);
  const totals = useMemo(() => {
    const counts: CareCounts = { policies: 0, late: 0, groups: {} };
    for (const owner of dashboard?.owners ?? []) {
      if (ownerId && ownerId !== owner.agentId) continue;
      counts.policies += owner.policies;
      counts.late += owner.late;
      for (const kind of eventKinds)
        counts.groups[kind] = (counts.groups[kind] ?? 0) + (owner.groups[kind] ?? 0);
    }
    return counts;
  }, [dashboard, ownerId]);
  const includePlanned = grouped && includeFuture;
  const queue = useMemo(() => {
    const rows: { p: CarePolicy; e: CareEvent; level: ReturnType<typeof alertLevel> }[] = [];
    if (tab !== 'queue') return rows;
    for (const p of ownerPolicies) {
      if (p.closed) continue;
      for (const e of p.events) {
        if (e.outcome || (group && e.kind !== group)) continue;
        const level = alertLevel(e, today);
        if (level !== 'ตามแผน' || includePlanned) rows.push({ p, e, level });
      }
    }
    return rows.sort((a, b) => a.e.due.localeCompare(b.e.due));
  }, [tab, ownerPolicies, group, includePlanned, today]);
  const groups = useMemo(() => {
    const byKind: Partial<Record<EventKind, typeof queue>> = {};
    const byMonth: Partial<Record<number, typeof queue>> = {};
    if (grouped) {
      for (const row of queue) {
        const kind = row.e.kind;
        byKind[kind] ??= [];
        byKind[kind].push(row);
        if (kind === 'birthday') {
          const month = Number(row.p.birthday?.slice(0, 2) || 0);
          byMonth[month] ??= [];
          byMonth[month].push(row);
        }
      }
    }
    return { byKind, byMonth };
  }, [queue, grouped]);
  const recipient = (e: CareEvent) =>
    e.recipient === 'team' ? 'เลขา / ทีมดูแล' : 'ตัวแทนเจ้าของกรมธรรม์';
  function openTask(policy: CarePolicy, event: CareEvent) {
    const subject = careLabels[event.kind];
    setTaskDraft({
      careEventId: event.id,
      title: `${subject} · ${policy.customer}`,
      description: [
        subject,
        `กรมธรรม์ ${policy.reference}`,
        `วันนัดติดตาม ${dateLabel(event.due)}`,
        event.note,
      ]
        .filter(Boolean)
        .join('\n'),
      caseName: policy.customer,
      agentId: policy.agentId,
      category: event.kind === 'welcome' ? 'ลูกค้าใหม่' : 'ลูกค้าเก่า',
      dueDate: event.due,
    });
  }
  function reminderRow({ p, e, level }: (typeof queue)[number]) {
    return (
      <div key={e.id} className={styles.reminder}>
        <button type="button" className={styles.row} onClick={() => show(p.id, e.id)}>
          <strong>
            {p.customer} · {careLabels[e.kind]}
          </strong>
          <span className={level === 'เกินนัด' ? styles.late : undefined}>
            {level} · {dateLabel(e.due)}
          </span>
          <small>
            {p.reference} · {agentName(p.agentId)} · ผู้ติดตาม {recipient(e)}
          </small>
        </button>
        {e.taskId ? (
          <Link
            className={`btn small ${styles.existingTask}`}
            href={spacePath(spaceSlug, '/tasks/' + e.taskId)}
          >
            ดูงานที่เปิดแล้ว
          </Link>
        ) : (
          <button
            type="button"
            className="btn secondary small"
            disabled={readonly || e.taskPending}
            aria-label={`${e.taskPending ? 'กำลังตรวจสอบการเปิดงาน' : 'เปิดงานให้เลขา'} · ${careLabels[e.kind]} · ${p.customer}`}
            onClick={() => openTask(p, e)}
          >
            {e.taskPending ? 'กำลังตรวจสอบการเปิดงาน' : 'เปิดงานให้เลขา'}
          </button>
        )}
      </div>
    );
  }
  const ownerOptions = useMemo(() => {
    const ownerIds = new Set(
      data.users.filter((u) => u.role === 'Agent' && u.active).map((u) => u.id),
    );
    for (const p of policies) ownerIds.add(p.agentId);
    for (const o of dashboard?.owners ?? []) ownerIds.add(o.agentId);
    return [...ownerIds]
      .map((id) => ({ id, name: ownerNames.get(id) || id }))
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }, [data.users, policies, dashboard, ownerNames]);
  if (taskDraft) {
    return (
      <TaskForm
        data={data}
        busy={submittingTask}
        onSubmit={onSubmitTask}
        initial={taskDraft}
        cancel={
          <button type="button" className="btn" onClick={() => setTaskDraft(null)}>
            กลับคิวติดตาม
          </button>
        }
      />
    );
  }
  const ownerFilter = isManager(data.user) && (
    <label>
      ตัวแทนผู้ดูแล
      <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
        <option value="">ทุกตัวแทน</option>
        {ownerOptions.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className={styles.care}>
      <nav aria-label="เมนูดูแลลูกค้า">
        {(
          [
            ['dashboard', 'ภาพรวมการแจ้งเตือน'],
            ['queue', 'คิวแจ้งเตือน'],
            ['policies', 'ทะเบียนกรมธรรม์'],
            ['register', 'เพิ่มกรมธรรม์'],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={spacePath(spaceSlug, carePaths[key])}
            prefetch={false}
            className={'btn ' + (tab === key ? 'primary' : 'secondary')}
            aria-disabled={busy || undefined}
            aria-current={tab === key ? 'page' : undefined}
            onNavigate={(event) => {
              event.preventDefault();
              if (busy) return;
              navigate(key);
              setSelected('');
              setTarget('');
              setError('');
              setNotice('');
            }}
          >
            {label}
          </Link>
        ))}
      </nav>
      {error && (
        <div role="alert" className="form-error">
          {error}{' '}
          <button type="button" onClick={() => void reload()}>
            โหลดใหม่
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {scope && !(scope === 'dashboard' ? snapshot : feed) && !error && (
        <p role="status">กำลังโหลดกรมธรรม์…</p>
      )}
      {dashboard && (
        <article className="panel">
          <h2>สรุปการแจ้งเตือน · {dateLabel(dashboard.today)}</h2>
          {ownerFilter}
          <div className={styles.alertTotal}>
            <span>
              กรมธรรม์ทั้งหมด <strong>{totals.policies.toLocaleString('th-TH')} ฉบับ</strong>
            </span>
            <span>
              นัดที่ถึงช่วงแจ้งเตือน{' '}
              <strong>{Object.values(totals.groups).reduce((sum, n) => sum + n, 0)} นัด</strong>
            </span>
            <span className={styles.late}>เกินนัด {totals.late} นัด</span>
          </div>
          <ul className={styles.alertGroups} aria-label="จำนวนแจ้งเตือนตามกลุ่ม">
            {eventKinds.map((kind) => (
              <li key={kind}>
                <Link
                  href={spacePath(spaceSlug, carePaths.queue) + '?group=' + kind}
                  prefetch={false}
                  onNavigate={(event) => {
                    event.preventDefault();
                    setGrouped(false);
                    setIncludeFuture(false);
                    navigate('queue', kind);
                  }}
                >
                  <span>{careLabels[kind]}</span>
                  <strong>{totals.groups[kind] ?? 0} นัด</strong>
                </Link>
              </li>
            ))}
          </ul>
          <CustomerCareAlertGuide />
        </article>
      )}
      {feed && tab === 'queue' && (
        <article className="panel">
          <h2>คิวติดตาม · {dateLabel(feed.today)}</h2>
          {ownerFilter}
          {group && (
            <p>
              <b>{careLabels[group]}</b>
              {' · '}
              <Link
                href={spacePath(spaceSlug, carePaths.queue)}
                onNavigate={(event) => {
                  event.preventDefault();
                  navigate('queue');
                }}
              >
                ดูทุกกลุ่ม
              </Link>
            </p>
          )}
          <fieldset className={styles.queueViews} aria-label="มุมมองคิวแจ้งเตือน">
            <button type="button" aria-pressed={!grouped} onClick={() => setGrouped(false)}>
              ตามวันนัด
            </button>
            <button type="button" aria-pressed={grouped} onClick={() => setGrouped(true)}>
              แยกตามกลุ่ม
            </button>
          </fieldset>
          {grouped && (
            <label className={styles.futureToggle}>
              <input
                type="checkbox"
                checked={includeFuture}
                onChange={(e) => setIncludeFuture(e.target.checked)}
              />
              รวมนัดล่วงหน้าที่ยังไม่ถึงช่วงแจ้งเตือน
            </label>
          )}
          {queue.length === 0 ? (
            <p>{grouped && includeFuture ? 'ยังไม่มีนัดที่รอติดตาม' : 'ยังไม่มีนัดที่ถึงช่วงแจ้งเตือน'}</p>
          ) : grouped ? (
            eventKinds.map((kind) => {
              const rows = groups.byKind[kind];
              if (!rows?.length) return null;
              return (
                <details key={kind} className={styles.queueGroup}>
                  <summary>
                    {careLabels[kind]} <span>{rows.length} นัด</span>
                  </summary>
                  {kind === 'birthday'
                    ? [...Array.from({ length: 12 }, (_, i) => i + 1), 0].map((month) => {
                        const birthdays = groups.byMonth[month];
                        if (!birthdays?.length) return null;
                        return (
                          <section key={month}>
                            <h3>{month ? monthName(month) : 'ไม่ระบุเดือนเกิด'}</h3>
                            {birthdays.map(reminderRow)}
                          </section>
                        );
                      })
                    : rows.map(reminderRow)}
                </details>
              );
            })
          ) : (
            queue.map(reminderRow)
          )}
        </article>
      )}
      {feed && tab === 'policies' && !policy && (
        <article className="panel">
          <h2>ทะเบียนกรมธรรม์</h2>
          <div className={styles.grid}>
            {ownerFilter}
            <label>
              ค้นหาชื่อลูกค้าหรือรหัสอ้างอิง
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </div>
          {matchingPolicies.map((p) => (
            <button type="button" className={styles.row} key={p.id} onClick={() => show(p.id)}>
              <strong>
                {p.customer} · {insurance[p.kind][0]}
              </strong>
              <small>
                {p.reference} · {agentName(p.agentId)}
                {p.closed ? ' · สิ้นสุดการติดตาม' : ''}
              </small>
            </button>
          ))}
          {!matchingPolicies.length && <p>ไม่พบกรมธรรม์</p>}
        </article>
      )}
      {tab === 'register' && (
        <form
          className={styles.createForm}
          onSubmit={(e) => {
            const v = form(e);
            void save(
              {
                ...v,
                action: 'create',
                premium: v.premium || undefined,
                premiumAmount: v.premiumAmount || undefined,
                ends: v.ends || undefined,
                reviewDate: v.reviewDate || undefined,
                birthday: v.birthday || undefined,
                frequency: v.frequency || undefined,
              },
              (id) => show(id),
            );
          }}
        >
          <header className={styles.formHeading}>
            <h2>เพิ่มกรมธรรม์</h2>
            <small>{requiredMark} จำเป็นต้องกรอก</small>
          </header>
          <div className={styles.columns}>
            <section className={styles.formCard} aria-labelledby="policy-details">
              <h3 id="policy-details">ข้อมูลลูกค้าและกรมธรรม์</h3>
              <fieldset disabled={readonly} className={styles.group}>
                <legend>ลูกค้าและผู้ดูแล</legend>
                <label>
                  <span>ชื่อลูกค้า{requiredMark}</span>
                  <input name="customer" required maxLength={100} />
                </label>
                <label>
                  <span>ตัวแทนผู้ดูแล{requiredMark}</span>
                  <select
                    required
                    name="agentId"
                    defaultValue={isManager(data.user) ? '' : data.user.id}
                  >
                    <option value="" disabled>
                      เลือกตัวแทน
                    </option>
                    {data.users
                      .filter((u) => u.active && u.role === 'Agent')
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                </label>
              </fieldset>
              <fieldset disabled={readonly} className={styles.group}>
                <legend>รายละเอียดกรมธรรม์</legend>
                <div className={styles.pair}>
                  <label>
                    <span>รหัสอ้างอิงกรมธรรม์{requiredMark}</span>
                    <input name="reference" required maxLength={64} />
                  </label>
                  <label>
                    <span>ประเภทประกัน{requiredMark}</span>
                    <select name="kind" required>
                      {policyKinds.map((k) => (
                        <option key={k} value={k}>
                          {insurance[k][0]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>วันเริ่มกรมธรรม์{requiredMark}</span>
                    <input type="date" required name="started" />
                  </label>
                  <label>
                    วันครบสัญญาตามเอกสาร
                    <input type="date" name="ends" />
                  </label>
                </div>
              </fieldset>
            </section>
            <section className={styles.formCard} aria-labelledby="policy-care">
              <h3 id="policy-care">แผนติดตามลูกค้า</h3>
              <fieldset disabled={readonly} aria-labelledby="policy-care">
                <CareScheduleFields />
              </fieldset>
            </section>
          </div>
          <div className={styles.formActions}>
            <button type="submit" className="btn primary" disabled={readonly}>
              บันทึกและสร้างแผนติดตาม
            </button>
          </div>
        </form>
      )}
      {tab === 'policies' && policy && (
        <article className="panel" key={policy.id}>
          <button type="button" className="btn secondary small" onClick={() => setSelected('')}>
            กลับทะเบียน
          </button>
          <h2>
            {policy.customer} · {insurance[policy.kind][0]}
          </h2>
          <p>
            {policy.reference} · {agentName(policy.agentId)} · เริ่ม {dateLabel(policy.started)}
            {policy.ends ? ' · ครบสัญญา ' + dateLabel(policy.ends) : ''}
          </p>
          <p>
            <strong>สิ่งที่ควรติดตาม</strong> {insurance[policy.kind][1]}
          </p>
          <p>
            ทบทวนทุกปี ·{' '}
            {policy.reviewDate
              ? dateLabel(policy.reviewDate).replace(/\s+\d+$/, '')
              : 'วันครบรอบกรมธรรม์'}
            {policy.birthday &&
              ' · วันเกิด ' +
                Number(policy.birthday.slice(3)) +
                ' ' +
                monthName(Number(policy.birthday.slice(0, 2)))}
            {' · รอบชำระเบี้ย ' + (policy.frequency ? paymentLabels[policy.frequency] : 'ยังไม่ระบุ')}
            {policy.premiumAmount != null &&
              ` · ยอดเบี้ยต่อรอบ ${Number(policy.premiumAmount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`}
          </p>
          {policy.closed ? (
            <p>สิ้นสุดการติดตามแล้ว</p>
          ) : (
            <>
              <h3>แผนติดตาม</h3>
              {policy.events
                .filter((e) => !e.outcome)
                .map((e) => (
                  <div key={e.id}>
                    <button
                      type="button"
                      className={styles.row}
                      aria-expanded={target === e.id}
                      onClick={() => {
                        setTarget(target === e.id ? '' : e.id);
                        setOutcome('done');
                      }}
                    >
                      <strong>{careLabels[e.kind]}</strong>
                      <span>
                        {dateLabel(e.due)} · {recipient(e)}
                      </span>
                      {e.note && <small>{e.note}</small>}
                    </button>
                    {e.taskId && (
                      <Link
                        className={styles.existingTask}
                        href={spacePath(spaceSlug, '/tasks/' + e.taskId)}
                      >
                        ดูงานที่เปิดแล้ว
                      </Link>
                    )}
                    {target === e.id && (
                      <form
                        key={e.id}
                        onSubmit={(event) => {
                          const v = form(event);
                          void save(
                            {
                              action: 'finish',
                              policyId: policy.id,
                              eventId: e.id,
                              outcome,
                              note: v.note,
                              next: v.next || undefined,
                            },
                            () => setTarget(''),
                          );
                        }}
                      >
                        <fieldset disabled={readonly}>
                          <label>
                            ผลการติดตาม
                            <select
                              value={outcome}
                              onChange={(v) => setOutcome(v.target.value as Outcome)}
                            >
                              {Object.entries(outcomes).map(([id, name]) => (
                                <option value={id} key={id}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            สรุปการติดต่อ
                            <input
                              name="note"
                              maxLength={300}
                              placeholder="เช่น ลูกค้าขอนัดตัวแทนวันศุกร์"
                            />
                          </label>
                          <label>
                            {e.kind === 'premium' && outcome === 'done'
                              ? 'วันชำระรอบถัดไปที่ยืนยันแล้ว'
                              : 'วันนัดถัดไป'}
                            {outcome !== 'done' ? ' *' : ''}
                            <input
                              name="next"
                              type="date"
                              required={outcome !== 'done'}
                              min={feed?.today}
                            />
                          </label>
                          {outcome === 'done' &&
                            (e.kind === 'review' ||
                              e.kind === 'birthday' ||
                              (e.kind === 'premium' && policy.frequency)) && (
                              <small>
                                เว้นวันนัดถัดไปเพื่อให้ระบบสร้างนัดตามรอบ
                                {e.kind === 'premium' && policy.frequency
                                  ? paymentLabels[policy.frequency]
                                  : 'รายปี'}
                              </small>
                            )}
                          <button type="submit" className="btn primary">
                            บันทึกผล
                          </button>
                        </fieldset>
                      </form>
                    )}
                  </div>
                ))}
              <details>
                <summary>เพิ่มนัดติดตาม</summary>
                <form
                  onSubmit={(event) => {
                    const node = event.currentTarget,
                      v = form(event);
                    void save({ ...v, action: 'schedule', policyId: policy.id }, () =>
                      node.reset(),
                    );
                  }}
                >
                  <fieldset disabled={readonly} className={styles.grid}>
                    <label>
                      เรื่องที่ติดตาม
                      <select name="kind" defaultValue="life">
                        {eventKinds.map((k) => (
                          <option key={k} value={k}>
                            {careLabels[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      วันนัด *<input required type="date" name="due" />
                    </label>
                    <label>
                      ผู้ติดตาม
                      <select name="recipient">
                        <option value="team">เลขา / ทีมดูแล</option>
                        <option value="agent">ตัวแทนเจ้าของกรมธรรม์</option>
                      </select>
                    </label>
                    <label>
                      ประเด็นที่ลูกค้าต้องการให้ช่วย
                      <input name="note" maxLength={300} />
                    </label>
                    <button type="submit" className="btn primary">
                      เพิ่มนัด
                    </button>
                  </fieldset>
                </form>
              </details>
            </>
          )}
          <h3>ประวัติการดูแล</h3>
          {!policy.events.some((e) => e.outcome) && <p>ยังไม่มีผลการติดตาม</p>}
          {policy.events
            .filter(
              (e): e is CareEvent & { outcome: Outcome; completedAt: string } =>
                !!e.outcome && !!e.completedAt,
            )
            .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
            .map((e) => (
              <p key={e.id}>
                <strong>{careLabels[e.kind]}</strong> · {outcomes[e.outcome]} ·{' '}
                {thaiDate.format(new Date(e.completedAt))}
                {e.resultNote && ' · ' + e.resultNote}
                {e.taskId && (
                  <>
                    {' '}
                    ·{' '}
                    <Link
                      className={styles.existingTask}
                      href={spacePath(spaceSlug, '/tasks/' + e.taskId)}
                    >
                      ดูงานที่เปิดแล้ว
                    </Link>
                  </>
                )}
              </p>
            ))}
          {!policy.closed && isManager(data.user) && (
            <button
              type="button"
              disabled={readonly}
              className="btn secondary"
              onClick={() => {
                if (window.confirm('สิ้นสุดการติดตามกรมธรรม์นี้และหยุดแจ้งเตือนทุกนัด? ประวัติยังดูได้ในทะเบียน'))
                  void save({ action: 'close', policyId: policy.id }, () => setTarget(''));
              }}
            >
              สิ้นสุดการติดตามกรมธรรม์
            </button>
          )}
        </article>
      )}
    </section>
  );
}
