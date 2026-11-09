import { priorityNames, type Priority } from '@/domain/model';

const categoryClasses: Record<string, string> = {
  เอกสารกรมธรรม์: 'category-documents',
  บริการลูกค้า: 'category-service',
  นัดหมาย: 'category-appointment',
  การเงิน: 'category-finance',
  งานทั่วไป: 'category-general',
  ตัวแทนใหม่: 'category-new-agent',
};
export const categoryClass = (category: string) => categoryClasses[category] || 'category-general';
export function CategoryBadge({ category }: { category: string }) {
  return (
    <span className={'category-badge ' + categoryClass(category)}>{category || 'ไม่ระบุประเภท'}</span>
  );
}
export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={'priority priority-' + priority.toLowerCase()}>
      {priority === 'Urgent' ? '! ' : priority === 'High' ? '↑ ' : ''}
      {priorityNames[priority]}
    </span>
  );
}
