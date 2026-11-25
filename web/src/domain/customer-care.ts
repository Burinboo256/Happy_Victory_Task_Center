export const policyKinds = ['life', 'health', 'critical', 'accident', 'savings', 'linked'] as const;
export type PolicyKind = (typeof policyKinds)[number];
export const frequencies = ['monthly', 'quarterly', 'yearly'] as const;
export type PaymentFrequency = (typeof frequencies)[number];
export const premiumAmountPattern = /^[0-9]{1,10}(?:\.[0-9]{1,2})?$/;
export const paymentLabels = { monthly: 'รายเดือน', quarterly: 'รายไตรมาส', yearly: 'รายปี' };
export const insurance: Record<PolicyKind, [string, string]> = {
  life: ['ชีวิต', 'ทบทวนผู้รับประโยชน์ ผู้พึ่งพิง และภาระครอบครัวกับตัวแทน'],
  health: ['สุขภาพ', 'ตรวจสิทธิบริการ โรงพยาบาล และช่องทางประสานเคลมตามแผน'],
  critical: ['โรคร้ายแรง', 'ให้ตัวแทนทบทวนเงื่อนไขผลประโยชน์และเอกสารสำหรับขอรับบริการ'],
  accident: ['อุบัติเหตุ', 'ตรวจอาชีพและกิจกรรมที่เปลี่ยนไป พร้อมทบทวนช่องทางแจ้งเหตุ'],
  savings: ['สะสมทรัพย์ / บำนาญ', 'ตรวจวันที่รับผลประโยชน์ วันครบสัญญา และช่องทางรับเงิน'],
  linked: ['ยูนิตลิงค์', 'นัดตัวแทนที่ดูแลทบทวนรายงานกรมธรรม์ ค่าธรรมเนียม และเป้าหมายของลูกค้า'],
};
export const eventKinds = [
  'welcome',
  'checkin',
  'review',
  'birthday',
  'premium',
  'maturity',
  'life',
  'claim',
  'service',
] as const;
export type EventKind = (typeof eventKinds)[number];
export const careLabels: Record<EventKind, string> = {
  welcome: 'ส่งมอบและแนะนำการใช้สิทธิ',
  checkin: 'ติดตามหลังรับกรมธรรม์',
  review: 'ทบทวนความเพียงพอของความคุ้มครอง',
  birthday: 'วันเกิดลูกค้า',
  premium: 'ยืนยันการชำระเบี้ย',
  maturity: 'ติดตามครบสัญญา',
  life: 'ทบทวนเมื่อชีวิตเปลี่ยน',
  claim: 'ติดตามหลังแจ้งเคลม',
  service: 'นัดบริการลูกค้า',
};
export const outcomes = { done: 'ดำเนินการแล้ว', retry: 'ติดต่ออีกครั้ง', handoff: 'ส่งต่อตัวแทน' } as const;
export type Outcome = keyof typeof outcomes;
export const leadDays: Record<EventKind, number> = {
  welcome: 0,
  checkin: 7,
  review: 30,
  birthday: 7,
  premium: 30,
  maturity: 60,
  life: 7,
  claim: 7,
  service: 7,
};
export type CareEvent = {
  id: string;
  kind: EventKind;
  due: string;
  recipient: 'team' | 'agent';
  note: string;
  outcome: Outcome | null;
  resultNote: string | null;
  completedAt: string | null;
};
export type CarePolicy = {
  id: string;
  customer: string;
  reference: string;
  kind: PolicyKind;
  agentId: string;
  started: string;
  reviewDate: string | null;
  birthday: string | null;
  frequency: PaymentFrequency | null;
  premiumAmount: string | null;
  ends: string | null;
  closed: boolean;
  events: CareEvent[];
};
export function shiftDate(iso: string, days: number) {
  const date = new Date(iso + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function anniversary(iso: string, year: number) {
  const candidate = String(year) + iso.slice(4);
  return new Date(candidate + 'T12:00:00Z').getUTCMonth() === Number(iso.slice(5, 7)) - 1
    ? candidate
    : String(year) + '-02-28';
}
export function alertLevel(event: Pick<CareEvent, 'kind' | 'due'>, today: string) {
  if (event.due < today) return 'เกินนัด';
  if (event.due === today) return 'วันนี้';
  if (event.due <= shiftDate(today, leadDays[event.kind])) return 'ใกล้ถึงนัด';
  return 'ตามแผน';
}
export function annualOnOrAfter(anchor: string, from: string) {
  const year = Number(from.slice(0, 4));
  const due = anniversary(anchor, year);
  return due >= from ? due : anniversary(anchor, year + 1);
}
export function nextPremium(cycleDue: string, anchor: string, frequency: PaymentFrequency) {
  const months = { monthly: 1, quarterly: 3, yearly: 12 }[frequency];
  const first = new Date(cycleDue.slice(0, 7) + '-01T12:00:00Z');
  first.setUTCMonth(first.getUTCMonth() + months);
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(last, Number(anchor.slice(8, 10))));
  return first.toISOString().slice(0, 10);
}
export function initialCare(
  started: string,
  today: string,
  premium?: string,
  ends?: string,
  reviewDate?: string,
  birthday?: string,
) {
  const schedule: { kind: EventKind; due: string }[] = [];
  // For an existing policy, start the relationship now instead of manufacturing years of missed contacts.
  if (shiftDate(started, 30) >= today)
    schedule.push(
      { kind: 'welcome', due: started },
      { kind: 'checkin', due: shiftDate(started, 30) },
    );
  else schedule.push({ kind: 'service', due: today });
  let year = Math.max(Number(today.slice(0, 4)), Number(started.slice(0, 4)) + 1);
  if (anniversary(started, year) < today) year++;
  schedule.push({ kind: 'review', due: reviewDate || anniversary(started, year) });
  if (birthday)
    schedule.push({
      kind: 'birthday',
      due: annualOnOrAfter('2000-' + birthday, started > today ? started : today),
    });
  if (premium) schedule.push({ kind: 'premium', due: premium });
  if (ends) schedule.push({ kind: 'maturity', due: ends });
  return schedule.filter((e) => !ends || e.due <= ends);
}
