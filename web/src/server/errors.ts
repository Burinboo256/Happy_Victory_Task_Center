export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
// A write may have reached Airtable. Never automatically replay it as a new write.
export class UncertainWrite extends AppError {
  constructor() {
    super(503, 'WRITE_UNCERTAIN', 'กำลังตรวจสอบผลบันทึก กรุณาอย่าส่งคำขอใหม่');
  }
}
export const forbidden = () => new AppError(403, 'FORBIDDEN', 'คุณไม่มีสิทธิ์ดำเนินการนี้');
export const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบอีกครั้ง');
