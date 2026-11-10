'use client';
import { useState, type FormEvent } from 'react';
import { priorities, priorityNames, type PublicUser, type Task } from '@/domain/model';

export function TaskEditPanel({
  task,
  users,
  busy,
  enabled,
  submit,
  onCancel,
}: {
  task: Task;
  users: PublicUser[];
  busy: boolean;
  enabled: boolean;
  onCancel: () => void;
  submit: (
    event: FormEvent<HTMLFormElement>,
    endpoint: string,
    fixed?: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const [agentId, setAgentId] = useState(task.agentId);
  const eligible = users.filter((user) => user.active && user.role === 'Agent');
  const current = users.find((user) => user.id === task.agentId);
  return (
    <section className="task-edit" aria-label="แก้ไขข้อมูลงาน">
      <h3>แก้ไขข้อมูลงาน</h3>
      <form
        className="task-form compact"
        onSubmit={(event) =>
          void submit(event, `/api/tasks/${task.id}/edit`, { version: task.version })
        }
      >
        <fieldset disabled={busy || !enabled}>
          <label>
            ชื่องาน *<input name="title" defaultValue={task.title} required maxLength={180} />
          </label>
          <label>
            รายละเอียดงาน *
            <textarea
              name="description"
              defaultValue={task.description}
              required
              maxLength={5000}
              rows={4}
            />
          </label>
          <label>
            Agent เจ้าของงาน *
            <select
              name="agentId"
              required
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
            >
              {!eligible.some((user) => user.id === task.agentId) && (
                <option value={task.agentId}>{current?.name || 'เจ้าของงานเดิม'} (บัญชีเดิม)</option>
              )}
              {eligible.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          {agentId !== task.agentId && (
            <p className="maintenance-notice">
              เมื่อบันทึก Agent เดิมจะไม่เห็นงานนี้ และ Agent ใหม่จะเข้าถึงรายละเอียดและประวัติงานที่เปิดให้ Agent
              เห็นได้
            </p>
          )}
          <div className="form-row">
            <label>
              ความเร่งด่วน
              <select name="priority" defaultValue={task.priority}>
                {priorities.map((priority) => (
                  <option key={priority} value={priority}>
                    {priorityNames[priority]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              กำหนดส่ง *<input type="date" name="dueDate" defaultValue={task.dueDate} required />
            </label>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onCancel}>
              ยกเลิกการแก้ไข
            </button>
            <button type="submit" className="btn primary">
              {busy ? 'กำลังบันทึก…' : 'บันทึกข้อมูลงาน'}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
