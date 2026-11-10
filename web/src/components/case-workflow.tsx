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
    summary = state ? caseSummary(state) : view.summary,
    showItemNotes = definition.itemNotes !== false;
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
          <p>
            บันทึกข้อมูลเฉพาะเคสนี้ เจ้าของเคสคือ Agent ที่ระบุในงาน{' '}
            {showItemNotes ? 'หมายเหตุและข้อมูลประกอบ' : 'ข้อมูลประกอบ'}เห็นเฉพาะทีมเลขา/ผู้ดูแล
          </p>
          {closed && (
            <p>งานหลักปิดแล้ว ยังบันทึกรายการติดตามต่อและทางเลือกได้ หากแก้รายการบังคับ ให้เปิดงานอีกครั้งก่อน</p>
          )}
          <form
            className="task-form compact"
            onSubmit={(e) => {
              e.preventDefault();
              setError('');
              try {
                validateCaseState(state);
              } catch {
                setError(
                  showItemNotes
                    ? 'ตรวจวันที่ ยอด และเหตุผลของรายการที่ไม่เกี่ยวข้องให้ครบ'
                    : 'ตรวจวันที่และข้อมูลประกอบเคสให้ถูกต้อง',
                );
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
                <details className="workflow-step" key={section.id} open={index === 0 || undefined}>
                  <summary>
                    {section.title} · {summary.sections[index].done}/{section.items.length}
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
                        className="workflow-item"
                        key={item.id}
                        disabled={closed && item.required}
                      >
                        <legend>
                          {item.label} {!item.required && <small>· ติดตามต่อ/ทางเลือก</small>}
                        </legend>
                        <div className="form-row">
                          <label>
                            สถานะ
                            <select
                              aria-label={'สถานะ: ' + item.label}
                              value={value.status}
                              onChange={(e) =>
                                patch({ status: e.target.value as typeof value.status })
                              }
                            >
                              <option value="pending">ยังไม่เสร็จ</option>
                              <option value="done">เสร็จแล้ว</option>
                              {(!item.required || item.skippable) && (
                                <option value="na">ไม่เกี่ยวข้องกับเคสนี้</option>
                              )}
                            </select>
                          </label>
                          <label>
                            วันติดตามครั้งถัดไป
                            <input
                              aria-label={'วันติดตาม: ' + item.label}
                              type="date"
                              value={value.followupDate}
                              onChange={(e) => patch({ followupDate: e.target.value })}
                            />
                          </label>
                        </div>
                        {showItemNotes && (
                          <label>
                            หมายเหตุ / หลักฐาน / เหตุผลที่ไม่เกี่ยวข้อง <small>ภายในทีม</small>
                            <textarea
                              aria-label={'หมายเหตุ: ' + item.label}
                              rows={2}
                              maxLength={600}
                              required={value.status === 'na'}
                              value={value.notes}
                              onChange={(e) => patch({ notes: e.target.value })}
                            />
                          </label>
                        )}
                      </fieldset>
                    );
                  })}
                </details>
              ))}
              {error && <p role="alert">{error}</p>}
              <button className="btn primary" type="submit">
                {busy ? 'กำลังบันทึก…' : 'บันทึกขั้นตอนงาน'}
              </button>
            </fieldset>
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
