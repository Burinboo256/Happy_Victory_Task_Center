'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  caseNameLabel,
  isManager,
  priorities,
  priorityNames,
  type Bootstrap,
  type Task,
} from '@/domain/model';

export type TaskDraft = Pick<Task, 'title' | 'description' | 'agentId' | 'dueDate' | 'category'> & {
  caseName: string;
};
export type TaskFormProps = {
  data: Bootstrap;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};
export function TaskForm({
  data,
  busy,
  onSubmit,
  initial,
  cancel,
}: TaskFormProps & { initial?: TaskDraft; cancel: ReactNode }) {
  const [newCategory, setNewCategory] = useState(initial?.category || '');
  return (
    <section className="panel form-panel">
      <div className="panel-title">
        <div>
          <h2>{initial ? 'เปิดงานจากคิวติดตาม' : 'รายละเอียดงานใหม่'}</h2>
          <small>{initial ? 'ตรวจรายละเอียดก่อนส่งให้เลขา' : 'NEW TASK · เริ่มต้นความคืบหน้าใหม่'}</small>
        </div>
      </div>
      <form className="task-form" onSubmit={onSubmit}>
        <fieldset disabled={busy || !data.writesEnabled}>
          <label>
            ชื่องาน *
            <input
              name="title"
              defaultValue={initial?.title}
              required
              maxLength={180}
              placeholder="เช่น ติดตามเอกสารกรมธรรม์ลูกค้า"
            />
          </label>
          <label>
            รายละเอียดงาน *
            <textarea
              name="description"
              defaultValue={initial?.description}
              required
              maxLength={5000}
              rows={5}
              placeholder="รายละเอียดที่ต้องการให้เลขาฯ ช่วยดำเนินการ"
            />
          </label>
          {isManager(data.user) && (
            <label>
              Agent เจ้าของงาน *
              <select name="agentId" required defaultValue={initial?.agentId || ''}>
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
              <select
                name="category"
                value={newCategory || data.categories[0]}
                onChange={(e) => setNewCategory(e.target.value)}
              >
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
            <span>
              {caseNameLabel(newCategory || data.categories[0])}{' '}
              <span className="case-required-marker" aria-hidden="true">
                *
              </span>
            </span>
            <input
              name="caseName"
              defaultValue={initial?.caseName}
              aria-label={caseNameLabel(newCategory || data.categories[0])}
              required
              maxLength={180}
              autoComplete="off"
              aria-describedby="case-name-hint"
            />
            <small id="case-name-hint">
              ชื่อ–นามสกุลของบุคคลที่ให้เลขาดำเนินการ แยกจาก Agent เจ้าของงาน
            </small>
          </label>
          <label>
            กำหนดส่ง *
            <input
              type="date"
              name="dueDate"
              defaultValue={initial?.dueDate || data.today}
              required
            />
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
            {cancel}
            <button className="btn primary" type="submit">
              {busy ? 'กำลังส่งงาน…' : '+ ส่งงานให้เลขาฯ'}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
