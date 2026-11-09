'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  blankTracking,
  stageNames,
  workflowSummary,
  workflowSchema,
  type Onboarding,
  type WorkflowView,
  type WorkflowTemplate,
} from '@/domain/onboarding';

type Submit = (
  event: FormEvent<HTMLFormElement>,
  endpoint: string,
  fixed?: Record<string, unknown>,
) => Promise<void>;
const dateLabel = (value: string) =>
  value
    ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(
        new Date(value.length === 10 ? value + 'T12:00:00+07:00' : value),
      )
    : 'ยังไม่กำหนด';
function Input({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        maxLength={type === 'date' ? undefined : 600}
      />
    </label>
  );
}
function Tracking({
  value,
  onChange,
}: {
  value: { notes: string; followupDate: string };
  onChange: (value: { notes: string; followupDate: string }) => void;
}) {
  return (
    <div className="form-row">
      <Input
        label="วันติดตามครั้งถัดไป"
        type="date"
        value={value.followupDate}
        onChange={(v) => onChange({ ...value, followupDate: v })}
      />
      <Input
        label="หมายเหตุภายในทีม"
        value={value.notes}
        onChange={(v) => onChange({ ...value, notes: v })}
      />
    </div>
  );
}
export function OnboardingPanel({
  view,
  taskId,
  editable,
  busy,
  submit,
}: {
  view: WorkflowView;
  taskId: string;
  editable: boolean;
  busy: boolean;
  submit: Submit;
}) {
  const [state, setState] = useState<Onboarding | undefined>(view.state);
  const [validationError, setValidationError] = useState('');
  const summary = state ? workflowSummary(state) : view.summary;
  const change = <K extends keyof Onboarding>(key: K, value: Onboarding[K]) =>
    setState((old) => (old ? { ...old, [key]: value } : old));
  const updateItem = <K extends 'exams' | 'documents' | 'modules'>(
    key: K,
    index: number,
    patch: Partial<Onboarding[K][number]>,
  ) => {
    if (state)
      change(
        key,
        state[key].map((item, i) => (i === index ? { ...item, ...patch } : item)) as Onboarding[K],
      );
  };
  return (
    <section className="workflow" aria-label="Workflow ตัวแทนใหม่">
      <h3>เส้นทางตัวแทนใหม่</h3>
      <p className="workflow-progress">
        อบรมแล้ว {summary.modulesDone}/{summary.modulesTotal} Module ·{' '}
        {summary.complete ? 'ครบทุกขั้นตอน พร้อมปิดงาน' : 'ยังมีขั้นตอนที่ต้องติดตาม'}
      </p>
      <ol className="workflow-stages">
        {stageNames.map((name, i) => (
          <li key={name} className={summary.stages[i] ? 'done' : ''}>
            {summary.stages[i] ? '✓' : i + 1} · {name}
          </li>
        ))}
      </ol>
      {!state ? (
        <ul>
          {summary.modules.map((m) => (
            <li key={m.id}>
              {m.name} —{' '}
              {m.status === 'completed' ? 'อบรมแล้ว' : m.status === 'booked' ? 'จองแล้ว' : 'ยังไม่จอง'}{' '}
              {m.date && '· ' + dateLabel(m.date)}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p className="muted">
            รายละเอียดและหมายเหตุด้านล่างเห็นเฉพาะเลขาฯ และ Admin ส่วน Agent เห็นสรุปความคืบหน้า
            บันทึกก่อนเปลี่ยนสถานะหรือออกจากหน้านี้
          </p>
          {!editable && <p>งานปิดแล้วหรือระบบพักการบันทึก จึงแสดงข้อมูลเพื่ออ่านเท่านั้น</p>}
          <form
            className="task-form compact"
            onSubmit={(e) => {
              const checked = workflowSchema.safeParse(state);
              if (!checked.success) {
                e.preventDefault();
                setValidationError(
                  checked.error.issues
                    .map((issue) =>
                      issue.code === 'custom'
                        ? issue.message
                        : 'กรุณาตรวจชื่อรายการ วันที่ และความยาวข้อความ',
                    )
                    .join(' · '),
                );
                return;
              }
              setValidationError('');
              void submit(e, `/api/tasks/${taskId}/onboarding`, {
                version: view.version,
                templateVersion: view.templateVersion,
                state,
              });
            }}
          >
            {validationError && <p role="alert">{validationError}</p>}
            <fieldset disabled={!editable || busy}>
              <section className="workflow-step" aria-label="แจ้งวันอบรม">
                <h4>1. แจ้งวันอบรม</h4>
                <Input
                  label="วันที่แจ้ง"
                  type="date"
                  value={state.notice.date}
                  onChange={(date) => change('notice', { ...state.notice, date })}
                />
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={state.notice.acknowledged}
                    onChange={(e) =>
                      change('notice', { ...state.notice, acknowledged: e.target.checked })
                    }
                  />
                  ผู้สมัครรับทราบแล้ว
                </label>
                <Tracking
                  value={state.notice}
                  onChange={(v) => change('notice', { ...state.notice, ...v })}
                />
              </section>
              <section className="workflow-step" aria-label="จองอบรม">
                <h4>2. จองและเข้าอบรม</h4>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={state.training.combined}
                    onChange={(e) =>
                      change('training', { ...state.training, combined: e.target.checked })
                    }
                  />
                  อบรมพร้อมสอบในรอบเดียวกัน
                </label>
                <div className="form-row">
                  <Input
                    label="วันอบรม"
                    type="date"
                    value={state.training.date}
                    onChange={(date) => change('training', { ...state.training, date })}
                  />
                  <label>
                    สถานะอบรม
                    <select
                      value={state.training.status}
                      onChange={(e) =>
                        change('training', {
                          ...state.training,
                          status: e.target.value as Onboarding['training']['status'],
                        })
                      }
                    >
                      <option value="pending">ยังไม่จอง</option>
                      <option value="booked">จองแล้ว</option>
                      <option value="attended">เข้าอบรมแล้ว</option>
                    </select>
                  </label>
                </div>
                <Input
                  label="รอบอบรม / สถานที่ / ลิงก์"
                  value={state.training.place}
                  onChange={(place) => change('training', { ...state.training, place })}
                />
                <Tracking
                  value={state.training}
                  onChange={(v) => change('training', { ...state.training, ...v })}
                />
              </section>
              <section className="workflow-step" aria-label="รอบสอบ">
                <h4>3. จองสอบและติดตามผล</h4>
                <p>
                  เก็บแต่ละรอบสอบไว้ หากไม่ผ่านหรือเลื่อน ให้เพิ่มรอบใหม่ หากอบรมพร้อมสอบ
                  ระบบจะนำวันอบรมมาเติมตอนเพิ่มรอบสอบ
                </p>
                {state.exams.map((exam, i) => (
                  <fieldset className="workflow-item" key={exam.id}>
                    <legend>รอบสอบที่ {i + 1}</legend>
                    <div className="form-row">
                      <Input
                        label="วันสอบ"
                        type="date"
                        required
                        value={exam.date}
                        onChange={(date) => updateItem('exams', i, { date })}
                      />
                      <label>
                        ผล / สถานะสอบ
                        <select
                          value={exam.status}
                          onChange={(e) =>
                            updateItem('exams', i, { status: e.target.value as typeof exam.status })
                          }
                        >
                          {Object.entries({
                            booked: 'จองแล้ว / รอสอบ',
                            waiting: 'สอบแล้ว รอผล',
                            passed: 'สอบผ่าน',
                            failed: 'สอบไม่ผ่าน',
                            postponed: 'เลื่อนสอบ',
                          }).map(([v, name]) => (
                            <option key={v} value={v}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <Tracking value={exam} onChange={(v) => updateItem('exams', i, v)} />
                  </fieldset>
                ))}
                <button
                  className="btn small"
                  type="button"
                  disabled={state.exams.length >= 30}
                  onClick={() =>
                    change('exams', [
                      ...state.exams,
                      {
                        id: crypto.randomUUID(),
                        date: state.training.combined ? state.training.date : '',
                        status: 'booked',
                        ...blankTracking(),
                      },
                    ])
                  }
                >
                  + เพิ่มรอบสอบ
                </button>
              </section>
              <section className="workflow-step" aria-label="เอกสารออกรหัส">
                <h4>4. เอกสารสำหรับออกรหัส</h4>
                <p>
                  {summary.stages[2]
                    ? 'เพิ่มเอกสารที่ต้องใช้ในเคสนี้ แล้วบันทึกวันที่ได้รับแต่ละรายการ'
                    : 'รอผลสอบผ่าน ก่อนบันทึกการขอเอกสารและออกรหัส'}
                </p>
                {state.documents.map((doc, i) => (
                  <fieldset className="workflow-item" key={doc.id}>
                    <legend>เอกสารที่ {i + 1}</legend>
                    <Input
                      label="ชื่อเอกสาร"
                      required
                      value={doc.name}
                      onChange={(name) => updateItem('documents', i, { name })}
                    />
                    <div className="form-row">
                      <Input
                        label="วันที่ขอเอกสาร"
                        type="date"
                        value={doc.requestedDate}
                        onChange={(requestedDate) => updateItem('documents', i, { requestedDate })}
                      />
                      <Input
                        label="วันที่ได้รับเอกสาร"
                        type="date"
                        value={doc.receivedDate}
                        onChange={(receivedDate) => updateItem('documents', i, { receivedDate })}
                      />
                    </div>
                    <Tracking value={doc} onChange={(v) => updateItem('documents', i, v)} />
                  </fieldset>
                ))}
                <button
                  className="btn small"
                  type="button"
                  disabled={state.documents.length >= 30}
                  onClick={() =>
                    change('documents', [
                      ...state.documents,
                      {
                        id: crypto.randomUUID(),
                        name: '',
                        requestedDate: '',
                        receivedDate: '',
                        ...blankTracking(),
                      },
                    ])
                  }
                >
                  + เพิ่มเอกสารในเคสนี้
                </button>
                {!state.documents.length && (
                  <p>
                    ยังไม่มีรายการเอกสารมาตรฐาน เพิ่มรายการที่ต้องใช้
                    หรือยืนยันด้านล่างเมื่อได้ตรวจสอบแล้วว่าเคสนี้ไม่ต้องขอเอกสารเพิ่มเติม
                  </p>
                )}
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={state.documentsConfirmed}
                    onChange={(e) => change('documentsConfirmed', e.target.checked)}
                  />
                  ตรวจสอบแล้วว่าเอกสารครบ / ไม่ต้องขอเพิ่ม
                </label>
              </section>
              <section className="workflow-step" aria-label="ออกรหัสตัวแทน">
                <h4>5. ออกรหัสตัวแทน</h4>
                <Input
                  label="วันที่ยื่นออกรหัส"
                  type="date"
                  value={state.issue.submittedDate}
                  onChange={(submittedDate) => change('issue', { ...state.issue, submittedDate })}
                />
                <div className="form-row">
                  <Input
                    label="รหัสตัวแทนที่ได้รับ"
                    value={state.issue.code}
                    onChange={(code) => change('issue', { ...state.issue, code })}
                  />
                  <Input
                    label="วันที่ได้รับรหัส"
                    type="date"
                    value={state.issue.issuedDate}
                    onChange={(issuedDate) => change('issue', { ...state.issue, issuedDate })}
                  />
                </div>
                <Tracking
                  value={state.issue}
                  onChange={(v) => change('issue', { ...state.issue, ...v })}
                />
              </section>
              <section className="workflow-step" aria-label="Module อบรม">
                <h4>6. ติดตามอบรมทุก Module</h4>
                <p>บันทึกต่างลำดับกันได้ ต้องครบทุก Module จึงปิดงานได้</p>
                {state.modules.map((module, i) => (
                  <fieldset className="workflow-item" key={module.id}>
                    <legend>{module.name}</legend>
                    <div className="form-row">
                      <label>
                        สถานะ Module
                        <select
                          value={module.status}
                          onChange={(e) =>
                            updateItem('modules', i, {
                              status: e.target.value as typeof module.status,
                            })
                          }
                        >
                          <option value="pending">ยังไม่จอง</option>
                          <option value="booked">จองแล้ว</option>
                          <option value="completed">อบรมแล้ว</option>
                        </select>
                      </label>
                      <Input
                        label="วันที่อบรม Module"
                        type="date"
                        value={module.date}
                        onChange={(date) => updateItem('modules', i, { date })}
                      />
                    </div>
                    <Tracking value={module} onChange={(v) => updateItem('modules', i, v)} />
                  </fieldset>
                ))}
              </section>
              <div className="form-actions">
                <button className="btn primary" type="submit">
                  {busy ? 'กำลังบันทึก…' : 'บันทึก Workflow'}
                </button>
              </div>
            </fieldset>
          </form>
          {!!view.history?.length && (
            <details className="workflow-history">
              <summary>ประวัติการบันทึก Workflow ({view.history.length} รายการล่าสุด)</summary>
              {view.history.map((h) => (
                <p key={h.version}>
                  {dateLabel(h.at)} · {h.actor}
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

export function OnboardingSettings({
  request,
  submit,
  disabled,
}: {
  request: (url: string) => Promise<{ version: number; template: WorkflowTemplate }>;
  submit: Submit;
  disabled: boolean;
}) {
  const [value, setValue] = useState<{ version: number; template: WorkflowTemplate } | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void request('/api/onboarding-template')
      .then((v) => {
        if (live) setValue(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [request]);
  if (error) return <p role="alert">{error}</p>;
  if (!value) return <p role="status">กำลังโหลดรายการมาตรฐาน…</p>;
  const update = (key: 'modules' | 'documents', items: WorkflowTemplate[typeof key]) =>
    setValue({ ...value, template: { ...value.template, [key]: items } });
  return (
    <section className="workflow settings-panel" aria-label="ตั้งค่า Workflow ตัวแทนใหม่">
      <h3>ตั้งค่า Workflow ตัวแทนใหม่</h3>
      <p>
        เฉพาะ Admin · เปลี่ยนชื่อ Module ได้โดยประวัติยังอยู่ รายการ Module
        หรือเอกสารที่เพิ่มใหม่จะใช้กับเคสที่ยังไม่เคยบันทึก Workflow เท่านั้น เคสเดิมเพิ่มเอกสารเฉพาะเคสได้
      </p>
      <form
        className="task-form compact"
        onSubmit={(e) => void submit(e, '/api/onboarding-template', value)}
      >
        <fieldset disabled={disabled}>
          {(['modules', 'documents'] as const).map((key) => (
            <section className="workflow-step" key={key}>
              <h4>{key === 'modules' ? 'ชื่อ Module มาตรฐาน' : 'ชุดเอกสารเริ่มต้น'}</h4>
              {value.template[key].map((item, i) => (
                <div className="workflow-template-row" key={item.id}>
                  <Input
                    label={(key === 'modules' ? 'Module ' : 'เอกสาร ') + (i + 1)}
                    required
                    value={item.name}
                    onChange={(name) =>
                      update(
                        key,
                        value.template[key].map((v, j) => (j === i ? { ...v, name } : v)),
                      )
                    }
                  />
                  {key === 'documents' && (
                    <button
                      className="btn small"
                      type="button"
                      onClick={() =>
                        update(
                          key,
                          value.template[key].filter((_, j) => j !== i),
                        )
                      }
                    >
                      นำออกจากชุดเริ่มต้น
                    </button>
                  )}
                </div>
              ))}
              <button
                className="btn small"
                type="button"
                disabled={value.template[key].length >= (key === 'modules' ? 20 : 30)}
                onClick={() =>
                  update(key, [...value.template[key], { id: crypto.randomUUID(), name: '' }])
                }
              >
                {key === 'modules' ? '+ เพิ่ม Module มาตรฐาน' : '+ เพิ่มเอกสารมาตรฐาน'}
              </button>
            </section>
          ))}
          <button className="btn primary" type="submit">
            บันทึกรายการมาตรฐาน
          </button>
        </fieldset>
      </form>
    </section>
  );
}
