# กู้คำขอที่บันทึกไม่ครบ

คู่มือนี้สำหรับผู้ดูแลระบบใหม่ใน `web/` ซ้อมกับ Airtable test Base และ PostgreSQL บนเครื่องแล้ว ยังไม่ Deploy ไป production ระบบ Apps Script เดิมใช้ขั้นตอนของตัวเอง

วันที่ 6 พฤศจิกายน 2026: `rehearse:live` ผ่าน lost acknowledgement ทั้ง 5 actions, completed replay, Completed At เดิม และ child process ที่หยุดจริง (exit 86) ก่อนบันทึกผล step รอครบเกณฑ์ 120 วินาทีแล้วผ่าน running → review → pending → completed พร้อม recovery events 7 รายการและไม่มี reservation ค้าง หลักฐาน `artifacts/vercel/live-recovery-8f12f712-2db9-4afb-89b9-ea2de0aa53d4.json` เป็น service / recovery test ด้วย actors สมมติ ไม่แทนการทดสอบ Google / HTTP หลายบัญชี

ซ้อม CLI กับ HTTP session ของ Agent A จริงเพิ่มเติมแล้ว: คำตอบ create หายหลัง Airtable ยอมรับ → review; เปลี่ยนชื่อ task สมมติโดยตรงแล้ว reconcile คง review / reservation; คืนข้อมูลแล้ว reconcile เป็น pending จากนั้นผู้ใช้เดิมกดส่งฟอร์มเดิมและจบ completed โดยมี task / audit อย่างละ 1 ไม่ส่ง upsert task ซ้ำ หลักฐาน `artifacts/vercel/live-http-result-a62025c4.json` และ [สถานะ local acceptance](vercel-local-acceptance.md)

## หลักการ

เซิร์ฟเวอร์บันทึก write intent ก่อนเรียก Airtable ทุก business step หากการเชื่อมต่อขาดหลังส่ง จะเก็บ `review` และจอง resource ต่อ ไม่สรุปว่ารายการหายแล้วเขียนซ้ำ

`ops:recover` อ่าน Airtable เพื่อพิสูจน์ผลเดิมและแก้เฉพาะ journal พร้อม recovery event ใน PostgreSQL ไม่เรียก PATCH / upsert กับ Airtable ไม่มี recovery API สาธารณะ และไม่แอบทำงานด้วยสิทธิ์ผู้ใช้เดิม

## เตรียมก่อนใช้

1. รัน `npm run db:migrate` ให้มี migration `002_recovery_events.sql` ด้วย ใช้ environment / test Base ที่ตรงกับ DB binding
2. ปิด DB writes ผ่าน `ops:runtime -- --environment=development --base-id=<TEST_BASE_ID> --writes=off` และยืนยัน DB `jobs=false` การตั้ง Environment Variable ฝั่ง CLI เป็น false อย่างเดียวไม่เพียงพอ
3. ตรวจว่าไม่มี invocation / worker ค้าง และไม่มีผู้ใช้แก้ business records โดยตรงใน Airtable ระหว่างตรวจ บันทึกหลักฐานที่ยืนยันว่า invocation จบแล้ว เช่น incident / log reference
4. ตรวจ operation ID จากหน้าจอผู้ใช้ด้วย `ops:inspect` ห้ามส่ง token, cookie, payload หรือข้อมูลลูกค้าเข้า logs / แชต

รันคำสั่งต่อไปนี้จาก `web/` ค่า UUID เป็นตัวอย่าง ให้แทนด้วย operation ID จริงทั้งสองตำแหน่ง `operator` และ `evidence` เป็นรหัสอ้างอิง ไม่มีชื่อ / รายละเอียดลูกค้า

## Running ค้าง

เมื่อยืนยันว่า invocation หยุดแล้ว และ `updated_at` เก่ากว่า 120 วินาที:

```powershell
npm run ops:recover -- --environment=development --action=mark-stopped --id=00000000-0000-4000-8000-000000000000 --confirm-no-inflight=00000000-0000-4000-8000-000000000000 --operator=maintainer01 --evidence=INC/local-001
```

คำสั่งนี้เปลี่ยน `running` เป็น `review` เท่านั้น อายุคำขอไม่ใช่หลักฐานว่าหยุดแล้ว ผู้ดูแลต้องตรวจ invocation ก่อนให้คำยืนยัน ไม่ปล่อย resource อัตโนมัติตาม TTL

## ตรวจ Review

```powershell
npm run ops:recover -- --environment=development --action=reconcile --id=00000000-0000-4000-8000-000000000000 --confirm-no-inflight=00000000-0000-4000-8000-000000000000 --operator=maintainer01 --evidence=INC/local-001
```

- Upsert: ต้องพบ record เดียวที่มี Request Key / Operation Key ตรง และทุก field ตรงกับ intent รวม links และ visibility
- Patch: record ID และ fields ต้องตรงกับ intent; ตรวจ Completed At, parent ของ followup และ Next Follow-up เทียบ Pending ปัจจุบันด้วย
- ข้อมูลหาย / ซ้ำ / เปลี่ยน / step เก่าไม่มี intent: ชื่อ step อยู่ใน `unresolved` และยังเป็น `review` ไม่ถือว่าพร้อม retry
- ถ้าครบ: เปลี่ยนเป็น `pending` และทำเครื่องหมายเฉพาะ steps ที่พิสูจน์ได้ว่าเสร็จแล้ว ยังถือ resource ไว้
- ถ้ามีผู้ดูแลอีกคนเปลี่ยน journal หรือเปิด writes ระหว่างอ่าน: `RECOVERY_CONFLICT` ไม่บันทึกผลครึ่งหนึ่ง ให้หยุดและตรวจสถานะใหม่

Recovery events เก็บ operator / evidence reference / step names / state ก่อนและหลังไว้ใน `hvr_recovery_events` พร้อมการแก้ journal แบบ atomic ไม่มี payload หรือ record fields ใน CLI output

## กลับมาทำงาน

ตรวจรายการที่ค้างทั้งหมดก่อนเปิด writes ของ environment เดิมตาม runbook ให้ผู้ใช้เดิมที่ยังมี Active / Role / ownership ถูกต้องส่ง payload และ idempotency key เดิมต่อ ระบบจะข้าม step ที่พิสูจน์แล้วและทำส่วนที่เหลือ เมื่อ `completed` จึงปล่อย resource

CLI ไม่เปลี่ยน Role, ย้ายเจ้าของ, สร้าง request key ใหม่ หรือทำให้ผู้ใช้ที่ถูกเพิกถอนสิทธิ์ทำต่อได้ หากไม่สามารถพิสูจน์ผลเดิมหรือผู้ใช้เดิมไม่มีสิทธิ์แล้ว ให้คง `review` และจัดทำแผนแก้ข้อมูลที่ตรวจสอบได้เฉพาะเหตุการณ์ ห้ามแก้ SQL state / ลบ reservation เพื่อข้ามปัญหา
