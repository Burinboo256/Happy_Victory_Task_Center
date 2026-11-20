import { z } from 'zod';
import { priorities, priorityNames } from '../../domain/model';
import { categoryColors } from '../../domain/task-colors';
import type { Config } from '../config';
import { workspaceUrl } from '../workspaces/url';

export const summarySchema = z.object({
  title: z.string().min(1).max(180),
  category: z.string().max(80),
  priority: z.enum(priorities),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  senderId: z.string().regex(/^rec[a-zA-Z0-9]{14}$/),
});
export const completionSummarySchema = summarySchema.omit({ dueDate: true }).extend({
  completedAt: z.iso.datetime(),
});
export function completedTaskMessage(
  origin: string,
  taskId: string,
  summary: z.infer<typeof completionSummarySchema>,
  sender: string,
  workspace?: Config['workspace'],
) {
  const color = categoryColors[summary.category] || '#475569';
  const text = (value: string, extra: Record<string, unknown> = {}) => ({
    type: 'text',
    text: value,
    wrap: true,
    ...extra,
  });
  return {
    type: 'flex',
    altText:
      (workspace ? '[' + workspace.name + '] ' : '') + '✅ งานของคุณเสร็จสิ้นแล้ว · ' + summary.category,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#047857',
        contents: [text('✅ งานของคุณเสร็จสิ้นแล้ว', { color: '#ffffff', weight: 'bold' })],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          ...(workspace ? [text('Space: ' + workspace.name, { size: 'sm' })] : []),
          text(summary.category, { color, weight: 'bold', size: 'sm' }),
          text(summary.title, { weight: 'bold', size: 'lg' }),
          text('อัปเดตโดย: ' + sender.slice(0, 200), { size: 'sm' }),
          text(
            'เสร็จเมื่อ: ' +
              new Intl.DateTimeFormat('th-TH', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Bangkok',
              }).format(new Date(summary.completedAt)),
            { size: 'sm' },
          ),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color,
            action: {
              type: 'uri',
              label: 'เปิดดูงาน',
              uri: workspace
                ? workspaceUrl({ APP_ORIGIN: origin, workspace }, '/tasks/' + taskId)
                : origin + '/tasks/' + taskId + '?openExternalBrowser=1',
            },
          },
        ],
      },
    },
  };
}
export function newTaskMessage(
  origin: string,
  taskId: string,
  summary: z.infer<typeof summarySchema>,
  sender: string,
  workspace?: Config['workspace'],
) {
  const urgent = summary.priority === 'Urgent';
  const color = categoryColors[summary.category] || '#475569';
  const text = (value: string, extra: Record<string, unknown> = {}) => ({
    type: 'text',
    text: value,
    wrap: true,
    ...extra,
  });
  return {
    type: 'flex',
    altText: `${workspace ? '[' + workspace.name + '] ' : ''}${urgent ? '🔴 ' : ''}งานเข้าใหม่ · ${priorityNames[summary.priority]} · ${summary.category}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: urgent ? '#b91c1c' : color,
        contents: [
          text('งานเข้าใหม่ · ' + priorityNames[summary.priority], {
            color: '#ffffff',
            weight: 'bold',
          }),
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          ...(workspace ? [text('Space: ' + workspace.name, { size: 'sm' })] : []),
          text(summary.category, { color, weight: 'bold', size: 'sm' }),
          text(summary.title, { weight: 'bold', size: 'lg' }),
          text('ผู้ส่ง: ' + sender.slice(0, 200), { size: 'sm' }),
          text(
            'กำหนดส่ง: ' +
              new Intl.DateTimeFormat('th-TH', {
                dateStyle: 'medium',
                timeZone: 'Asia/Bangkok',
              }).format(new Date(summary.dueDate + 'T12:00:00+07:00')),
            { size: 'sm' },
          ),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color,
            action: {
              type: 'uri',
              label: 'เปิดดูงาน',
              uri: workspace
                ? workspaceUrl({ APP_ORIGIN: origin, workspace }, '/tasks/' + taskId)
                : origin + '/tasks/' + taskId + '?openExternalBrowser=1',
            },
          },
        ],
      },
    },
  };
}
