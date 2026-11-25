'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  alertLevel,
  careLabels,
  eventKinds,
  insurance,
  outcomes,
  frequencies,
  paymentLabels,
  policyKinds,
  type CareEvent,
  type CarePolicy,
  type Outcome,
} from '@/domain/customer-care';
import { isManager, type Bootstrap } from '@/domain/model';
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
        </div>
      </fieldset>
    </>
  );
}
type Feed = { policies: CarePolicy[]; today: string };
type Props = { data: Bootstrap; request: (url: string, options?: RequestInit) => Promise<Feed> };
export function CustomerCare({ data, request }: Props) {
  const [feed, setFeed] = useState<Feed | null>(null),
    [selected, setSelected] = useState(''),
    [tab, setTab] = useState<'queue' | 'policies' | 'create'>('queue');
  const [search, setSearch] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const [target, setTarget] = useState(''),
    [outcome, setOutcome] = useState<Outcome>('done');
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
    setTab('policies');
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
  const queue = (feed?.policies || [])
    .filter((p) => !p.closed)
    .flatMap((p) =>
      p.events
        .filter((e) => !e.outcome)
        .map((e) => ({ p, e, level: alertLevel(e, feed?.today ?? data.today) })),
    )
    .filter((r) => r.level !== 'ตามแผน')
    .sort((a, b) => a.e.due.localeCompare(b.e.due));
  const recipient = (e: CareEvent) =>
    e.recipient === 'team' ? 'เลขา / ทีมดูแล' : 'ตัวแทนเจ้าของกรมธรรม์';
  return (
    <section className={styles.care}>
      <nav aria-label="เมนูดูแลลูกค้า">
        {(
          [
            ['queue', 'คิวแจ้งเตือน'],
            ['policies', 'ทะเบียนกรมธรรม์'],
            ['create', 'เพิ่มกรมธรรม์'],
          ] as const
        ).map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={'btn ' + (tab === key ? 'primary' : 'secondary')}
            disabled={busy}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setSelected('');
              setTarget('');
              setError('');
              setNotice('');
            }}
          >
            {label}
          </button>
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
      {feed && tab === 'queue' && (
        <article className="panel">
          <h2>คิวติดตาม · {dateLabel(feed.today)}</h2>
          {queue.length === 0 ? (
            <p>ยังไม่มีนัดที่ถึงช่วงแจ้งเตือน</p>
          ) : (
            queue.map(({ p, e, level }) => (
              <button
                type="button"
                key={e.id}
                className={styles.row}
                onClick={() => show(p.id, e.id)}
              >
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
            ))
          )}
        </article>
      )}
      {feed && tab === 'policies' && !policy && (
        <article className="panel">
          <h2>ทะเบียนกรมธรรม์</h2>
          <label>
            ค้นหาชื่อลูกค้าหรือรหัสอ้างอิง
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {feed.policies
            .filter((p) =>
              (p.customer + ' ' + p.reference).toLowerCase().includes(search.trim().toLowerCase()),
            )
            .map((p) => (
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
          {!feed.policies.some((p) =>
            (p.customer + ' ' + p.reference).toLowerCase().includes(search.trim().toLowerCase()),
          ) && <p>ไม่พบกรมธรรม์</p>}
        </article>
      )}
      {feed && tab === 'create' && (
        <form
          className={styles.createForm}
          onSubmit={(e) => {
            const v = form(e);
            void save(
              {
                ...v,
                action: 'create',
                premium: v.premium || undefined,
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
