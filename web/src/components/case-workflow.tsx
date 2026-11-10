'use client';
import { useState, type FormEvent } from 'react';
import {
  caseDefinitions,
  caseSummary,
  validateCaseState,
  type CaseView,
} from '@/domain/case-workflow';
export function CaseWorkflowPanel({
  view,
  taskId,
  editable,
  closed,
  busy,
  submit,
}: {
  view: CaseView;
  taskId: string;
  editable: boolean;
  closed: boolean;
  busy: boolean;
  submit: (
    event: FormEvent<HTMLFormElement>,
    endpoint: string,
    fixed?: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const [state, setState] = useState(view.state),
    [error, setError] = useState('');
  const definition = caseDefinitions[view.category],
    summary = state ? caseSummary(state) : view.summary;
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const first = view.summary.sections.find((section) => section.done < section.total);
    return first ? { [first.id]: true } : {};
  });
  const [dateEditors, setDateEditors] = useState<Record<string, boolean>>({});
  const dirty = JSON.stringify(state) !== JSON.stringify(view.state);
  const displayDate = (date: string) =>
    new Intl.DateTimeFormat('th-TH', {
      day: 'numeric',
      month: 'short',
      year: '2-digit',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(date + 'T00:00:00+07:00'));
  const field = (id: string, value: string) =>
    setState((old) => (old ? { ...old, fields: { ...old.fields, [id]: value } } : old));
  return (
    <section className="workflow case-workflow" aria-label={'ขั้นตอนงาน ' + view.category}>
      <h3>ขั้นตอนงาน · {view.category}</h3>
      <p>
        รายการบังคับ {summary.requiredDone}/{summary.requiredTotal} ·{' '}
        {summary.complete ? 'พร้อมปิดงานหลัก' : 'ยังมีรายการบังคับหรือข้อมูลที่ต้องบันทึก'}
      </p>
      {!state && (
        <ul>
          {summary.sections.map((s) => (
            <li key={s.id}>
              {s.title}: {s.done}/{s.total}
            </li>
          ))}
        </ul>
      )}
      {state && (
        <>
          <p>บันทึกข้อมูลเฉพาะเคสนี้ เจ้าของเคสคือ Agent ที่ระบุในงาน ข้อมูลประกอบเห็นเฉพาะทีมเลขา/ผู้ดูแล</p>
          {closed && (
            <p>งานหลักปิดแล้ว ยังบันทึกรายการติดตามต่อและทางเลือกได้ หากแก้รายการบังคับ ให้เปิดงานอีกครั้งก่อน</p>
          )}
          <aside className="case-next" aria-label="งานติดตามถัดไป">
            <strong>ติดตามถัดไป</strong>
            <p>{summary.nextLabel || 'ยังไม่มีรายการที่ตั้งวันติดตาม'}</p>
            {summary.nextDate && (
              <time dateTime={summary.nextDate}>{displayDate(summary.nextDate)}</time>
            )}
            <small>แสดงรายการที่ยังไม่เสร็จและมีวันติดตามใกล้ที่สุด · กดบันทึกเพื่อยืนยันการเปลี่ยนแปลง</small>
          </aside>
          <form
            className="task-form compact"
            onSubmit={(e) => {
              e.preventDefault();
              setError('');
              try {
                validateCaseState(state);
              } catch {
                setError('ตรวจวันที่ ยอด และข้อมูลประกอบเคสให้ถูกต้อง');
                return;
              }
              void submit(e, `/api/tasks/${taskId}/workflow`, { version: view.version, state });
            }}
          >
            <fieldset disabled={!editable || busy}>
              <details className="workflow-step" open>
                <summary>ข้อมูลประกอบเคส</summary>
                <fieldset disabled={closed}>
                  <div className="form-grid">
                    {definition.fields.map((f) => (
                      <label key={f.id} htmlFor={'case-field-' + taskId + '-' + f.id}>
                        {f.label}
                        {f.options ? (
                          <select
                            id={'case-field-' + taskId + '-' + f.id}
                            aria-label={f.label}
                            value={state.fields[f.id]}
                            onChange={(e) => field(f.id, e.target.value)}
                          >
                            <option value="">เลือกประเภท</option>
                            {f.options.map((v) => (
                              <option key={v}>{v}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={'case-field-' + taskId + '-' + f.id}
                            aria-label={f.label}
                            type={f.type || 'text'}
                            min={f.type === 'number' ? 0 : undefined}
                            step={f.type === 'number' ? '0.01' : undefined}
                            maxLength={600}
                            value={state.fields[f.id]}
                            onChange={(e) => field(f.id, e.target.value)}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {view.category === 'ตัวแทนเก่า' && (
                  <p>
                    ยอดที่ยังขาด:{' '}
                    {Math.max(
                      0,
                      Number(state.fields.pcTarget || 0) - Number(state.fields.pcAccumulated || 0),
                    ).toLocaleString('th-TH')}{' '}
                    PC
                  </p>
                )}
              </details>
              {definition.sections.map((section, index) => (
                <details
                  className="workflow-step case-stage"
                  key={section.id}
                  open={!!openSections[section.id]}
                  onToggle={(e) => {
                    const open = e.currentTarget.open;
                    setOpenSections((old) =>
                      old[section.id] === open ? old : { ...old, [section.id]: open },
                    );
                  }}
                >
                  <summary>
                    {section.title}{' '}
                    <span className="case-count">
                      {summary.sections[index].done}/{section.items.length}
                      {summary.sections[index].done === section.items.length ? ' ครบแล้ว' : ''}
                    </span>
                  </summary>
                  {section.items.map((item) => {
                    const value = state.items[item.id];
                    const patch = (change: Partial<typeof value>) =>
                      setState((old) =>
                        old
                          ? {
                              ...old,
                              items: {
                                ...old.items,
                                [item.id]: { ...old.items[item.id], ...change },
                              },
                            }
                          : old,
                      );
                    return (
                      <fieldset
                        className={'case-checklist-row case-status-' + value.status}
                        key={item.id}
                        aria-label={item.label}
                        disabled={closed && item.required}
                      >
                        <label className="case-check">
                          <input
                            type="checkbox"
                            aria-label={'เสร็จแล้ว: ' + item.label}
                            checked={value.status === 'done'}
                            onChange={(e) =>
                              patch({ status: e.target.checked ? 'done' : 'pending' })
                            }
                          />
                          <span>
                            {item.label}
                            {!item.required && <small>ติดตามต่อ / ทางเลือก</small>}
                            {value.status === 'na' && <small>ไม่เกี่ยวข้องกับเคสนี้</small>}
                          </span>
                        </label>
                        <div className="case-row-actions">
                          <button
                            type="button"
                            className="case-action"
                            aria-label={
                              'ตั้งวันติดตาม: ' +
                              item.label +
                              (value.followupDate ? ' · ' + displayDate(value.followupDate) : '')
                            }
                            aria-expanded={!!dateEditors[item.id]}
                            aria-controls={'case-date-' + taskId + '-' + item.id}
                            onClick={() =>
                              setDateEditors((old) => ({ ...old, [item.id]: !old[item.id] }))
                            }
                          >
                            {value.followupDate ? displayDate(value.followupDate) : 'ตั้งวันติดตาม'}
                          </button>
                          {(!item.required || item.skippable) && (
                            <button
                              type="button"
                              className="case-action case-skip"
                              aria-label={
                                'ไม่เกี่ยวข้อง: ' +
                                item.label +
                                (value.status === 'na' ? ' · นำกลับมาติดตาม' : '')
                              }
                              aria-pressed={value.status === 'na'}
                              onClick={() =>
                                patch({ status: value.status === 'na' ? 'pending' : 'na' })
                              }
                            >
                              {value.status === 'na' ? 'นำกลับมาติดตาม' : 'ไม่เกี่ยวข้อง'}
                            </button>
                          )}
                        </div>
                        <div
                          className="case-date-editor"
                          id={'case-date-' + taskId + '-' + item.id}
                          hidden={!dateEditors[item.id]}
                        >
                          <label>
                            วันติดตามครั้งถัดไป
                            <input
                              aria-label={'วันติดตาม: ' + item.label}
                              type="date"
                              value={value.followupDate}
                              onChange={(e) => patch({ followupDate: e.target.value })}
                            />
                          </label>
                          <button
                            type="button"
                            className="case-action"
                            onClick={() => patch({ followupDate: '' })}
                          >
                            ล้างวันที่
                          </button>
                          <button
                            type="button"
                            className="case-action"
                            onClick={() => setDateEditors((old) => ({ ...old, [item.id]: false }))}
                          >
                            ซ่อนวันที่
                          </button>
                        </div>
                      </fieldset>
                    );
                  })}
                </details>
              ))}
              {error && <p role="alert">{error}</p>}
            </fieldset>
            <div className="case-save-bar">
              <span role="status">{dirty ? 'มีการเปลี่ยนแปลงที่ยังไม่บันทึก' : 'ข้อมูลตรงกับที่บันทึกไว้'}</span>
              <button className="btn primary" type="submit" disabled={!editable || busy || !dirty}>
                {busy ? 'กำลังบันทึก…' : 'บันทึกการเปลี่ยนแปลง'}
              </button>
            </div>
          </form>
          {!summary.complete && (
            <details>
              <summary>รายการที่ต้องครบก่อนปิดงาน ({summary.missing.length})</summary>
              <ul>
                {summary.missing.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </details>
          )}
          {!!view.history?.length && (
            <details className="workflow-history">
              <summary>ประวัติขั้นตอนงาน ({view.history.length} รายการล่าสุด)</summary>
              {view.history.map((h) => (
                <p key={h.version}>
                  {new Intl.DateTimeFormat('th-TH', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                    timeZone: 'Asia/Bangkok',
                  }).format(new Date(h.at))}{' '}
                  · {h.actor}
                  <br />
                  {h.summary}
                </p>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}
