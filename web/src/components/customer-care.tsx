'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { carePaths, spacePath } from '@/domain/space-link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  alertLevel,
  careLabels,
  eventKinds,
  insurance,
  outcomes,
  frequencies,
  paymentLabels,
  premiumAmountPattern,
  policyKinds,
  type CareEvent,
  type CarePolicy,
  type EventKind,
  type Outcome,
} from '@/domain/customer-care';
import { isManager, type Bootstrap } from '@/domain/model';
import { TaskForm, type TaskDraft, type TaskFormProps } from './task-form';
import styles from './customer-care.module.css';

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(
    new Date(value + 'T12:00:00+07:00'),
  );
const endpoint = '/api/customer-care';
const requiredMark = (
  <span className="case-required-marker" aria-hidden="true">
    {' '}
    *
  </span>
);
const monthName = (month: number) =>
  new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, month - 1, 1)),
  );
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
type Feed = { policies: CarePolicy[]; today: string };
type Props = {
  spaceSlug: string;
  data: Bootstrap;
  request: (url: string, options?: RequestInit) => Promise<Feed>;
  submittingTask: boolean;
  onSubmitTask: TaskFormProps['onSubmit'];
};
export function CustomerCare({ data, request, submittingTask, onSubmitTask, spaceSlug }: Props) {
  const [feed, setFeed] = useState<Feed | null>(null),
    [selected, setSelected] = useState('');
  const pathname = usePathname();
  const tab =
    pathname === spacePath(spaceSlug, carePaths.overview) ? 'overview' : pathname.split('/').at(-1);
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
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const n = ++latest.current;
    try {
      const result = await request(endpoint);
      if (n === latest.current) {
        setFeed(result);
        setError('');
      }
    } catch (e) {
      if (n === latest.current) {
        setFeed(null);
        setError(e instanceof Error ? e.message : 'โหลดรายการไม่สำเร็จ');
      }
    }
  }, [request]);
  useEffect(() => {
    void reload();
    const refresh = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    const timer = window.setInterval(refresh, 300000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      latest.current++;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [reload]);
  const readonly = busy || !data.writesEnabled;
  const policy = feed?.policies.find((p) => p.id === selected);
  const agentName = (id: string) =>
    data.users.find((u) => u.id === id)?.name || 'ตัวแทนเจ้าของกรมธรรม์';
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
      after(operation);
      await reload();
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
  const policies = feed?.policies ?? [];
  const ownerPolicies = ownerId ? policies.filter((p) => p.agentId === ownerId) : policies;
  const query = search.trim().toLowerCase();
  const matchingPolicies = ownerPolicies.filter((p) =>
    `${p.customer} ${p.reference}`.toLowerCase().includes(query),
  );
  const appointments = ownerPolicies
    .filter((p) => !p.closed)
    .flatMap((p) =>
      p.events
        .filter((e) => !e.outcome)
        .map((e) => ({ p, e, level: alertLevel(e, feed?.today ?? data.today) })),
    )
    .sort((a, b) => a.e.due.localeCompare(b.e.due));
  const alerts = appointments.filter((r) => r.level !== 'ตามแผน');
  const visibleAppointments = grouped && includeFuture ? appointments : alerts;
  const queue = group
    ? visibleAppointments.filter(({ e }) => e.kind === group)
    : visibleAppointments;
  const recipient = (e: CareEvent) =>
    e.recipient === 'team' ? 'เลขา / ทีมดูแล' : 'ตัวแทนเจ้าของกรมธรรม์';
  function openTask(policy: CarePolicy, event: CareEvent) {
    const subject = careLabels[event.kind];
    setTaskDraft({
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
        <button
          type="button"
          className="btn secondary small"
          disabled={readonly}
          aria-label={`เปิดงานให้เลขา · ${careLabels[e.kind]} · ${p.customer}`}
          onClick={() => openTask(p, e)}
        >
          เปิดงานให้เลขา
        </button>
      </div>
    );
  }
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
  const ownerNames = new Map(data.users.map((u) => [u.id, u.name]));
  const ownerIds = new Set([
    ...data.users.filter((u) => u.role === 'Agent' && u.active).map((u) => u.id),
    ...policies.map((p) => p.agentId),
  ]);
  const ownerOptions = [...ownerIds]
    .map((id) => ({ id, name: ownerNames.get(id) || id }))
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));
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
            ['overview', 'ภาพรวมการแจ้งเตือน'],
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
      {!feed && !error && <p role="status">กำลังโหลดกรมธรรม์…</p>}
      {feed && tab === 'overview' && (
        <article className="panel">
          <h2>สรุปการแจ้งเตือน · {dateLabel(feed.today)}</h2>
          {ownerFilter}
          <div className={styles.alertTotal}>
            <span>
              นัดที่ถึงช่วงแจ้งเตือน <strong>{alerts.length} นัด</strong>
            </span>
            <span className={styles.late}>
              เกินนัด {alerts.filter(({ level }) => level === 'เกินนัด').length} นัด
            </span>
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
                  <strong>{alerts.filter(({ e }) => e.kind === kind).length} นัด</strong>
                </Link>
              </li>
            ))}
          </ul>
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
              const rows = queue.filter(({ e }) => e.kind === kind);
              if (!rows.length) return null;
              return (
                <details key={kind} className={styles.queueGroup}>
                  <summary>
                    {careLabels[kind]} <span>{rows.length} นัด</span>
                  </summary>
                  {kind === 'birthday'
                    ? [...Array.from({ length: 12 }, (_, i) => i + 1), 0].map((month) => {
                        const birthdays = rows.filter(
                          ({ p }) => Number(p.birthday?.slice(0, 2) || 0) === month,
                        );
                        if (!birthdays.length) return null;
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
      {feed && tab === 'register' && (
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
                {new Intl.DateTimeFormat('th-TH', {
                  timeZone: 'Asia/Bangkok',
                  dateStyle: 'medium',
                }).format(new Date(e.completedAt))}
                {e.resultNote && ' · ' + e.resultNote}
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
